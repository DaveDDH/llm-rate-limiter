# E2E Test Audit Report

This report identifies tests that are **wrong**, **missing**, or **weak** compared to the documented specifications in `packages/e2e/docs/`. For each issue, it explains the expected behavior, what the test currently does, and what it should do instead.

## Summary

| Verdict | Count | Description |
|---------|-------|-------------|
| WRONG | 8 | Assertions contradict the documentation or test the wrong scenario entirely |
| MISSING | 25 | Documented test cases with no implementation |
| WEAK | 60 | Tests exist but have trivial assertions that don't verify the core behavior |
| GOOD | 101 | Tests correctly verify the documented behavior |
| **Total** | **194** | |

---

## WRONG Tests

These tests have assertions that contradict the documentation, use incorrect configurations, or test an entirely different scenario than what is specified.

---

### Test 1.4 - Concurrent-Only Model (slotCalculation.test.ts)

**Expected behavior:** With `maxConcurrentRequests = 100` and 3 instances, each instance should get `floor(100 / 3) = 33` slots. This verifies that concurrent slot division handles remainder correctly across 3 instances.

**What the test does:** Uses 2 instances and expects `floor(100 / 2) = 50` slots.

**Why this matters:** The doc specifically uses 3 instances to test the floor division remainder case (100 / 3 = 33.33, floored to 33). With 2 instances there is no remainder (100 / 2 = 50), so the floor division edge case is never tested.

**What to fix:** Either change the test to use 3 instances and expect 33 slots, or update the documentation. The 3-instance scenario is more valuable because it tests remainder handling.

---

### Test 4.3 - Global Counter Tokens (singleJobOperations.test.ts)

**Expected behavior:** After a single job completes with `actualTokens = 5,000`, the global counter should show `globalActualTokensThisMinute = 5,000`.

**What the test does:** The mock job returns `inputTokens=7000 + outputTokens=3000 = 10,000`, so the test asserts `tokensPerMinute.current === 10,000`.

**Why this matters:** The test and doc disagree on the actual token amount. The test is internally consistent (mock returns 10K, assertion checks 10K), but it does not match the documented value of 5K. One of them needs to be updated to match the other.

**What to fix:** Align the mock job's actual tokens with the documented value (5,000), or update the doc to reflect 10,000.

---

### Test 9.3 - Request Count Refund (actualUsageRefunds.test.ts)

**Expected behavior:** Job with `estimatedRequests = 5` and `actualRequests = 2` should produce an RPM refund of 3. The RPM counter should show 2 (actual) instead of 5 (estimated).

**What the test does:** Uses `estimatedRequests = 1` and `actualRequests = 0`, which tests a different scenario (zero actual usage) rather than the documented partial refund.

**Why this matters:** The documented scenario tests that RPM refunds work with partial usage (5 estimated, 2 actual = 3 refunded). The implemented test only checks zero-usage refund, missing the partial refund path.

**What to fix:** Update the test config and mock to use `estimatedRequests = 5` and `actualRequests = 2`, then assert `rpm.current === 2`.

---

### Test 26.2 - Mixed Refund and Overage (multiResourceAdjustment.test.ts)

**Expected behavior:** A single job where tokens are refunded (estimated=10K, actual=6K) but requests have an overage (estimated=1, actual=3). This tests that TPM/TPD get a refund while RPM/RPD get an overage -- both directions in one job.

**What the test does:** Uses the same config preset as test 26.1 where `estimatedRequests = 5`. With `actualRequests = 3`, this is also a refund (5 - 3 = 2 refunded), not an overage. The test never produces the documented "mixed" scenario.

**Why this matters:** The mixed refund/overage scenario is architecturally important: it proves the system handles per-resource-type directions independently. If all resources only get refunds, the test doesn't exercise the overage path at all.

**What to fix:** Create a separate config preset with `estimatedRequests = 1`. Then `actualRequests = 3` produces an overage of 2 for RPM/RPD while tokens still get a refund. Assert `tpm.current === 6000` (refund) and `rpm.current === 3` (overage from estimated 1).

---

### Test 27.3 - Job Carries Window Start Metadata (timeWindowHandling.test.ts)

**Expected behavior:** When a job completes within the same minute window it started, the response should include `tpmWindowStart` and `rpmWindowStart` metadata pointing to the start of that minute (e.g., 10:00:00.000). This proves the system tracks which window each job belongs to.

**What the test does:** Submits a fast job and checks `tpm.current = 6000`. This is identical to test 27.1 (same-window refund). It never reads or asserts on `tpmWindowStart` or `rpmWindowStart`.

**Why this matters:** Window start metadata is how the system decides whether a refund applies (same window) or not (cross-window). Without verifying this metadata, there is no proof the system tracks window boundaries correctly per-job.

**What to fix:** After job completion, fetch the job result or stats and assert that `tpmWindowStart` equals the start of the current minute (floored to :00). Assert the same for `rpmWindowStart`. If the debug API does not expose these fields, it needs to be extended.

---

### Test 27.4 - Cross-Window Job Has Original Window (timeWindowHandling.test.ts)

**Expected behavior:** A job that starts in minute N and completes in minute N+1 should carry `tpmWindowStart = minute N start` (not minute N+1). This proves the system associates jobs with their start window, which is critical for correct refund/overage accounting.

**What the test does:** Records the current minute start, submits a job, waits for the minute boundary, then asserts `getCurrentWindowStart() > windowStart`. This only checks that the wall clock has advanced past a minute boundary -- it never queries the job's window metadata.

**Why this matters:** The assertion would pass even if the system had no window tracking at all. The test proves nothing about the job's associated window; it only proves time passes.

**What to fix:** After the cross-window job completes, fetch its `tpmWindowStart` from the server and assert it equals the original window (minute N start), NOT the completion window (minute N+1 start). This requires the debug API to expose per-job window metadata.

---

### Test 38.2 - Redis Allocation Unaware of Memory (distributedMemoryIndependence.test.ts)

**Expected behavior:** With `TPM = 100,000` and 2 instances, Redis should allocate `floor(100K / 10K / 2) = 5` pool slots per instance, regardless of each instance's memory. Memory is a local-only constraint.

**What the test does:** The config uses `TPM = 1,000,000` (1M), so the test expects `floor(1M / 10K / 2) = 50` slots. The test verifies its own config correctly, but the config contradicts the documentation.

**Why this matters:** The test values (50 slots) don't match the doc (5 slots). If someone reads the doc expecting 5 and finds 50, it causes confusion. The test also uses much higher capacity than necessary, making it harder to reach memory-constrained scenarios.

**What to fix:** Either update the config to use `TPM = 100,000` and expect 5 slots (matching the doc), or update the doc to reflect the 1M TPM config.

---

### Test 47.1 - Very Large Instance Count (edgeCases.test.ts)

**Expected behavior:** With `TPM = 100,000`, `estimatedTokens = 10,000`, and 100 instances, each gets `floor(100K / 10K / 100) = 0` slots and `tokensPerMinute = 1,000`. This tests the zero-slot edge case at scale.

**What the test does:** Uses 4 instances with `TPM = 15,000` and expects 1 slot (with minimum slot guarantee). This tests a completely different scenario.

**Why this matters:** The doc is testing what happens when floor division yields zero slots across many instances. The test instead tests a minimum-slot guarantee with few instances -- a different edge case entirely.

**What to fix:** The test should either:
1. Boot with a config that yields 0 slots per instance (e.g., very low TPM or very many instances) and verify `totalSlots === 0`
2. Or update the doc to match the "minimum slot guarantee" scenario that the test actually validates

Note: Booting 100 instances in a test is impractical. Instead, use a config where `floor(TPM / estimatedTokens / instanceCount) = 0` with fewer instances (e.g., `TPM = 5000`, `estimatedTokens = 10000`, 2 instances).

---

## MISSING Tests

These documented test cases have no implementation. They are grouped by feature area, from most critical to least.

---

### Cross-Window Behavior (Tests 9.4, 10.4)

**Why these are critical:** The time-window-aware refund/overage system is a core architectural concept. Jobs that complete in a different minute window than they started should NOT get refunds (the original window's counter is already closed). Overages should still be counted. Without these tests, there is no verification that the system handles the most common real-world scenario: jobs spanning minute boundaries.

#### Test 9.4 - Cross-Window No Refund

**Expected behavior:**
1. Job starts in minute N with `estimatedTokens = 10,000`
2. Job completes in minute N+1 with `actualTokens = 6,000`
3. Minute N's counter should remain at 10,000 (no refund -- window already closed)
4. Minute N+1's counter should be 0 (job was not counted in this window)

**How to test:** Submit a job near the end of a minute (e.g., at :55) with a duration that ensures completion after :00. After completion, verify the old window counter still shows the estimated value (10,000) and the new window counter shows 0.

#### Test 10.4 - Cross-Window Overage

**Expected behavior:**
1. Job starts in minute N with `estimatedTokens = 10,000`
2. Job completes in minute N+1 with `actualTokens = 15,000`
3. The overage (5,000 tokens) should still be recorded (overages are always counted regardless of window)

**How to test:** Same timing setup as 9.4, but with actual usage exceeding estimated. Verify the overage is applied to the global counter.

---

### Flexible Ratio Adjustment (Tests 17.1-17.9)

**Why these are critical:** The ratio adjustment algorithm (donor/receiver) is a major feature of the local job type manager. 9 of 11 documented test cases are missing. The 2 existing tests only check "did jobs complete?" without ever inspecting actual ratio values, which is the entire point of the feature.

#### Test 17.1 - High Load Receiver Gets More Slots

**Expected behavior:** With 100 total slots and three flexible job types at equal ratios (~33 each):
- flexJobA at 97% load becomes a RECEIVER and gets > 33 slots
- flexJobB/flexJobC at 15% load become DONORS and go below 33 slots

**How to test:** Submit enough long-running flexJobA jobs to reach 97% load. Wait for `adjustmentIntervalMs` to trigger. Fetch stats and assert flexJobA's `currentRatio > 0.33` and `allocatedSlots > 33`. Assert flexJobB/C ratios decreased.

#### Test 17.2 - maxAdjustment Respected

**Expected behavior:** With `maxAdjustment = 0.2`, a single adjustment cycle should not change any ratio by more than 0.2.

**How to test:** Record ratios before triggering adjustment. After one cycle, assert `|newRatio - oldRatio| <= 0.2` for each job type.

#### Test 17.3 - minRatio Prevents Starvation

**Expected behavior:** With `minRatio = 0.01`, a donor job type's ratio should never go below 0.01, ensuring it always has at least `floor(poolSlots * 0.01)` slots.

**How to test:** Push one job type to extreme load for multiple adjustment cycles. Verify the other types' ratios never drop below `minRatio`.

#### Test 17.4 - Ratios Sum to ~1.0

**Expected behavior:** After any number of adjustment cycles, the sum of all job type ratios should equal approximately 1.0 (within 0.001).

**How to test:** After triggering adjustments, fetch all ratios and assert `Math.abs(sum - 1.0) < 0.001`.

#### Tests 17.5-17.9 - Threshold Behavior

**Expected behavior:**
- 17.5: At 60% load (below `highLoadThreshold = 0.7`), a type is NOT a receiver
- 17.6: At 20% load (below `lowLoadThreshold = 0.3`), a type IS a donor
- 17.7: At 50% load (between thresholds), a type neither donates nor receives
- 17.8: When ALL types are high load, no donors exist, so no adjustment occurs
- 17.9: When ALL types are low load, no receivers exist, so no adjustment occurs

**How to test:** For each scenario, set up the specific load level and verify ratios remain unchanged (17.7-17.9) or change in the expected direction (17.5-17.6).

---

### Daily Limits (Test 33.3)

**Why this is critical:** TPD (tokens per day) and RPD (requests per day) are distinct limit types that accumulate across minute windows. Without this test, there is no verification that daily limits work correctly in distributed mode.

#### Test 33.3 - TPD Tracked Across Minutes

**Expected behavior:** With `TPD = 200,000`:
1. Minute M: Use 80K tokens
2. Minute M+1: Use 80K more tokens
3. Minute M+2: Only 40K tokens available (200K - 160K)
4. Jobs exceeding the daily limit must wait

**How to test:** Submit jobs across 3 minute windows, verifying the TPD counter accumulates (80K, 160K) and that capacity is reduced in the third window.

---

### Cross-Instance Propagation (Tests 30.6, 30.7)

**Why these matter:** These test the specific mechanism by which one instance's refund or overage affects other instances' allocations.

#### Test 30.6 - Refund Propagates

**Expected behavior:** Instance A refunds 4,000 tokens. Global counter decreases by 4,000. Each of 2 instances gets +2,000 more capacity.

**How to test:** Submit a job to A with `actual < estimated`. After completion, fetch B's allocation and verify it increased by `refund / instanceCount`.

#### Test 30.7 - Overage Propagates

**Expected behavior:** Instance A has 5,000 token overage. B's capacity should decrease by 2,500.

**How to test:** Submit a job to A with `actual > estimated`. After completion, fetch B's allocation and verify it decreased by `overage / instanceCount`.

---

### Concurrent Atomicity (Test 29.3)

**Expected behavior:** When instances A and B each complete 10 jobs simultaneously (20 total, each 1,000 tokens), the global counter should be exactly 20,000. No race conditions should cause over- or under-counting.

**How to test:** Submit 10 jobs to each instance in parallel. After all complete, verify global usage = 20,000 exactly.

---

### Capacity Exhaustion Blocking (Test 29.5)

**Expected behavior:** When global TPM is fully consumed (100K used out of 100K), new jobs should be queued (not running). Remaining capacity = 0.

**How to test:** Consume all TPM across both instances. Submit a new job and verify it is queued (not started). Verify remaining capacity = 0.

---

### Queue Wake-Up on Window Reset (Test 40.2)

**Expected behavior:** A job queued because TPM is exhausted should automatically wake up when the minute window resets. If queued at :50, it should start at :00 (+/-1s).

**How to test:** Exhaust TPM, queue a job near the end of the minute, and measure when it starts. Assert it starts within 1 second of the minute boundary.

---

### maxWaitMS Edge Cases (Tests 14.1, 14.5, 14.8)

#### Test 14.1 - Default maxWaitMS Calculation
**Expected behavior:** When no `maxWaitMS` is configured, the system should use a default calculation (e.g., based on window size).

#### Test 14.5 - Per-Model maxWaitMS
**Expected behavior:** Different models can have different `maxWaitMS` values. Model A with `maxWaitMS = 5000` and Model B with `maxWaitMS = 30000` should timeout at their respective thresholds.

#### Test 14.8 - Simultaneous Timeout
**Expected behavior:** Multiple jobs hitting their `maxWaitMS` at the same time should all be handled correctly (delegated or rejected) without race conditions.

---

### Other Missing Tests

| Test | Expected Behavior |
|------|-------------------|
| **19.5** Single model no escalation | With only one model at zero capacity, job should be rejected immediately (no escalation chain to try) |
| **22.2** Partial usage via reject() | Job starts on alpha, uses 5K tokens, calls `reject({delegate: true})`, escalates to beta. Alpha counter should show 5K (partial usage), not 0 or 10K |

---

## WEAK Tests - Patterns and Fixes

Rather than listing all 60 weak tests individually, here are the recurring patterns and how to fix them.

---

### Pattern 1: Checking Completion Instead of Behavior (23 tests)

**Affected tests:** 13.1, 13.2, 13.4, 13.5, 15 (both), 17 Imbalance, 18.1, 18.2, 18.3, 18.5, 43.1, 46.1, 46.2, 47.2-47.4, 47.6-47.9

**Problem:** Tests submit jobs and assert "all jobs completed" or "no failures" without verifying the specific behavior being tested (queue ordering, slot counts, ratio values, memory limits, etc.).

**Example - Test 47.7 (Only Fixed Job Types - No Adjustment):**
- Doc says: verify no ratio adjustment occurred and ratios are unchanged
- Test does: submits a job, checks it completed
- A job completing proves nothing about whether ratio adjustment ran or not

**Fix pattern:** After the test scenario, fetch stats/allocation from the debug API and assert on the specific state that proves the behavior:
- Queue tests: assert on queue depth, FIFO ordering via timestamps, dequeue timing
- Ratio tests: assert on `currentRatio` values before and after
- Memory tests: assert on running/queued job counts, not just memory KB
- Edge case tests: assert on the specific edge condition (slot count = 0, ratio = 1.0, etc.)

---

### Pattern 2: Loose Tolerances (15 tests)

**Affected tests:** 14.2-14.4, 14.6, 18.2, 21.2, 29.2, 29.4, 30.1, 30.2, 31.5, 32.1, 33.2, 40.3, 46.2

**Problem:** Tests use `toBeLessThan` or `> 0` where the doc specifies exact values or tight tolerances.

**Example - Test 30.1 (Overage Reduces All Allocations):**
- Doc says: Instance B's TPM should be 12,500 and slots should be 1
- Test asserts: `tpmB <= 25,000` (2x the expected value)
- This would pass even if the propagation was only working at 50% efficiency

**Example - Test 18.2 (Memory Released on Completion):**
- Doc says: queued job start delay < 100ms
- Test allows: up to 1,000ms (10x the spec)

**Fix pattern:** Use exact values with `toBe()` or tight ranges with `toBeCloseTo()`. For timing assertions, use the documented tolerance (e.g., +/- 500ms for escalation timeout) rather than arbitrary large values.

---

### Pattern 3: Missing Specific Assertion Fields (12 tests)

**Affected tests:** 9.6, 10.2, 12.6, 19.4, 19.6, 24.1, 25.2, 25.3, 28.5, 31.1, 31.4, 34.4

**Problem:** Tests check some fields but miss the key assertion that proves the documented behavior.

**Example - Test 19.4 (Escalation Follows Defined Order):**
- Doc says: use a NON-alphabetical escalation order (gamma, alpha, beta) to prove the system respects config order
- Test uses: standard alphabetical order (alpha, beta, gamma)
- This would pass even if the system sorted models alphabetically instead of respecting config

**Example - Test 31.1 and 31.4 (Pub/Sub):**
- Doc requires: verify `dynamicLimits` field exists in the allocation message
- Test checks: only `allocation.pools` exists, never checks `dynamicLimits`

**Example - Test 25.2 (Model Independence):**
- Doc says: after filling model-alpha, submit a job to model-beta to prove it still works
- Test does: submits a job to model-alpha's job type (wrong model), proving nothing about beta's independence

**Fix pattern:** Review the documented assertion table for each test and ensure every field listed is actually asserted. For ordering tests, use non-obvious orders to prove the system doesn't rely on defaults.

---

### Pattern 4: Tests That Verify the Wrong Metric (10 tests)

**Affected tests:** 2.5, 3.6, 24.3, 27.1, 27.2, 37.3, 37.4, 38.1, 38.3, 39.1

**Problem:** Tests verify a related-but-different metric that doesn't prove the documented behavior.

**Example - Test 2.5 (Load = InFlight / Allocated):**
- Doc says: verify load percentage = 70% (inFlight=7 / allocated=10)
- Test does: checks `inFlight > 0` (would pass at 1% load)
- The helpers even define `EXPECTED_LOAD_PERCENT = 70` but never use it

**Example - Test 3.6 (freeMemoryRatio):**
- Doc says: with freeMemoryRatio=0.8, usable memory = 80MB, memory slots = 8
- Test does: checks `allocatedSlots > 0` (would pass with 1 slot)
- The helpers define `EXPECTED_FREE_RATIO_SLOTS = 8` but the assertion never uses it

**Fix pattern:** Use the constants already defined in helper files. Assert exact values rather than existence checks. The helper constants were correctly calculated -- they just need to be used in assertions.

---

## Priority Recommendations

### Immediate (High Impact, Low Effort)
1. **Fix the 3 value mismatches** (1.4, 4.3, 9.3) - align test configs/mocks with documented values
2. **Fix pattern 4 tests** (2.5, 3.6) - constants already exist in helpers, just update the assertions
3. **Fix test 19.4** - change to non-alphabetical escalation order
4. **Fix test 25.2** - submit to the correct model's job type
5. **Fix test 47.1** - use config that yields 0 slots

### Short-Term (High Impact, Medium Effort)
6. **Implement cross-window tests** (9.4, 10.4) - core architectural concept, ~2 test cases
7. **Implement propagation tests** (30.6, 30.7) - straightforward job submission + allocation check
8. **Implement capacity exhaustion** (29.5) - fill capacity, verify blocking
9. **Fix test 26.2** - create separate config preset with `estimatedRequests = 1`
10. **Fix loose tolerances** in tests 30.1, 31.5, 29.2, 29.4 - change to exact values

### Medium-Term (High Impact, High Effort)
11. **Implement ratio adjustment tests** (17.1-17.9) - requires fetching ratio values from debug API
12. **Implement queue wake-up test** (40.2) - requires precise timing around minute boundaries
13. **Fix time window tests** (27.3, 27.4) - may require debug API changes to expose window metadata

### Long-Term (Infrastructure Changes Required)
14. **Implement daily limit test** (33.3) - requires waiting across minute boundaries (slow test)
15. **Implement concurrent atomicity** (29.3) - requires precise concurrent job submission
