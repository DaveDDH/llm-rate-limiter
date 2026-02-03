# Failing E2E Tests for maxWaitMS Feature

## Summary

11 of 18 e2e tests pass. The 7 failing tests all involve scenarios where a waiting job should detect released capacity and proceed. The core maxWaitMS functionality (fail-fast, timeout, escalation) works correctly.

## Failing Tests

### 1. Basic Tests (`maxWaitMS.basic.e2e.test.ts`)

| Test | Description | Issue |
|------|-------------|-------|
| 1.2 maxWaitMS > 0 - Job waits for capacity | `waits and succeeds when capacity becomes available` | Times out waiting for released capacity to be detected |

### 2. Distributed Tests (`maxWaitMS.distributed.e2e.test.ts`)

| Test | Description | Issue |
|------|-------------|-------|
| 2.1 Cross-instance capacity release | `Instance A waiting job gets capacity when Instance B completes job` | Times out waiting for cross-instance capacity release |
| 2.2 Three instances coordination | `job completes on one, waiting job on another wakes` | Times out waiting for capacity coordination |
| 2.3 Multiple instances with waiting jobs | `both waiting jobs eventually complete` | Times out waiting for sequential capacity releases |

### 3. Enforcement Tests (`maxWaitMS.enforcement.e2e.test.ts`)

| Test | Description | Issue |
|------|-------------|-------|
| 3.1 Capacity limit enforcement | `cannot exceed capacity even with many waiting jobs` | Times out - likely job type capacity blocking |
| 3.2 Single slot release behavior | `multiple waiting jobs + 1 slot released - only 1 job executes immediately` | Times out waiting for released slot detection |

## Root Cause Analysis

All failing tests share a common pattern: they expect a waiting job to detect when capacity becomes available after another job releases it. The issue appears to be in the capacity polling mechanism:

1. **Polling Detection**: The `waitForSpecificModelCapacity` function polls `hasCapacity()` at regular intervals, but released capacity may not be detected quickly enough.

2. **Job Type vs Model Capacity**: There are two levels of capacity management:
   - Job type slots (managed by `JobTypeManager`)
   - Model capacity (managed by individual model rate limiters)

   The `maxWaitMS` feature only applies to model capacity waiting, not job type slot acquisition. Jobs may be getting stuck waiting indefinitely for job type slots.

3. **Cross-Instance Coordination**: For distributed tests, capacity changes need to propagate through Redis pub/sub, which may have timing issues.

## Passing Tests (for reference)

The following tests pass, confirming core maxWaitMS functionality works:

- 1.1 `maxWaitMS: 0` - Job fails fast when no capacity available
- 1.3 `maxWaitMS > 0` - Job timeout behavior (times out when capacity never available)
- 3.3 Timeout cleanup - timed-out jobs are properly cleaned from queue
- 4.1 Immediate escalation with `maxWaitMS: 0`
- 4.2 Wait and get capacity (single model)
- 4.3 Timeout-based escalation
- 4.4 Different maxWaitMS per model
- 5.1 Low priority with fail-fast
- 5.2 Different maxWaitMS values per job type
- 7.1 Exact capacity - job executes immediately
- 7.2 Very short timeout (100ms) works correctly

## Recommended Next Steps

1. **Investigate Polling Mechanism**: Review how `waitForSpecificModelCapacity` detects released capacity and whether the polling interval is appropriate.

2. **Add Capacity Release Notification**: Consider implementing an event-based notification when capacity is released instead of relying solely on polling.

3. **Review Job Type Manager**: The `JobTypeManager.acquire()` method waits indefinitely without respecting `maxWaitMS`. Consider adding timeout support at the job type level.

4. **Test Redis Pub/Sub Timing**: For distributed tests, verify that capacity change notifications are being published and received correctly through Redis.
