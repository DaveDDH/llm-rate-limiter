/**
 * Test suite: Fixed Ratio Protection (Test 16)
 *
 * Verifies that job types with flexible: false maintain their allocated slots
 * even when flexible job types experience heavy load.
 *
 * 16.1: Fixed ratio never changes under heavy flex load (two-type config)
 * 16.2: Fixed type jobs complete quickly even under heavy flex load (three-type config)
 * 16.3: Multiple fixed types all protected simultaneously (multi-fixed config)
 */
import { sleep } from '../testUtils.js';
import {
  HEAVY_LOAD_JOB_COUNT,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_START_DELAY_MS,
  JOB_START_SHORT_DELAY_MS,
  LONG_JOB_DURATION_MS,
  MAX_FIXED_QUEUE_DURATION_MS,
  MULTI_FIXED_A_SLOTS,
  MULTI_FIXED_B_SLOTS,
  MULTI_FIXED_CONFIG,
  MULTI_FLEX_C_SLOTS,
  SHORT_JOB_DURATION_MS,
  THREE_TYPE_CONFIG,
  THREE_TYPE_FIXED_SLOTS,
  TWO_TYPE_CONFIG,
  TWO_TYPE_FIXED_SLOTS,
  TWO_TYPE_FLEX_SLOTS,
  ZERO_COUNT,
  fetchStats,
  getAllocatedSlots,
  getInFlight,
  getJobTypeStats,
  killAllInstances,
  setupSingleInstance,
  submitJob,
  waitForNoActiveJobs,
} from './fixedRatioProtectionHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;
const WAIT_FOR_JOBS_TIMEOUT_MS = 30000;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Submit multiple heavy-load jobs to a flexible job type
 */
const submitHeavyFlexLoad = async (jobType: string, prefix: string): Promise<void> => {
  const submissions = Array.from({ length: HEAVY_LOAD_JOB_COUNT }, async (_, i) => {
    const jobId = `${prefix}-${Date.now()}-${i}`;
    const status = await submitJob(INSTANCE_URL, jobId, jobType, LONG_JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);
  });
  await Promise.all(submissions);
};

/**
 * Submit a single short job and return the submission timestamp
 */
const submitSingleShortJob = async (jobType: string, prefix: string): Promise<number> => {
  const submitTime = Date.now();
  const jobId = `${prefix}-${submitTime}`;
  const status = await submitJob(INSTANCE_URL, jobId, jobType, SHORT_JOB_DURATION_MS);
  expect(status).toBe(HTTP_ACCEPTED);
  return submitTime;
};

/**
 * Verify allocated slots for a job type match expected value
 */
const verifyAllocatedSlots = async (jobType: string, expectedSlots: number): Promise<void> => {
  const stats = await fetchStats(INSTANCE_URL);
  const jobTypeStats = getJobTypeStats(stats);
  const allocated = getAllocatedSlots(jobTypeStats, jobType);
  expect(allocated).toBe(expectedSlots);
};

describe('16.1 Fixed Ratio Never Changes Under Heavy Flex Load', () => {
  beforeAll(async () => {
    await setupSingleInstance(TWO_TYPE_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should maintain fixedType allocatedSlots=4 despite heavy flexType load', async () => {
    await submitHeavyFlexLoad('flexType', 'heavy-flex');
    await sleep(JOB_START_DELAY_MS);
    await verifyAllocatedSlots('fixedType', TWO_TYPE_FIXED_SLOTS);
  });

  it('should show correct flexType allocatedSlots', async () => {
    await verifyAllocatedSlots('flexType', TWO_TYPE_FLEX_SLOTS);
  });

  it('should complete all jobs without failures', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, WAIT_FOR_JOBS_TIMEOUT_MS);

    const stats = await fetchStats(INSTANCE_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getInFlight(jobTypeStats, 'fixedType')).toBe(ZERO_COUNT);
    expect(getInFlight(jobTypeStats, 'flexType')).toBe(ZERO_COUNT);
  });
});

describe('16.2 Fixed Type Protected Under Heavy Flexible Load', () => {
  beforeAll(async () => {
    await setupSingleInstance(THREE_TYPE_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete fixedType job quickly even with heavy flexJobA load', async () => {
    await submitHeavyFlexLoad('flexJobA', 'heavy-flex-a');
    await sleep(JOB_START_SHORT_DELAY_MS);

    const submitTime = await submitSingleShortJob('fixedType', 'fixed-quick');
    await sleep(MAX_FIXED_QUEUE_DURATION_MS);

    const elapsed = Date.now() - submitTime;
    expect(elapsed).toBeLessThan(MAX_FIXED_QUEUE_DURATION_MS);
  });

  it('should maintain fixedType allocatedSlots=3 after heavy load', async () => {
    await verifyAllocatedSlots('fixedType', THREE_TYPE_FIXED_SLOTS);
  });

  it('should complete all jobs without hanging', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, WAIT_FOR_JOBS_TIMEOUT_MS);
  });
});

describe('16.3 Multiple Fixed Types All Protected', () => {
  beforeAll(async () => {
    await setupSingleInstance(MULTI_FIXED_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should maintain fixedA allocatedSlots=3 under heavy flexC load', async () => {
    await submitHeavyFlexLoad('flexC', 'heavy-flex-c');
    await sleep(JOB_START_DELAY_MS);
    await verifyAllocatedSlots('fixedA', MULTI_FIXED_A_SLOTS);
  });

  it('should maintain fixedB allocatedSlots=3 under heavy flexC load', async () => {
    await verifyAllocatedSlots('fixedB', MULTI_FIXED_B_SLOTS);
  });

  it('should show correct flexC allocatedSlots=4', async () => {
    await verifyAllocatedSlots('flexC', MULTI_FLEX_C_SLOTS);
  });

  it('should complete all jobs without failures', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, WAIT_FOR_JOBS_TIMEOUT_MS);

    const stats = await fetchStats(INSTANCE_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getInFlight(jobTypeStats, 'fixedA')).toBe(ZERO_COUNT);
    expect(getInFlight(jobTypeStats, 'fixedB')).toBe(ZERO_COUNT);
    expect(getInFlight(jobTypeStats, 'flexC')).toBe(ZERO_COUNT);
  });
});
