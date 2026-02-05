# E2E Tests for Distributed Slots

This document describes the end-to-end test suites for verifying the pool-based slot allocation system in the distributed rate limiter.

## Overview

The distributed slots feature implements a **pool-based** slot allocation system:

- **Redis** calculates per-model pools using **averaged estimates** across all job types:
  `pools[model].totalSlots = floor(modelCapacity / avgEstimatedResource / instanceCount)`
- **Local instances** distribute pool slots across job types using ratios

This separation allows dynamic ratio adjustments without Redis round-trips.

**Important:** Redis uses the **average** of all job type estimates (not per-job-type calculation). This simplifies Redis logic while local instances handle the per-job-type distribution via ratios.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                            REDIS                                 │
│                                                                  │
│  Tracks per-model pools only (no job type awareness):           │
│  pools['model-alpha'] = { totalSlots: 10, tokensPerMinute: 50K } │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │Instance A│    │Instance B│    │Instance C│
        │          │    │          │    │          │
        │ Local    │    │ Local    │    │ Local    │
        │ JobType  │    │ JobType  │    │ JobType  │
        │ Manager  │    │ Manager  │    │ Manager  │
        │          │    │          │    │          │
        │ Ratios:  │    │ Ratios:  │    │ Ratios:  │
        │ A: 0.6   │    │ A: 0.5   │    │ A: 0.7   │
        │ B: 0.4   │    │ B: 0.5   │    │ B: 0.3   │
        └──────────┘    └──────────┘    └──────────┘
```

Each instance can have different local ratios (due to different load patterns), but they all share the same per-model pool allocation from Redis.

## Test Configuration Presets

Tests use different configuration presets defined in `packages/e2e/serverInstance/src/rateLimiterConfigs.ts`:

### Core Presets

| Preset            | Models                      | Job Types                           | Purpose                          |
| ----------------- | --------------------------- | ----------------------------------- | -------------------------------- |
| `default`         | 3 (openai, xai, deepinfra)  | 5 (summary, VacationPlanning, etc.) | Original production-like config  |
| `slotCalculation` | 2 (model-alpha, model-beta) | 2 (jobTypeA, jobTypeB)              | Simple verifiable slot math      |
| `fixedRatio`      | 1 (test-model)              | 3 (fixedJobType, flexibleJobTypeA, flexibleJobTypeB) | Fixed vs flexible ratio behavior |
| `flexibleRatio`   | 1 (flex-model)              | 3 (flexJobA, flexJobB, flexJobC)    | Dynamic ratio adjustment         |
| `instanceScaling` | 1 (scale-model)             | 1 (scaleJob)                        | Instance join/leave behavior     |

### Slot Calculation Presets (for testing specific limit types)

| Preset                   | Model Limits                | Job Types                    | Purpose                          |
| ------------------------ | --------------------------- | ---------------------------- | -------------------------------- |
| `slotCalc-tpm`           | TPM only (100K)             | 2 (jobTypeA, jobTypeB)       | TPM-based slot calculation       |
| `slotCalc-rpm`           | RPM only (500)              | 2 (jobTypeA, jobTypeB)       | RPM-based slot calculation       |
| `slotCalc-tpd`           | TPD only (1M)               | 2 (jobTypeA, jobTypeB)       | TPD-based slot calculation       |
| `slotCalc-rpd`           | RPD only (10K)              | 2 (jobTypeA, jobTypeB)       | RPD-based slot calculation       |
| `slotCalc-concurrent`    | maxConcurrent only (100)    | 2 (jobTypeA, jobTypeB)       | Concurrency-based calculation    |
| `slotCalc-tpm-rpm`       | TPM (100K) + RPM (50)       | 2 (jobTypeA, jobTypeB)       | Mixed limits (limiting factor)   |
| `slotCalc-multi-model`   | model-tpm: TPM, model-concurrent: concurrent | 2 (jobTypeA, jobTypeB) | Different limit types per model  |
| `slotCalc-ratios`        | TPM (100K)                  | 3 (0.5, 0.3, 0.2 ratios)     | Various ratio combinations       |
| `slotCalc-uneven-ratios` | TPM (100K)                  | 4 (0.7, 0.1, 0.1, 0.1 ratios)| Uneven ratio distribution        |
| `slotCalc-memory`        | TPM (10M, very high)        | 2 (heavyMemoryJob: 10MB, lightMemoryJob: 1MB) | Memory as local constraint |

---

## Test Suites (Ordered by Complexity)

---

### 1. Slot Calculation (`slotCalculation.test.ts`)

**Complexity:** Low

**Purpose:** Check that the pool-based slot calculations work correctly with different model and instance combinations. This does not test load, does not queue any job, we only need to verify the initial pool allocation math works.

**Approach:**
1. Reset instances with a specific config preset
2. Query the allocation endpoint (`GET /api/debug/allocation`) from each instance
3. Verify `pools[modelId].totalSlots` against mathematically calculated expected values
4. Repeat for multiple config presets covering all limit type combinations

**Pool Calculation Formula:**

Redis calculates pool slots using **averaged estimates** across all job types:

```
Step 1: Calculate average estimates across all job types
  avgEstimatedTokens = sum(jobType.estimatedTokens) / jobTypeCount
  avgEstimatedRequests = sum(jobType.estimatedRequests) / jobTypeCount

Step 2: Calculate per-limit-type slots using averages
  For TPM-limited models:
    pools[model].totalSlots = floor((TPM / avgEstimatedTokens) / instanceCount)
    pools[model].tokensPerMinute = TPM / instanceCount

  For RPM-limited models:
    pools[model].totalSlots = floor((RPM / avgEstimatedRequests) / instanceCount)
    pools[model].requestsPerMinute = RPM / instanceCount

  For concurrent-limited models:
    pools[model].totalSlots = floor(maxConcurrent / instanceCount)

  For mixed limits:
    pools[model].totalSlots = min(tpm_slots, rpm_slots, concurrent_slots, ...)
```

**Note:** Job type ratios are NOT part of Redis pool calculation. Ratios are applied locally by each instance's JobTypeManager.

#### Test Case 1: TPM-Only Model (`slotCalc-tpm`)

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000, ratio = 0.6
jobTypeB: estimatedTokens = 5,000, ratio = 0.4
```

**Note:** Pool slots use averaged estimates: `avgTokens = (10,000 + 5,000) / 2 = 7,500`

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| `allocation.pools['model-alpha'].totalSlots` | `floor((100K / 7,500) / 2)` | 6 |
| `allocation.pools['model-alpha'].tokensPerMinute` | `100K / 2` | 50,000 |
| Local jobTypeA slots | `floor(6 * 0.6)` | 3 (managed locally) |
| Local jobTypeB slots | `floor(6 * 0.4)` | 2 (managed locally) |

#### Test Case 2: RPM-Only Model (`slotCalc-rpm`)

**Config:**
```
model-beta: RPM = 500
jobTypeA: estimatedRequests = 1, ratio = 0.6
jobTypeB: estimatedRequests = 5, ratio = 0.4
```

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| `allocation.pools['model-beta'].totalSlots` | `floor((500 / 1) / 2)` | 250 |
| `allocation.pools['model-beta'].requestsPerMinute` | `500 / 2` | 250 |

#### Test Case 3: Concurrent-Only Model (`slotCalc-concurrent`)

**Config:**
```
model-gamma: maxConcurrentRequests = 100
jobTypeA: ratio = 0.7
jobTypeB: ratio = 0.3
```

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| `allocation.pools['model-gamma'].totalSlots` | `floor(100 / 2)` | 50 |

#### Test Case 4: Mixed Limits - Limiting Factor (`slotCalc-tpm-rpm`)

**Config:**
```
model-delta: TPM = 100,000, RPM = 50
jobTypeA: estimatedTokens = 10,000, estimatedRequests = 1, ratio = 0.5
```

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| TPM-based slots | `floor((100K / 10K) / 2)` | 5 |
| RPM-based slots | `floor((50 / 1) / 2)` | 25 |
| `allocation.pools['model-delta'].totalSlots` | `min(5, 25)` | 5 (TPM is limiting) |

#### Test Case 5: Multiple Models (`slotCalc-multi-model`)

**Config:**
```
model-tpm: TPM = 100,000
model-concurrent: maxConcurrentRequests = 50
jobTypeA: estimatedTokens = 10,000, ratio = 0.5
```

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| `allocation.pools['model-tpm'].totalSlots` | `floor((100K / 10K) / 2)` | 5 |
| `allocation.pools['model-concurrent'].totalSlots` | `floor(50 / 2)` | 25 |

#### Test Case 6: Instance Count Variations

Run each config with 1, 2, and 3 instances to verify instance division:

| Instance Count | Pool Slot Division |
|----------------|-------------------|
| 1 instance | Full capacity |
| 2 instances | Half per instance |
| 3 instances | Third per instance |

**Key Verification:** The allocation endpoint returns mathematically correct pool slot values for ALL combinations of limit types and instance counts. Job type distribution is verified separately as a local concern.

#### Test Case 7: Memory-Based Slot Calculation (`slotCalc-memory`)

**Config:**
```
test-model: TPM = 10,000,000 (very high, won't be limiting)
heavyMemoryJob: estimatedTokens = 1,000, estimatedMemoryKB = 10,240 (10MB), ratio = 0.5
lightMemoryJob: estimatedTokens = 1,000, estimatedMemoryKB = 1,024 (1MB), ratio = 0.5
```

**Key Concept:** Memory is a **LOCAL** constraint. Redis calculates distributed slots based on TPM (very high), but each instance limits final slots based on available memory.

```
Distributed slots (from Redis, very high due to high TPM):
  pools['test-model'].totalSlots = floor((10M / 1K) / 2) = 5000 per instance

Local memory constraint (assuming 100MB instance memory):
  heavyMemoryJob memory = 100MB × 0.5 = 50MB → floor(50MB / 10MB) = 5 slots
  lightMemoryJob memory = 100MB × 0.5 = 50MB → floor(50MB / 1MB) = 50 slots

Final slots (min of distributed and local):
  heavyMemoryJob = min(5000, 5) = 5 slots   ← Memory limited
  lightMemoryJob = min(5000, 50) = 50 slots ← Memory limited
```

| What We Check | Expected Result |
|---------------|-----------------|
| `allocation.pools['test-model'].totalSlots` | Very high (5000+) |
| Memory stats present | `stats.memory.maxCapacityKB > 0` |
| Heavy job capacity | Limited by memory, not distributed slots |

**Key Verification:** Memory acts as a local constraint that can further limit slots beyond the distributed allocation. This is tested via the stats endpoint showing memory configuration.

---

### 2. Fixed Ratio Isolation (`fixedRatioIsolation.test.ts`)

**Complexity:** Low

**Purpose:** Check that if there are three job types, and one of them (fixedJobType) is not flexible, then filling the capacity of the flexible types should not alter the capacity of the fixed type.

**Config:** `fixedRatio`
```
test-model: 100K TPM
fixedJobType: 10K tokens/job, ratio 0.4, flexible: false
flexibleJobTypeA: 10K tokens/job, ratio 0.3, flexible: true
flexibleJobTypeB: 10K tokens/job, ratio 0.3, flexible: true
```

**Pool Calculation (2 instances):**
```
pools['test-model'].totalSlots = floor((100,000 / 10,000) / 2) = 5 per instance
```

**Local Distribution (per instance):**
```
fixedJobType:     floor(5 * 0.4) = 2 slots (protected)
flexibleJobTypeA: floor(5 * 0.3) = 1 slot (can adjust)
flexibleJobTypeB: floor(5 * 0.3) = 1 slot (can adjust)
```

#### Test Case 1: Fixed Job Type Maintains Capacity

| What We Check                | Expected Result                      |
| ---------------------------- | ------------------------------------ |
| fixedJobType completions     | All fixedJobType jobs complete       |
| flexibleJobTypeA completions | All flexibleJobTypeA jobs complete   |
| flexibleJobTypeB completions | All flexibleJobTypeB jobs complete   |
| Failed jobs                  | No jobs fail                         |

#### Test Case 2: Fixed Ratio Not Affected by Flexible Overload

| What We Check                                             | Expected Result                                      |
| --------------------------------------------------------- | ---------------------------------------------------- |
| fixedJobType completions when flexible types overloaded   | All fixedJobType jobs complete                       |
| fixedJobType queue duration                               | fixedJobType jobs complete quickly (< 2s queue time) |
| flexibleJobTypeA completions                              | All eventually complete (some wait for capacity)     |
| Failed jobs                                               | No jobs fail                                         |

**Key Verification:** Even when both flexible types are overloaded and rebalancing ratios between themselves, fixedJobType maintains its protected slots and cannot donate or receive capacity.

---

### 3. Slots Evolve With Load (`slotsEvolveWithLoad.test.ts`)

**Complexity:** Medium

**Purpose:** Check that the calculated slots evolve properly over time, when load increases and decreases.

**Config:** `slotCalculation`

#### Test Case 1: Sequential Acquire and Release

| What We Check                | Expected Result                                |
| ---------------------------- | ---------------------------------------------- |
| Batch 1 completions          | All complete                                   |
| Batch 2 completions          | All complete (reusing freed slots)             |
| Batch 1 queue duration       | Batch 1 completes quickly (immediate capacity) |
| Failed jobs                  | No jobs fail                                   |

**Key Verification:** After Batch 1 completes and frees slots, Batch 2 can immediately use those freed slots.

#### Test Case 2: Concurrent Load with Slot Reuse

| What We Check              | Expected Result           |
| -------------------------- | ------------------------- |
| Long jobs completions      | All long jobs complete    |
| Short jobs completions     | All short jobs complete   |
| Failed jobs                | No jobs fail              |

**Key Verification:** Short jobs wait while long jobs occupy slots, then acquire slots as long jobs complete.

---

### 4. Instance Scaling (`instanceScaling.test.ts`)

**Complexity:** Medium-High

**Purpose:** Check that if instance B joins AFTER instance A has joined, A's pool slots halve. Check that if instance B disconnects, A's pool slots double.

**Config:** `instanceScaling`
```
scale-model: 100K TPM
scaleJob: 10K tokens/job, ratio 1.0
```

**Pool Calculation:**
```
1 instance: pools['scale-model'].totalSlots = floor((100,000 / 10,000) / 1) = 10 slots
2 instances: pools['scale-model'].totalSlots = floor((100,000 / 10,000) / 2) = 5 slots per instance
3 instances: pools['scale-model'].totalSlots = floor((100,000 / 10,000) / 3) = 3 slots per instance
```

#### Test Case 1: Instance A Starts Alone

| What We Check | Expected Result |
|---------------|-----------------|
| Boot instance A | Instance A starts successfully |
| `allocation.pools['scale-model'].totalSlots` | 10 |
| `allocation.instanceCount` | 1 |

#### Test Case 2: Instance B Joins - A's Pool Slots Halve

| What We Check | Expected Result |
|---------------|-----------------|
| Boot instance B (while A running) | Instance B starts successfully |
| Query A's `allocation.pools['scale-model'].totalSlots` | 5 |
| Query B's `allocation.pools['scale-model'].totalSlots` | 5 |
| `allocation.instanceCount` on both | 2 |

#### Test Case 3: Instance B Leaves - A's Pool Slots Double

| What We Check | Expected Result |
|---------------|-----------------|
| Kill instance B | Instance B shuts down gracefully |
| Query A's `allocation.pools['scale-model'].totalSlots` | 10 |
| `allocation.instanceCount` on A | 1 |

**Key Verification:** Pool slots redistribute correctly through multiple join/leave cycles.

---

### 5. Flexible Ratio Adjustment (`flexibleRatioAdjustment.test.ts`)

**Complexity:** High

**Purpose:** Check that if there are several job types and they have flexible behavior, their ratios are adjusted locally depending on the load.

**Config:** `flexibleRatio`
```
flex-model: 100K TPM
flexJobA: 10K tokens/job, ratio ~0.33, flexible: true
flexJobB: 10K tokens/job, ratio ~0.33, flexible: true
flexJobC: 10K tokens/job, ratio ~0.33, flexible: true
```

**Pool Calculation (2 instances):**
```
pools['flex-model'].totalSlots = floor((100,000 / 10,000) / 2) = 5 per instance
```

**Initial Local Distribution:**
Each job type gets ~1-2 slots locally based on 0.33 ratio.

#### Test Case 1: All Flexible Job Types Complete (Baseline)

| What We Check        | Expected Result |
| -------------------- | --------------- |
| flexJobA completions | All complete    |
| flexJobB completions | All complete    |
| flexJobC completions | All complete    |
| Failed jobs          | No jobs fail    |

#### Test Case 2: Load Imbalance Handling

| What We Check                       | Expected Result |
| ----------------------------------- | --------------- |
| flexJobA completions (heavy load)   | All complete    |
| flexJobB completions (minimal load) | All complete    |
| flexJobC completions (minimal load) | All complete    |
| Failed jobs                         | No jobs fail    |

**Key Verification:** flexJobA can complete more jobs than its initial allocation because idle flexJobB and flexJobC donate capacity through local ratio adjustment.

---

### 6. Local Ratio Only (`localRatioOnly.test.ts`)

**Complexity:** Highest

**Purpose:** Check that the dynamic ratio is LOCAL only - not shared across instances via Redis.

**Config:** `flexibleRatio` (same as test 5)

#### Test Case 1: Independent Instance Ratio Management

**Scenario:**
1. Both instances start with equal pool allocations from Redis
2. Instance A receives heavy flexJobA load (triggers local ratio adjustment on A)
3. Instance B receives flexJobB jobs (uses B's unmodified local ratios)

| What We Check                     | Expected Result           |
| --------------------------------- | ------------------------- |
| Instance A heavy load completions | All complete              |
| Instance B jobs completions       | All complete              |
| Instance B queue duration         | B's jobs complete quickly |
| Failed jobs                       | No failures               |

**Key Verification:** Instance A's local ratio adjustment does NOT affect Instance B's pool allocation or local ratios. Each instance manages its own local ratio state.

#### Test Case 2: Pool Allocation Verification

| What We Check                     | Expected Result           |
| --------------------------------- | ------------------------- |
| Both instances have pool data     | `allocation.pools` exists |
| Same pool allocation from Redis   | `pools['flex-model'].totalSlots` equal on both |
| Pool not reduced by A's load      | B's pool slots unchanged  |

**Key Verification:** Redis provides the same per-model pools to all instances. Local ratio adjustments don't affect Redis allocations.

---

## Summary: What Each Test Proves

| Test                      | What It Checks                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slot Calculation          | Pool-based slot calculations work correctly with different model and instance combinations                                                                              |
| Slots Evolve With Load    | Pool slots are properly released and reused over time                                                                                                                  |
| Fixed Ratio Isolation     | Fixed job types maintain protected capacity, cannot donate or receive from flexible types                                                                              |
| Flexible Ratio Adjustment | Local job type ratios adjust based on load (within each instance)                                                                                                      |
| Local Ratio Only          | Local ratio adjustments are NOT shared via Redis - each instance manages its own ratios                                                                                |
| Instance Scaling (Join)   | When instance B joins, pool slots are divided (A's allocation halves)                                                                                                  |
| Instance Scaling (Leave)  | When instance B leaves, pool slots are recombined (A's allocation doubles)                                                                                             |

---

## Data Structures

### AllocationInfo (from Redis)

```typescript
interface AllocationInfo {
  instanceCount: number;
  pools: {
    [modelId: string]: {
      totalSlots: number;
      tokensPerMinute: number;
      requestsPerMinute: number;
      tokensPerDay: number;
      requestsPerDay: number;
    };
  };
  dynamicLimits?: {
    [modelId: string]: {
      tokensPerMinute?: number;
      requestsPerMinute?: number;
      tokensPerDay?: number;
      requestsPerDay?: number;
    };
  };
}
```

### Local JobTypeManager State

Each instance maintains local state:

```typescript
interface JobTypeState {
  currentRatio: number;      // Can change based on local load
  initialRatio: number;      // From config
  flexible: boolean;         // Can donate/receive capacity
  inFlight: number;          // Current jobs running
  allocatedSlots: number;    // floor(poolSlots * currentRatio)
}
```

---

## Running the Tests

### Prerequisites

A Redis instance must be running on `localhost:6379` before executing the tests.

### Self-Contained Tests

All e2e tests are self-contained: they boot their own instances and proxy programmatically, requiring only Redis to be running beforehand. Each test:
1. Cleans Redis before starting
2. Boots fresh server instances with the appropriate config preset
3. Boots the proxy (if needed)
4. Runs the test scenarios
5. Tears down all infrastructure after completion

This design ensures:
- Tests are isolated and don't interfere with each other
- Tests can be run in any order
- CI/CD environments can run tests without manual setup
- Tests can control instance count dynamically for scaling scenarios

### Infrastructure Lifecycle Functions

```typescript
import { bootInstance, killInstance, killAllInstances, cleanRedis } from '../instanceLifecycle.js';
import { bootProxy, killProxy } from '../proxyLifecycle.js';
```

| Function | Description |
|----------|-------------|
| `bootInstance(port, configPreset)` | Boot a server instance on the specified port with a config preset |
| `killInstance(port)` | Kill a specific instance by port |
| `killAllInstances()` | Kill all managed instances |
| `bootProxy(targetPorts, port?)` | Boot the proxy, routing to the specified target ports |
| `killProxy()` | Kill the proxy |
| `cleanRedis()` | Delete all rate limiter keys from Redis |

#### Example: Infrastructure Boot Test

```typescript
import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import { bootProxy, killProxy } from '../proxyLifecycle.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';

const PROXY_PORT = 3000;
const INSTANCE_PORT_1 = 3001;
const INSTANCE_PORT_2 = 3002;

/** Boot all infrastructure components */
const bootInfrastructure = async (): Promise<void> => {
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_1, 'default');
  await bootInstance(INSTANCE_PORT_2, 'default');
  await bootProxy([INSTANCE_PORT_1, INSTANCE_PORT_2], PROXY_PORT);
};

/** Tear down all infrastructure components */
const teardownInfrastructure = async (): Promise<void> => {
  try { await killProxy(); } catch { /* may not have started */ }
  try { await killAllInstances(); } catch { /* may not have started */ }
};

describe('My Test', () => {
  beforeAll(async () => {
    await bootInfrastructure();
    // ... run test setup
  }, 60000);

  afterAll(async () => {
    await teardownInfrastructure();
  }, 30000);

  it('should work', () => {
    // ... assertions
  });
});
```

#### Example: Dynamic Instance Scaling Test

```typescript
import { bootInstance, killInstance, cleanRedis, fetchAllocation } from '../instanceLifecycle.js';

describe('Instance Scaling', () => {
  beforeAll(async () => {
    await cleanRedis();
  });

  afterAll(async () => {
    await killAllInstances();
  });

  it('should halve slots when second instance joins', async () => {
    // Start with one instance
    await bootInstance(3001, 'instanceScaling');
    let allocation = await fetchAllocation(3001);
    expect(allocation.allocation?.instanceCount).toBe(1);
    const initialSlots = allocation.allocation?.pools['scale-model']?.totalSlots;

    // Add second instance
    await bootInstance(3002, 'instanceScaling');
    allocation = await fetchAllocation(3001);
    expect(allocation.allocation?.instanceCount).toBe(2);
    expect(allocation.allocation?.pools['scale-model']?.totalSlots).toBe(Math.floor(initialSlots / 2));

    // Remove second instance
    await killInstance(3002);
    // Wait for Redis to detect instance timeout...
  });
});
```

#### Config Presets

When calling `bootInstance(port, configPreset)`, use one of these presets:

| Preset | Use Case |
|--------|----------|
| `'default'` | Production-like config with 3 models and 5 job types |
| `'slotCalculation'` | Simple config for verifying slot math |
| `'fixedRatio'` | Testing fixed vs flexible job type behavior |
| `'flexibleRatio'` | Testing dynamic ratio adjustment |
| `'instanceScaling'` | Testing instance join/leave scenarios |
| `'slotCalc-tpm'` | TPM-only model for slot calculation tests |
| `'slotCalc-rpm'` | RPM-only model for slot calculation tests |
| `'slotCalc-concurrent'` | Concurrency-only model for slot calculation tests |

See `packages/e2e/serverInstance/src/rateLimiterConfigs/` for all available presets.

### Execute Tests

Ensure Redis is running on `localhost:6379`, then run the tests:

```bash
# Run all e2e tests
npm run e2e:test

# Run a specific test
npm run e2e:test -- --testPathPatterns=exactCapacity.test

# Run tests by category
npm run e2e:test -- --testPathPatterns=slotCalculation.test
npm run e2e:test -- --testPathPatterns=instanceScaling.test
```

### Recommended Execution Order

For debugging, run tests in order of complexity:

1. `slotCalculation` - Validates basic pool math
2. `fixedRatioIsolation` - Validates ratio protection
3. `slotsEvolveWithLoad` - Validates temporal behavior
4. `instanceScaling` - Validates instance dynamics
5. `flexibleRatioAdjustment` - Validates local ratio algorithm
6. `localRatioOnly` - Validates cross-instance isolation

---

## Troubleshooting

### "All models rejected by backend"

This error indicates the backend has no available pool slots. Check:
1. Instance count matches expected (pool slots are divided by instance count)
2. Model has capacity configured (TPM, RPM, or maxConcurrent)
3. Job type is configured in `resourceEstimationsPerJob`

### Jobs timing out

Increase `waitTimeoutMs` in the test configuration. Some tests with long-running jobs need 60-90 seconds.

### Inconsistent slot counts

Ensure Redis is clean between test runs. The first instance reset should use `cleanRedis: true`.

### Ratio not adjusting

The ratio adjustment algorithm only runs:
- Periodically (based on `adjustmentIntervalMs`, default 5000ms)
- After N releases (based on `releasesPerAdjustment`, default 10)

Ensure the test runs long enough for adjustments to trigger.
