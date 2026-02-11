/**
 * Test suite: Memory Slot Calculation (Test 3)
 *
 * Verifies memory-based slot calculations work correctly.
 * Memory is a LOCAL per-instance constraint:
 *   finalSlots = min(distributedAllocation, localMemorySlots)
 *
 * Boot instances with maxMemoryMB to control available memory,
 * then verify that memory-based slot calculations produce expected results.
 */
import {
  DISTRIBUTED_SLOTS_ZERO_MEMORY,
  EXPECTED_FREE_RATIO_SLOTS,
  EXPECTED_JOB_TYPE_A_MEMORY_SLOTS,
  EXPECTED_JOB_TYPE_A_RATIO_SLOTS,
  EXPECTED_JOB_TYPE_B_MEMORY_SLOTS,
  EXPECTED_JOB_TYPE_B_RATIO_SLOTS,
  FINAL_SLOTS_TEST_3_2,
  FINAL_SLOTS_TEST_3_3,
  INSTANCE_A_URL,
  MEMORY_50MB,
  MEMORY_100MB,
  MEMORY_500MB,
  ZERO_SLOTS,
  fetchAllocation,
  fetchStats,
  getJobTypeAllocatedSlots,
  getMemoryCapacity,
  getPoolSlots,
  killAllInstances,
  setupSingleInstance,
  setupTwoInstances,
} from './memorySlotCalculationHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;
const MODEL_ID = 'mem-model';

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('3.1 Memory Slots Calculated Exactly', () => {
  beforeAll(async () => {
    await setupSingleInstance('memCalc-basic', {
      maxMemoryMB: MEMORY_100MB,
    });
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report memory capacity', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const capacity = getMemoryCapacity(stats);
    expect(capacity).toBeDefined();
    expect(capacity).toBeGreaterThan(ZERO_SLOTS);
  });

  it('should allocate correct memory slots for jobTypeA (10MB)', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const slots = getJobTypeAllocatedSlots(stats, 'jobTypeA');
    expect(slots).toBe(EXPECTED_JOB_TYPE_A_MEMORY_SLOTS);
  });

  it('should allocate correct memory slots for jobTypeB (5MB)', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const slots = getJobTypeAllocatedSlots(stats, 'jobTypeB');
    expect(slots).toBe(EXPECTED_JOB_TYPE_B_MEMORY_SLOTS);
  });
});

describe('3.2 Memory is Minimum Constraint', () => {
  beforeAll(async () => {
    await setupTwoInstances('memCalc-memoryWins', {
      maxMemoryMB: MEMORY_50MB,
    });
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should have pool slots from distributed allocation', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPoolSlots(response, MODEL_ID);
    expect(pool).toBeDefined();
  });

  it('should use memory as the limiting factor', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const slots = getJobTypeAllocatedSlots(stats, 'jobTypeA');
    expect(slots).toBe(FINAL_SLOTS_TEST_3_2);
  });
});

describe('3.3 Distributed Wins When Lower', () => {
  beforeAll(async () => {
    await setupTwoInstances('memCalc-distributedWins', {
      maxMemoryMB: MEMORY_500MB,
    });
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should have zero distributed slots', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPoolSlots(response, MODEL_ID);
    expect(pool).toBe(FINAL_SLOTS_TEST_3_3);
  });

  it('should use distributed allocation as the limiting factor', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const slots = getJobTypeAllocatedSlots(stats, 'jobTypeA');
    expect(slots).toBe(FINAL_SLOTS_TEST_3_3);
  });
});

describe('3.4 Ratios Distribute Memory Correctly', () => {
  beforeAll(async () => {
    await setupSingleInstance('memCalc-ratios', {
      maxMemoryMB: MEMORY_100MB,
    });
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should allocate 70% of memory slots to jobTypeA', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const slots = getJobTypeAllocatedSlots(stats, 'jobTypeA');
    expect(slots).toBe(EXPECTED_JOB_TYPE_A_RATIO_SLOTS);
  });

  it('should allocate 30% of memory slots to jobTypeB', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const slots = getJobTypeAllocatedSlots(stats, 'jobTypeB');
    expect(slots).toBe(EXPECTED_JOB_TYPE_B_RATIO_SLOTS);
  });
});

describe('3.5 Zero Memory Estimate Disables Memory Limiting', () => {
  beforeAll(async () => {
    await setupSingleInstance('memCalc-zeroMemory');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should use distributed slots when memory estimate is zero', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const slots = getJobTypeAllocatedSlots(stats, 'jobTypeA');
    expect(slots).toBe(DISTRIBUTED_SLOTS_ZERO_MEMORY);
  });

  it('should not have memory as limiting factor', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPoolSlots(response, MODEL_ID);
    expect(pool).toBe(DISTRIBUTED_SLOTS_ZERO_MEMORY);
  });
});

describe('3.6 freeMemoryRatio Respected', () => {
  beforeAll(async () => {
    await setupSingleInstance('memCalc-freeRatio', {
      maxMemoryMB: MEMORY_100MB,
    });
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report memory capacity', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const capacity = getMemoryCapacity(stats);
    expect(capacity).toBeDefined();
  });

  it('should limit memory slots based on freeMemoryRatio', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const slots = getJobTypeAllocatedSlots(stats, 'jobTypeA');
    // With freeMemoryRatio = 0.8, only 80% of memory is usable
    // 100MB × 0.8 = 80MB → floor(80MB / 10MB) = 8 slots
    expect(slots).toBe(EXPECTED_FREE_RATIO_SLOTS);
  });
});
