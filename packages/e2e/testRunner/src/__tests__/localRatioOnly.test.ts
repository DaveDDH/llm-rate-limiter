/**
 * Test suite: Dynamic Ratio is Local Only (Pool-Based)
 *
 * Verifies that dynamic ratio adjustments are NOT shared across instances.
 * Each instance maintains its own local ratio state for job type distribution.
 *
 * With pool-based allocation:
 * - Redis provides per-model pools to each instance
 * - Each instance locally distributes pool capacity across job types using ratios
 * - Ratio adjustments on one instance don't affect other instances' allocations
 *
 * Uses the flexibleRatio config preset:
 * - flex-model: 100K TPM
 * - flexJobA, flexJobB, flexJobC: Each gets a share of the pool locally
 *
 * Key behavior to verify:
 * - Instance A's ratio adjustments don't affect Instance B's pools
 * - Each instance independently manages its own load balance
 * - Heavy load on Instance A doesn't reduce Instance B's pool capacity
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import {
  HEAVY_LOAD_JOBS,
  INSTANCE_A_URL,
  INSTANCE_B_URL,
  INSTANCE_COUNT,
  MAX_QUEUE_DURATION_MS,
  STANDARD_JOBS,
  TOTAL_MIXED_JOBS,
  ZERO_COUNT,
  fetchAllocation,
  getFlexModelPool,
  resetBothInstances,
  resetProxy,
  runAllocationVerifyHeavyLoad,
  runIndependentInstanceTest,
  runMixedLoadTest,
} from './localRatioOnlyHelpers.js';
import { createEmptyTestData } from './testHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 240000;

// Test state holders
let independentTestDataA: TestData = createEmptyTestData();
let independentTestDataB: TestData = createEmptyTestData();
let mixedLoadData: TestData = createEmptyTestData();

describe('Local Ratio Only - Independent Instance Ratio Management', () => {
  beforeAll(async () => {
    const { dataA, dataB } = await runIndependentInstanceTest();
    independentTestDataA = dataA;
    independentTestDataB = dataB;
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete Instance A jobs', () => {
    const completedA = Object.values(independentTestDataA.jobs).filter((j) => j.status === 'completed');
    expect(completedA.length).toBe(HEAVY_LOAD_JOBS);
  });

  it('should complete Instance B jobs independently', () => {
    const completedB = Object.values(independentTestDataB.jobs).filter((j) => j.status === 'completed');
    expect(completedB.length).toBe(STANDARD_JOBS);
  });

  it('Instance B jobs should complete quickly', () => {
    const jobsB = Object.values(independentTestDataB.jobs);

    for (const job of jobsB) {
      const queueDuration = job.queueDurationMs ?? ZERO_COUNT;
      expect(queueDuration).toBeLessThan(MAX_QUEUE_DURATION_MS);
    }
  });

  it('should not have any failed jobs on either instance', () => {
    const failedA = Object.values(independentTestDataA.jobs).filter((j) => j.status === 'failed');
    const failedB = Object.values(independentTestDataB.jobs).filter((j) => j.status === 'failed');
    expect(failedA.length).toBe(ZERO_COUNT);
    expect(failedB.length).toBe(ZERO_COUNT);
  });
});

/**
 * Verify pool allocation on both instances
 */
const verifyPoolAllocationOnBothInstances = async (): Promise<void> => {
  const allocA = await fetchAllocation(INSTANCE_A_URL);
  const allocB = await fetchAllocation(INSTANCE_B_URL);

  expect(allocA.allocation).not.toBeNull();
  expect(allocB.allocation).not.toBeNull();
  expect(allocA.allocation?.pools).toBeDefined();
  expect(allocB.allocation?.pools).toBeDefined();
};

/**
 * Verify instance count on both instances
 */
const verifyInstanceCountOnBothInstances = async (): Promise<void> => {
  const allocA = await fetchAllocation(INSTANCE_A_URL);
  const allocB = await fetchAllocation(INSTANCE_B_URL);

  expect(allocA.allocation?.instanceCount).toBe(INSTANCE_COUNT);
  expect(allocB.allocation?.instanceCount).toBe(INSTANCE_COUNT);
};

/**
 * Verify pool allocation for flex-model on both instances
 */
const verifyFlexModelPoolOnBothInstances = async (): Promise<void> => {
  const allocA = await fetchAllocation(INSTANCE_A_URL);
  const allocB = await fetchAllocation(INSTANCE_B_URL);

  const poolA = getFlexModelPool(allocA);
  const poolB = getFlexModelPool(allocB);

  expect(poolA).toBeDefined();
  expect(poolB).toBeDefined();
  expect(poolA?.totalSlots).toBe(poolB?.totalSlots);
  expect(poolA?.tokensPerMinute).toBe(poolB?.tokensPerMinute);
};

/**
 * Verify Instance B pool allocation after heavy load on A
 */
const verifyInstanceBPoolAfterHeavyLoad = async (): Promise<void> => {
  const baselineB = await fetchAllocation(INSTANCE_B_URL);
  const baselinePoolB = getFlexModelPool(baselineB);

  await runAllocationVerifyHeavyLoad();

  const afterLoadB = await fetchAllocation(INSTANCE_B_URL);
  const afterPoolB = getFlexModelPool(afterLoadB);

  expect(afterPoolB?.totalSlots).toBeGreaterThanOrEqual(baselinePoolB?.totalSlots ?? ZERO_COUNT);
};

describe('Local Ratio Only - Pool Allocation Verification', () => {
  beforeAll(async () => {
    await resetProxy();
    await resetBothInstances(true);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should have pool allocation data on both instances', verifyPoolAllocationOnBothInstances);

  it('should report same instance count on both instances', verifyInstanceCountOnBothInstances);

  it('should have pool allocation for flex-model', verifyFlexModelPoolOnBothInstances);

  it(
    'Instance B should maintain pool allocation after Instance A processes heavy load',
    verifyInstanceBPoolAfterHeavyLoad,
    BEFORE_ALL_TIMEOUT_MS
  );
});

describe('Local Ratio Only - Mixed Load Across Instances', () => {
  beforeAll(async () => {
    mixedLoadData = await runMixedLoadTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete all jobs', () => {
    const completedJobs = Object.values(mixedLoadData.jobs).filter((j) => j.status === 'completed');
    expect(completedJobs.length).toBe(TOTAL_MIXED_JOBS);
  });

  it('should distribute jobs across both instances', () => {
    const entries = Object.entries(mixedLoadData.summary.byInstance);
    expect(entries.length).toBe(INSTANCE_COUNT);

    for (const [, stats] of entries) {
      expect(stats.total).toBeGreaterThan(ZERO_COUNT);
    }
  });

  it('should not have any failed jobs', () => {
    const failedJobs = Object.values(mixedLoadData.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(ZERO_COUNT);
  });
});
