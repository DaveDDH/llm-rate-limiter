# Documentation vs Implementation Analysis

This document summarizes the analysis of all design documents in `/docs` against the current implementation.

**Analysis Date:** 2026-02-04

---

## Summary

| Document | Status | Key Finding |
|----------|--------|-------------|
| memory-based-slot-calculation.md | ⚠️ Partial Discrepancy | Slot reporting uses average memory instead of per-job-type |
| e2e-distributed-tests-design.md | ✅ Adapted | Tests work but architecture evolved to pool-based |
| maxWaitMS-design.md | ✅ Complete | No major discrepancies |
| actual-usage-adjustment-design.md | ✅ Complete | Minor: `requestCount` optional vs required |
| distributed-capacity-tracking-design.md | ✅ Accurate | Minor structural differences |
| distributed-slots-design.md | ⚠️ 95% Complete | Missing minCapacity enforcement |

---

## 1. memory-based-slot-calculation.md

### Summary
Describes memory-based slot calculation where each instance calculates its own memory-based slots independently, with the formula: `localMemorySlots = floor(memoryForJobType / estimatedMemoryKB)`.

### Implementation Location
- `packages/core/src/utils/memoryUtils.ts` - Memory detection
- `packages/core/src/utils/memoryManager.ts` - Per-job-type memory manager
- `packages/core/src/utils/availabilityTracker.ts` - Slot calculation

### Discrepancies

#### 1. Memory slot calculation uses AVERAGE memory, not per-job-type memory

**Document specifies:**
```
For each jobType:
  memorySlots = floor((totalMemory × ratio) / estimatedMemoryKB)
```

**Implementation (`availabilityTracker.ts` lines 249-256):**
```typescript
const avgEstimatedMemoryKB = this.getAverageEstimatedMemory(resourcesPerJob);
memorySlots = Math.floor(totalMemoryKB / avgEstimatedMemoryKB);
```

This calculates a **single global memory slot limit** using average memory across all job types, rather than per-job-type.

#### 2. Memory constraint applied globally, not per-job-type

**Document shows:**
```
jobTypeA final = min(distributed=25, local=5) = 5 slots   <- Memory limited
jobTypeB final = min(distributed=25, local=50) = 25 slots <- TPM limited
```

**Implementation:** Uses a global scaling factor applied to all pools equally.

### Impact
- **Runtime behavior is correct** - `MemoryManager` properly enforces per-job-type memory during execution
- **Reported slot counts** via `onAvailableSlotsChange` may not match the documented formula

### Recommendation
Update `availabilityTracker.ts::calculateSlotsWithMemoryConstraint()` to calculate memory slots per job type rather than using a global average.

---

## 2. e2e-distributed-tests-design.md

### Summary
Describes a comprehensive E2E test suite with 6 test suites and 15 config presets for verifying multi-dimensional slot allocation.

### Implementation Location
- `packages/e2e/serverInstance/src/rateLimiterConfigs.ts` - Config presets
- `packages/e2e/testRunner/src/__tests__/` - All 6 test suites
- `packages/e2e/testRunner/src/instanceLifecycle.ts` - Instance management

### Architectural Change: Pool-Based vs Per-Job-Type Allocation

**Document design:**
```typescript
interface AllocationInfo {
  instanceCount: number;
  slotsByJobTypeAndModel: Record<string, Record<string, ModelSlotAllocation>>;
}
```

**Actual implementation:**
```typescript
interface AllocationInfo {
  instanceCount: number;
  pools: {
    [modelId]: {
      totalSlots: number;
      tokensPerMinute: number;
      // ...
    }
  };
}
```

Redis calculates per-model slots (not per-job-type). Job type distribution is handled **locally** by each instance.

### Status
- All 6 test suites implemented and functional
- All 15 config presets match the document
- Test assertions adapted to pool-based architecture

---

## 3. maxWaitMS-design.md

### Summary
Controls how long a job waits for model capacity before delegating to the next model or rejecting.

### Implementation Location
- `packages/core/src/jobTypeTypes.ts` - Type definitions
- `packages/core/src/utils/jobExecutionHelpers.ts` - `calculateDefaultMaxWaitMS()`, `getMaxWaitMS()`
- `packages/core/src/utils/capacityWaitQueue.ts` - FIFO queue
- `packages/core/src/utils/jobDelegation.ts` - Model selection with waiting

### Status: ✅ Complete and Correct

All features implemented as documented:
- Default calculation: `(60 - currentSeconds + 5) * 1000`
- Per-model, per-job-type configuration
- Fail-fast behavior (`maxWaitMS = 0`)
- FIFO queue ordering
- Type-safe model ID validation
- Error message matches exactly

---

## 4. actual-usage-adjustment-design.md

### Summary
System for adjusting rate limiter capacity based on actual resource consumption after job completion.

### Implementation Location
- `packages/core/src/rateLimiter.ts` - `recordActualUsage()`, `emitOverageIfNeeded()`
- `packages/core/src/utils/timeWindowCounter.ts` - `subtractIfSameWindow()`
- `packages/core/src/utils/jobExecutionHelpers.ts` - `DelegationError` class
- `packages/core/src/utils/jobExecutor.ts` - `createRejectHandler()`
- `packages/redis/src/luaScripts.ts` - `RELEASE_SCRIPT`

### Minor Discrepancy

**Document says:** `requestCount` is **required** in `reject()` callback

**Implementation:** `requestCount?: number` is **optional** (defaults to 1)

This is actually more user-friendly and doesn't break the design intent.

### Status: ✅ Complete

All 8 success criteria from the document are implemented:
1. Capacity adjusted when actual differs from estimated within same time window
2. No adjustment when job crosses time-window boundary
3. Memory/concurrency always release immediately
4. Counters accurately reflect actual consumption
5. Distributed and local backends behave consistently
6. Jobs that throw without `reject()` do NOT release time-windowed capacity
7. Jobs that call `reject(usage)` trigger full adjustment flow
8. Overage events emitted when actual > estimated

---

## 5. distributed-capacity-tracking-design.md

### Summary
Tracks actual resource usage across distributed instances to ensure global limits are respected.

### Implementation Location
- `packages/redis/src/luaScripts.ts` - Lua scripts for global usage tracking
- `packages/redis/src/redisBackend.ts` - Backend implementation
- `packages/core/src/multiModelRateLimiter.ts` - `applyAllocationToLimiters()`
- `packages/core/src/rateLimiter.ts` - `setRateLimits()`

### Minor Discrepancies

#### 1. AllocationInfo structure uses `pools` instead of `slotsByJobTypeAndModel`
This is a deliberate evolution toward simpler pool-based architecture.

#### 2. Error handling without `reject()`
**Document:** Do NOT report actual usage
**Implementation:** Reports `{ requests: 0, tokens: 0 }` - achieves same goal

### Issue: Debug Logging
`multiModelRateLimiter.ts` contains `console.log` debug statements (lines 157, 161, 166, 191) that should be removed or converted to proper logging.

### Status: ✅ Accurate
Core algorithm correctly implemented. Main difference is pool-based model vs per-job-type-and-model.

---

## 6. distributed-slots-design.md

### Summary
Pool-based slot allocation system for distributed rate limiting with local job type ratio management.

### Implementation Location
- `packages/redis/src/redisBackend.ts` - Redis backend
- `packages/redis/src/luaScripts.ts` - Lua scripts
- `packages/core/src/utils/jobTypeManager.ts` - Local ratio management
- `packages/core/src/utils/jobTypeHelpers.ts` - Ratio adjustment algorithms

### Discrepancies

#### 1. No minCapacity enforcement
**Document (lines 279-282):** "Local manager guarantees minCapacity (e.g., 1)" for floor rounding edge cases

**Implementation:** `recalculateAllocatedSlots` uses `Math.floor(totalCapacity * state.currentRatio)` but does NOT enforce a minimum of 1.

**Impact:** A job type with very low ratio could get 0 slots, blocking all jobs of that type.

#### 2. Unused RedisJobTypeOps
Document states "No Job Type in Redis" but implementation includes:
- `packages/redis/src/jobTypeLuaScripts.ts`
- `packages/redis/src/redisJobTypeOps.ts`

These are not used in the main acquire/release flow. Should be documented or removed.

#### 3. Debug console.log statements
Same issue as distributed-capacity-tracking - debug logs in production code.

### Status: ⚠️ 95% Complete

---

## Cross-Cutting Issues

### 1. Pool-Based vs Per-Job-Type Architecture
Multiple documents reference per-job-type-and-model allocation, but the implementation uses pool-based (per-model only) allocation. This is a deliberate architectural evolution but the documents should be updated.

**Affected documents:**
- e2e-distributed-tests-design.md
- distributed-capacity-tracking-design.md
- distributed-slots-design.md

### 2. Debug Logging in Production Code
`console.log` statements in `multiModelRateLimiter.ts` should use the `onLog` callback or be removed.

### 3. Memory Slot Calculation
`availabilityTracker.ts` uses average memory for slot calculation instead of per-job-type memory as documented.

---

## Recommendations

1. **Update documentation** to reflect pool-based architecture or update implementation to match per-job-type design
2. **Add minCapacity enforcement** in `jobTypeHelpers.ts::recalculateAllocatedSlots()`
3. **Remove or document** `RedisJobTypeOps` functionality
4. **Fix memory slot calculation** in `availabilityTracker.ts` to match documented per-job-type behavior
5. **Clean up debug logging** - remove `console.log` or use proper logging callbacks
