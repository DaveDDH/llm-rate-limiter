# Implementation Discrepancies Report

This document summarizes discrepancies between the design documentation and actual implementation, identified through systematic code review.

---

## Summary Table

| Document | Status | Critical Issues |
|----------|--------|-----------------|
| memory-based-slot-calculation.md | ⚠️ Partial | Memory limits not enforced per-job-type |
| e2e-distributed-slots-tests.md | ✅ Aligned | None |
| maxWaitMS-design.md | ✅ 98% Aligned | Minor undocumented enhancements |
| distributed-slots-design.md | ⚠️ Significant | Ratios not local as documented |
| actual-usage-adjustment-design.md | ⚠️ 85-90% | `reject()` missing `requestCount` |
| distributed-capacity-tracking-design.md | ⚠️ Mismatches | Field names, TTL values differ |

---

## Critical Issues

### 1. `reject()` Callback Missing `requestCount` Parameter

**Document**: `docs/actual-usage-adjustment-design.md`
**Severity**: High
**Location**: `packages/core/src/utils/jobExecutor.ts:56-74`

**Design Specification** (lines 116-139):
```typescript
interface RejectUsage {
  requestCount: number;  // User should provide this
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}
```

**Actual Implementation**:
```typescript
// packages/core/src/utils/jobExecutor.ts:67
mutableState.rejectUsage = {
  requests: 1,  // HARDCODED TO 1
  tokens: usage.inputTokens + usage.outputTokens + usage.cachedTokens,
};
```

**Impact**: Jobs that make multiple API calls before failing cannot report the actual request count. RPM/RPD counters will always show 1 request regardless of actual usage.

**Fix Required**: Add optional `requestCount` field to `TokenUsageEntry` interface and use it in the reject handler instead of hardcoding to 1.

---

### 2. Dynamic Ratios Are NOT Local-Only

**Document**: `docs/distributed-slots-design.md`
**Severity**: High
**Location**: `packages/redis/src/luaScripts.ts:101-122`

**Design Specification** (line 144):
> "Ratios are intentionally LOCAL to each instance — they are not synchronized across instances via Redis."

**Actual Implementation**:
The Lua script stores fixed ratios in Redis and applies the same ratio value to ALL instances:
```lua
-- luaScripts.ts:108
local ratio = jobType.ratio
```

The `JobTypeManager` (packages/core/src/utils/jobTypeManager.ts:216-241) does adjust ratios locally, but these adjustments:
- Only affect the local `AvailabilityTracker` callback
- Do NOT propagate to the Redis backend
- Are NOT used in distributed slot calculations

**Impact**: The documented per-instance ratio optimization doesn't work in distributed deployments. All instances use identical ratios from Redis initialization.

**Fix Required**: Either update documentation to reflect actual behavior, or implement per-instance ratio submission to Redis.

---

### 3. Memory Constraints Not Enforced Per-Job-Type

**Document**: `docs/memory-based-slot-calculation.md`
**Severity**: Medium
**Location**: `packages/core/src/utils/memoryManager.ts:45-49`

**Design Specification** (Step 2-4):
```
1. Instance calculates local memory slots: floor((totalMemory × jobTypeRatio) / estimatedMemoryKB)
2. Final slots: min(distributedSlots, memorySlots) per job type
```

**Actual Implementation**:
- `MemoryManager` uses a single global semaphore with `totalMemory * freeMemoryRatio`
- Does NOT divide memory allocation by job type
- All job types share one semaphore pool

**Where it IS correct**: `AvailabilityTracker.calculateSlotsWithMemoryConstraint()` (lines 246-297) correctly calculates per-job-type memory slots, but this is only used for the `onAvailableSlotsChange` callback, not for actual job execution.

**Impact**: A memory-heavy job type can starve lighter job types. The availability callback shows correct numbers, but actual enforcement uses a simpler global pool.

**Fix Required**: Implement per-job-type memory semaphores or update documentation to reflect the simpler global approach.

---

## Medium Issues

### 4. Redis Hash Field Names Differ from Design

**Document**: `docs/distributed-capacity-tracking-design.md`
**Severity**: Medium
**Location**: `packages/redis/src/luaScripts.ts:365-384`

**Design Specification** (lines 250-266):
- TPM/RPM hash fields: `actualTokens`, `actualRequests`, `lastUpdate`

**Actual Implementation**:
```lua
-- luaScripts.ts:365
redis.call('HINCRBY', tpmKey, 'tokens', actualTokens)  -- NOT 'actualTokens'
-- luaScripts.ts:379
redis.call('HINCRBY', rpmKey, 'requests', actualRequests)  -- NOT 'actualRequests'
```

**Impact**: Documentation doesn't match implementation. The `lastUpdate` field is completely missing.

**Fix Required**: Update documentation to match implementation (preferred) or rename fields.

---

### 5. Daily Window TTL Mismatch

**Document**: `docs/distributed-capacity-tracking-design.md`
**Severity**: Low
**Location**: `packages/redis/src/luaScripts.ts:358-359`

**Design Specification** (line 268): TPD/RPD TTL should be 25 hours (90,000 seconds)

**Actual Implementation**:
```lua
local DAY_TTL = 172800   -- 48 hours (2 days)
```

**Impact**: Redis keys persist longer than documented, consuming more memory but reducing risk of premature expiration.

**Fix Required**: Decide on correct value and align documentation with code.

---

## Documented Features Working Correctly

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

**Undocumented enhancements** (working correctly, should be documented):
- Window reset notification scheduling (`rateLimiter.ts:305-319`)
- Double resolution prevention in `CapacityWaitQueue`

---

## Recommendations

### Immediate Actions
1. **Add `requestCount` to reject callback** - Critical for multi-request job tracking
2. **Update distributed-slots documentation** - Clarify that ratios are NOT local in distributed mode

### Documentation Updates
3. Update `distributed-capacity-tracking-design.md` with correct field names (`tokens`/`requests`)
4. Document the global memory semaphore approach vs. per-job-type calculation
5. Add documentation for window reset notification feature in maxWaitMS

### Future Consideration
6. Evaluate whether per-instance local ratios should be implemented as designed, or if the current global ratio approach is acceptable
7. Consider implementing per-job-type memory semaphores if isolation is required

---

## File References

| Issue | Primary Files | Key Lines |
|-------|---------------|-----------|
| reject() requestCount | `packages/core/src/utils/jobExecutor.ts` | 56-74 |
| | `packages/core/src/multiModelTypes.ts` | 248 |
| Local ratios | `packages/redis/src/luaScripts.ts` | 101-122 |
| | `packages/core/src/utils/jobTypeManager.ts` | 216-241 |
| Memory per-job-type | `packages/core/src/utils/memoryManager.ts` | 45-49 |
| | `packages/core/src/utils/availabilityTracker.ts` | 246-297 |
| Redis field names | `packages/redis/src/luaScripts.ts` | 365, 370, 379, 384 |
| Daily TTL | `packages/redis/src/luaScripts.ts` | 358-359 |
