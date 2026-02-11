/**
 * Test suite: Distributed Cross-Instance Propagation (Test 30)
 *
 * Verifies that overages, refunds, and usage changes on one instance
 * propagate to all other instances via Redis pub/sub.
 *
 * Configs:
 * - high-distributedBasic: TPM=100K (2 instances)
 * - high-distributedThree: TPM=90K (3 instances)
 * - high-distributedMixed: TPM=120K (3 instances)
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CLOSE_TOLERANCE_NEG3,
  CONFIG_BASIC,
  CONFIG_MIXED,
  CONFIG_THREE,
  EIGHT_JOBS,
  FIVE_JOBS,
  FOUR_JOBS,
  INSTANCE_URL_A,
  INSTANCE_URL_B,
  INSTANCE_URL_C,
  JOB_COMPLETE_TIMEOUT_MS,
  MODEL_ID,
  PORT_A,
  PORT_B,
  PORT_C,
  SLOTS_AFTER_HEAVY_OVERAGE,
  SLOTS_AFTER_MODERATE_OVERAGE,
  TEST_TIMEOUT_MS,
  THREE_INSTANCE_DIVISOR,
  THREE_JOBS,
  TOKENS_5K,
  TOKENS_9K,
  TOKENS_10K,
  TOKENS_12K,
  TOKENS_12_5K,
  TOKENS_15K,
  TOKENS_37_5K,
  TPM_90K,
  TWO_JOBS,
  createJobPromises,
  fetchAllocation,
  killAllInstances,
  setupThreeInstances,
  setupTwoInstances,
  submitBatchAndVerify,
  submitSequentialJobs,
  waitForJobComplete,
} from './distributedCrossInstancePropagationHelpers.js';

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('30.1 Overage on One Instance Reduces Allocation for All', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_BASIC);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should reduce allocation for all instances after overage',
    async () => {
      const jobs = createJobPromises({
        baseUrl: INSTANCE_URL_A,
        jobPrefix: 'job',
        count: FIVE_JOBS,
        actualInputTokens: TOKENS_15K,
      });
      await submitBatchAndVerify(jobs);
      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      // Global used: 75K, remaining: 25K, per instance: 12.5K
      const allocB = await fetchAllocation(PORT_B);
      const tpmB = allocB.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      const slotsB = allocB.allocation?.pools[MODEL_ID]?.totalSlots;

      expect(tpmB).toBe(TOKENS_12_5K);
      expect(slotsB).toBe(SLOTS_AFTER_MODERATE_OVERAGE);
    },
    TEST_TIMEOUT_MS
  );
});

describe('30.2 Underuse on One Instance Increases Available Capacity', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_BASIC);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should increase available capacity after underuse',
    async () => {
      const jobs = createJobPromises({
        baseUrl: INSTANCE_URL_A,
        jobPrefix: 'job',
        count: FIVE_JOBS,
        actualInputTokens: TOKENS_5K,
      });
      await submitBatchAndVerify(jobs);
      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      // Global used: 25K, remaining: 75K, per instance: 37.5K
      const allocB = await fetchAllocation(PORT_B);
      const tpmB = allocB.allocation?.pools[MODEL_ID]?.tokensPerMinute;

      expect(tpmB).toBe(TOKENS_37_5K);
    },
    TEST_TIMEOUT_MS
  );
});

describe('30.3 Three Instances Fair Reduction', () => {
  beforeAll(async () => {
    await setupThreeInstances(CONFIG_THREE);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should fairly reduce allocation across three instances',
    async () => {
      const jobs = createJobPromises({
        baseUrl: INSTANCE_URL_A,
        jobPrefix: 'job-a',
        count: FIVE_JOBS,
        actualInputTokens: TOKENS_9K,
      });
      await submitBatchAndVerify(jobs);
      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      // Remaining: 90K - 45K = 45K, per instance: 15K
      const allocB = await fetchAllocation(PORT_B);
      const tpmB = allocB.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      const allocC = await fetchAllocation(PORT_C);
      const tpmC = allocC.allocation?.pools[MODEL_ID]?.tokensPerMinute;

      const expected = (TPM_90K - TOKENS_9K * FIVE_JOBS) / THREE_INSTANCE_DIVISOR;
      expect(tpmB).toBeCloseTo(expected, CLOSE_TOLERANCE_NEG3);
      expect(tpmC).toBeCloseTo(expected, CLOSE_TOLERANCE_NEG3);
    },
    TEST_TIMEOUT_MS
  );
});

describe('30.4 Cumulative Overages Progressively Reduce Capacity', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_BASIC);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should progressively reduce capacity with cumulative overages',
    async () => {
      await submitSequentialJobs(INSTANCE_URL_A, EIGHT_JOBS, TOKENS_12K);

      // After 8 jobs @ 12K each = 96K used, remaining: ~4K, per instance: ~2K
      // Note: minute boundaries may reset TPM mid-sequence, so assert reduction
      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);
      const allocB = await fetchAllocation(PORT_B);
      const tpmB = allocB.allocation?.pools[MODEL_ID]?.tokensPerMinute;

      // TPM should be significantly reduced from initial 50K per instance
      expect(tpmB).toBeLessThanOrEqual(TOKENS_12_5K);
    },
    TEST_TIMEOUT_MS
  );
});

describe('30.5 Mixed Usage Patterns Across Instances', () => {
  beforeAll(async () => {
    await setupThreeInstances(CONFIG_MIXED);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should handle mixed usage patterns correctly',
    async () => {
      // Instance A: 4 jobs @ 15K = 60K
      const jobsA = createJobPromises({
        baseUrl: INSTANCE_URL_A,
        jobPrefix: 'job-a',
        count: FOUR_JOBS,
        actualInputTokens: TOKENS_15K,
      });
      // Instance B: 2 jobs @ 5K = 10K
      const jobsB = createJobPromises({
        baseUrl: INSTANCE_URL_B,
        jobPrefix: 'job-b',
        count: TWO_JOBS,
        actualInputTokens: TOKENS_5K,
      });
      // Instance C: 3 jobs @ 10K = 30K
      const jobsC = createJobPromises({
        baseUrl: INSTANCE_URL_C,
        jobPrefix: 'job-c',
        count: THREE_JOBS,
        actualInputTokens: TOKENS_10K,
      });

      await submitBatchAndVerify([...jobsA, ...jobsB, ...jobsC]);

      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);
      await waitForJobComplete(INSTANCE_URL_B, JOB_COMPLETE_TIMEOUT_MS);
      await waitForJobComplete(INSTANCE_URL_C, JOB_COMPLETE_TIMEOUT_MS);

      // Total: 60K + 10K + 30K = 100K, remaining: 20K, per instance: 6.6K
      // Slots: floor(6.6K / 10K) = 0
      const allocA = await fetchAllocation(PORT_A);
      const slotsA = allocA.allocation?.pools[MODEL_ID]?.totalSlots;
      expect(slotsA).toBe(SLOTS_AFTER_HEAVY_OVERAGE);
    },
    TEST_TIMEOUT_MS
  );
});
