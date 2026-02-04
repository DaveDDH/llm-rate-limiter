# Implementation Discrepancies Report

This document summarizes discrepancies between the design documentation and actual implementation, identified through systematic code review.

---

## Summary Table

| Issue | Status | Severity | Document |
|-------|--------|----------|----------|
| `reject()` missing `requestCount` | ✅ RESOLVED | High | actual-usage-adjustment-design.md |
| Local ratios not enforced | ✅ RESOLVED | High | distributed-slots-design.md |
| Memory not enforced per-job-type | 🟡 CLARIFIED | Medium | memory-based-slot-calculation.md |
| Redis field names differ | ✅ RESOLVED | Medium | distributed-capacity-tracking-design.md |
| Daily TTL mismatch | ✅ RESOLVED | Low | distributed-capacity-tracking-design.md |

---

## 🟡 Clarified Issues (Design vs Implementation Trade-offs)

### 1. Memory Constraints: Reporting vs Enforcement Layers

**Document**: `docs/memory-based-slot-calculation.md`
**Severity**: Medium
**Location**: `packages/core/src/utils/memoryManager.ts:45-49`

**Design Specification** (Step 2-4):
```
1. Instance calculates local memory slots: floor((totalMemory × jobTypeRatio) / estimatedMemoryKB)
2. Final slots: min(distributedSlots, memorySlots) per job type
```

**What Works Correctly (Reporting Layer)**:
- `AvailabilityTracker.calculateSlotsWithMemoryConstraint()` correctly calculates per-job-type memory slots ✅
- `onAvailableSlotsChange` callback reports correct memory-constrained availability ✅

**What Uses Simpler Approach (Enforcement Layer)**:
- `MemoryManager` uses a single global semaphore with `totalMemory * freeMemoryRatio`
- Does NOT divide memory allocation by job type
- All job types share one semaphore pool

**Impact**:
- **Memory-heavy jobs could theoretically starve lighter jobs** if all slots are consumed by heavy jobs
- **In practice**, other limits (TPM, RPM, concurrent, pool slots) usually constrain jobs first
- Availability callback shows correct numbers, allowing clients to implement backpressure

**Resolution Options**:
1. **Accept current behavior** - Document that memory enforcement uses global pool (simpler, fewer semaphores)
2. **Implement per-job-type semaphores** - More complex, but matches design spec exactly

---

## ✅ Resolved Issues

### 2. Local Ratios ~~Not Enforced~~ (FIXED via Pool-Based Slots)

**Document**: `docs/distributed-slots-design.md`
**Resolved**: 2024-02-04

**Original Issue**: Redis calculated slots with ratios baked in at startup (`slots[jobType][model] = capacity * ratio`). When local `JobTypeManager` adjusted ratios dynamically, these changes only affected the reporting layer (callbacks), not the enforcement layer (Redis slots).

Example of the problem:
```
Redis allocated: 10 slots for jobTypeA (based on 0.6 ratio)
Local ratio changed: jobTypeA → 0.9 ratio
Instance tried to acquire slot #11
Redis blocked it: "You only have 10 jobTypeA slots"
```

**Resolution**: Implemented **pool-based slot allocation**:
- Redis now tracks capacity **per-model only** (not per job type)
- Local instances distribute pool slots across job types using local ratios
- Dynamic ratio adjustments take effect immediately

New flow:
```
Redis allocates: pool["gpt-4"].totalSlots = 10 (per-model, no ratio)
Local distribution: jobTypeA gets floor(10 * 0.9) = 9 slots
Acquire: Two-layer check (local job type + Redis pool)
```

**Key Changes**:
- `AllocationInfo` structure: `slotsByJobTypeAndModel` → `pools[modelId]`
- `ACQUIRE_SCRIPT`: Now model-only, no job type parameter
- `REALLOCATION_LOGIC`: Removed ratio multiplication, calculates per-model pools
- Local `JobTypeManager`: Distributes pool slots using local ratios

---

### 3. `reject()` Callback ~~Missing `requestCount`~~ (FIXED)

**Document**: `docs/actual-usage-adjustment-design.md`
**Resolved**: 2024-02-04

**Original Issue**: The reject handler hardcoded `requests: 1` instead of allowing users to provide the actual request count for jobs that make multiple API calls before failing.

**Resolution**: Added optional `requestCount` field to `TokenUsageEntry` interface in `packages/core/src/multiModelTypes.ts`. Updated reject handler in `packages/core/src/utils/jobExecutor.ts` to use `usage.requestCount ?? 1`.

---

### 4. Redis Hash Field Names ~~Differ from Design~~ (FIXED)

**Document**: `docs/distributed-capacity-tracking-design.md`
**Resolved**: 2024-02-04

**Original Issue**: Implementation used `tokens`/`requests` instead of `actualTokens`/`actualRequests`, and `lastUpdate` field was missing.

**Resolution**: Updated `packages/redis/src/luaScripts.ts` to use correct field names (`actualTokens`, `actualRequests`) and added `lastUpdate` timestamp field.

---

### 5. Daily Window TTL ~~Mismatch~~ (FIXED)

**Document**: `docs/distributed-capacity-tracking-design.md`
**Resolved**: 2024-02-04

**Original Issue**: Implementation used `DAY_TTL = 172800` (48 hours) instead of design spec of 25 hours (90,000 seconds).

**Resolution**: Updated `packages/redis/src/luaScripts.ts` to use `DAY_TTL = 90000` (25 hours) as specified in design.

---

## Documented Features Working Correctly

### distributed-slots-design.md
Pool-based slot allocation fully implemented:
- Redis allocates per-model pools (not per job type)
- Local instances distribute pools using local ratios
- Two-layer acquire check (local + Redis)
- Dynamic ratio adjustments work immediately
- Fixed ratio protection enforced locally

### e2e-distributed-slots-tests.md
All 6 test suites fully implemented:
- Slot calculation (TPM, RPM, TPD, RPD, concurrent)
- Instance scaling
- Fixed ratio isolation
- Flexible ratio adjustment
- Local ratio only
- Slots evolve with load

### maxWaitMS-design.md
Core features correctly implemented:
- Default calculation (5-65 seconds based on time to next minute)
- FIFO queue with timeout
- Model escalation on timeout
- Type-safe configuration
- Active job tracking with `waitStartedAt`, `maxWaitMS`, `timeoutAt`

### distributed-capacity-tracking-design.md
Core features correctly implemented:
- Global usage tracking in Redis per model per time window
- Dynamic limits calculation based on remaining capacity
- Pub/Sub broadcast of allocations with `dynamicLimits`
- Instances update local rate limiters via `setRateLimits()`

---

## Recommendations

### Documentation Updates
1. **Update memory-based-slot-calculation.md** - Add section explaining:
   - Availability callback correctly reports per-job-type memory constraints
   - Actual enforcement uses global memory pool (simpler, fewer semaphores)

### Future Consideration (Optional)
2. **Per-job-type memory semaphores** - Would match design spec exactly; adds complexity

### Design Note
The implementation now correctly separates concerns:
- **Redis**: Global coordination, per-model capacity, actual usage tracking
- **Local**: Ratio management, job type distribution, memory enforcement

The only remaining trade-off is memory enforcement using a global pool instead of per-job-type semaphores. This is acceptable because other limits (TPM, RPM, pool slots) typically constrain jobs before memory becomes an issue.

---

## File References

| Issue | Status | Primary Files | Key Lines |
|-------|--------|---------------|-----------|
| Pool-based slots | ✅ RESOLVED | `luaScripts.ts`, `multiModelTypes.ts`, `jobTypeManager.ts` | REALLOCATION_LOGIC, AllocationInfo |
| Memory layers | 🟡 CLARIFIED | `memoryManager.ts`, `availabilityTracker.ts` | 45-49, 246-297 |
| reject() requestCount | ✅ RESOLVED | `multiModelTypes.ts`, `jobExecutor.ts` | TokenUsageEntry, 65-69 |
| Redis field names | ✅ RESOLVED | `luaScripts.ts` | 365-387 |
| Daily TTL | ✅ RESOLVED | `luaScripts.ts` | 359 |
