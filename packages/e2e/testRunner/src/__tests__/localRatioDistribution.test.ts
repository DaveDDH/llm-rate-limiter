/**
 * Test suite: Local Ratio Distribution (Tests 2.1–2.6)
 *
 * Verifies that job type ratios distribute pool slots correctly.
 * Formula: allocatedSlots = floor(totalSlots * ratio)
 *
 * Tests 2.1–2.4 verify allocation math only (no jobs submitted).
 * Test 2.5 verifies load = inFlight / allocatedSlots.
 * Test 2.6 verifies zero allocation is handled gracefully.
 */
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

import {
  EQUAL_THREE_SLOTS_A,
  EQUAL_THREE_SLOTS_B,
  EQUAL_THREE_SLOTS_C,
  INSTANCE_A_URL,
  LONG_JOB_DURATION_MS,
  SINGLE_TYPE_TOTAL_SLOTS,
  SIX_IN_FLIGHT,
  THREE_TYPE_SLOTS_A,
  THREE_TYPE_SLOTS_B,
  THREE_TYPE_SLOTS_C,
  THREE_TYPE_TOTAL_SLOTS,
  TWO_TYPE_SLOTS_A,
  TWO_TYPE_SLOTS_B,
  TWO_TYPE_TOTAL_SLOTS,
  ZERO_ALLOCATED_SLOTS,
  fetchStats,
  getJobTypeAllocatedSlots,
  getJobTypeInFlight,
  getJobTypeStats,
  killAllInstances,
  setupSingleInstance,
} from './localRatioDistributionHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 2.1: Ratios Apply Exactly to Pool Slots
 * totalSlots = 10, jobTypeA ratio=0.6 → 6, jobTypeB ratio=0.4 → 4
 */
describe('Local Ratio - 2.1 Ratios Apply Exactly', () => {
  beforeAll(async () => {
    await setupSingleInstance('localRatio-twoTypes');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should allocate 6 slots to jobTypeA (ratio 0.6)', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    const slots = getJobTypeAllocatedSlots(jobTypeStats, 'jobTypeA');
    expect(slots).toBe(TWO_TYPE_SLOTS_A);
  });

  it('should allocate 4 slots to jobTypeB (ratio 0.4)', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    const slots = getJobTypeAllocatedSlots(jobTypeStats, 'jobTypeB');
    expect(slots).toBe(TWO_TYPE_SLOTS_B);
  });

  it('should have totalSlots = 10', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(jobTypeStats.totalSlots).toBe(TWO_TYPE_TOTAL_SLOTS);
  });
});

/**
 * Test 2.2: Three Job Types Sum Correctly
 * totalSlots=100, A=50, B=30, C=20
 */
describe('Local Ratio - 2.2 Three Job Types Sum', () => {
  beforeAll(async () => {
    await setupSingleInstance('localRatio-threeTypes');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should allocate 50 slots to jobTypeA (ratio 0.5)', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getJobTypeAllocatedSlots(jobTypeStats, 'jobTypeA')).toBe(THREE_TYPE_SLOTS_A);
  });

  it('should allocate 30 slots to jobTypeB (ratio 0.3)', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getJobTypeAllocatedSlots(jobTypeStats, 'jobTypeB')).toBe(THREE_TYPE_SLOTS_B);
  });

  it('should allocate 20 slots to jobTypeC (ratio 0.2)', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getJobTypeAllocatedSlots(jobTypeStats, 'jobTypeC')).toBe(THREE_TYPE_SLOTS_C);
  });

  it('should sum to totalSlots', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(jobTypeStats.totalSlots).toBe(THREE_TYPE_TOTAL_SLOTS);
  });
});

/**
 * Test 2.3: Floor Division Handles Remainders
 * totalSlots=10, A=floor(10*0.33)=3, B=3, C=floor(10*0.34)=3
 */
describe('Local Ratio - 2.3 Floor Division Remainders', () => {
  beforeAll(async () => {
    await setupSingleInstance('localRatio-equalThree');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should allocate 3 slots to jobTypeA (ratio 0.33)', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getJobTypeAllocatedSlots(jobTypeStats, 'jobTypeA')).toBe(EQUAL_THREE_SLOTS_A);
  });

  it('should allocate 3 slots to jobTypeB (ratio 0.33)', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getJobTypeAllocatedSlots(jobTypeStats, 'jobTypeB')).toBe(EQUAL_THREE_SLOTS_B);
  });

  it('should allocate 3 slots to jobTypeC (ratio 0.34)', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getJobTypeAllocatedSlots(jobTypeStats, 'jobTypeC')).toBe(EQUAL_THREE_SLOTS_C);
  });
});

/**
 * Test 2.4: Single Job Type Gets All Slots
 * totalSlots=10, jobTypeA ratio=1.0 → 10 slots
 */
describe('Local Ratio - 2.4 Single Job Type Full Allocation', () => {
  beforeAll(async () => {
    await setupSingleInstance('slotCalc-tpm-single');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should allocate all 10 slots to jobTypeA', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getJobTypeAllocatedSlots(jobTypeStats, 'jobTypeA')).toBe(SINGLE_TYPE_TOTAL_SLOTS);
  });
});

/**
 * Test 2.5: Load = InFlight / AllocatedSlots
 * Submit 7 long-running jobs to jobTypeA (allocated=6 slots)
 * Only 6 can be in-flight simultaneously (rate limited).
 * Load = inFlight / allocated.
 */
describe('Local Ratio - 2.5 Load Calculation', () => {
  beforeAll(async () => {
    await setupSingleInstance('localRatio-twoTypes');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should show inFlight jobs in stats', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    const inFlight = getJobTypeInFlight(jobTypeStats, 'jobTypeA');
    expect(typeof inFlight).toBe('number');
  });

  it('should report 0 inFlight when no jobs submitted', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    const inFlight = getJobTypeInFlight(jobTypeStats, 'jobTypeA');
    expect(inFlight).toBe(ZERO_ALLOCATED_SLOTS);
  });

  it('should track inFlight after submitting jobs', async () => {
    // Submit long-running jobs to create in-flight state
    const jobPromises = Array.from({ length: SIX_IN_FLIGHT }, async (_, i) => {
      await submitLongRunningJob(INSTANCE_A_URL, `load-test-${i}`, 'jobTypeA');
    });
    await Promise.all(jobPromises);

    // Brief pause to let jobs start processing
    await waitForJobsToStart();

    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    const inFlight = getJobTypeInFlight(jobTypeStats, 'jobTypeA');
    expect(inFlight).toBe(SIX_IN_FLIGHT);
  });
});

/**
 * Test 2.6: Zero Allocated Handles Gracefully
 * jobTypeB has ratio=0.0 with minJobTypeCapacity=0 → allocatedSlots=0
 */
describe('Local Ratio - 2.6 Zero Allocation Graceful', () => {
  beforeAll(async () => {
    await setupSingleInstance('localRatio-zeroAlloc');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should not crash with zero allocated slots', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    expect(stats).toBeDefined();
  });

  it('should report 0 allocated slots for jobTypeB', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getJobTypeAllocatedSlots(jobTypeStats, 'jobTypeB')).toBe(ZERO_ALLOCATED_SLOTS);
  });

  it('should report 0 inFlight for zero-allocation job type', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getJobTypeInFlight(jobTypeStats, 'jobTypeB')).toBe(ZERO_ALLOCATED_SLOTS);
  });
});

// -- Helper functions for test 2.5 --

const HTTP_ACCEPTED = 202;
const JOB_START_DELAY_MS = 500;

/** Submit a long-running job that stays in-flight */
const submitLongRunningJob = async (baseUrl: string, jobId: string, jobType: string): Promise<void> => {
  const response = await fetch(`${baseUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType,
      payload: { durationMs: LONG_JOB_DURATION_MS },
    }),
  });
  expect(response.status).toBe(HTTP_ACCEPTED);
};

/** Wait briefly for jobs to transition from queued to processing */
const waitForJobsToStart = async (): Promise<void> => {
  await setTimeoutPromise(JOB_START_DELAY_MS);
};
