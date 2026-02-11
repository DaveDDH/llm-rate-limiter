/**
 * Test suite: Distributed Global Usage Tracking (Test 29)
 *
 * Verifies that global usage accumulates correctly across instances in
 * distributed mode. Redis tracks per-model usage and updates all instances
 * with new allocations based on remaining capacity.
 *
 * Config: high-distributedBasic
 * - model-alpha: TPM=100K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 2 instances: 50K TPM per instance initially
 *
 * Key behaviors to verify:
 * 1. Multiple jobs accumulate correctly
 * 2. Global usage counter increments across instances
 * 3. Concurrent updates are atomic
 * 4. Remaining capacity decreases after usage
 * 5. Zero remaining capacity blocks new jobs
 * 6. Allocation uses remaining capacity formula
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CONFIG_PRESET,
  INSTANCE_URL_A,
  INSTANCE_URL_B,
  JOB_COMPLETE_TIMEOUT_MS,
  MODEL_ID,
  PORT_A,
  PORT_B,
  TEST_TIMEOUT_MS,
  THREE_JOBS,
  TOKENS_2K,
  TOKENS_3K,
  TOKENS_5K,
  TOKENS_10K,
  TOKENS_20K,
  TOKENS_25K,
  TOKENS_45K,
  TOKENS_50K,
  TWO_JOBS,
  TWO_SLOTS,
  createJobPromises,
  fetchAllocation,
  killAllInstances,
  setupTwoInstances,
  submitBatchAndVerify,
  submitJobAndWait,
  waitForAllocationUpdate,
  waitForJobComplete,
} from './distributedGlobalUsageTrackingHelpers.js';

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Global Usage - 29.1 Multiple Jobs Accumulate Correctly', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should accumulate usage from multiple jobs across instances',
    async () => {
      // Instance A: 5K, Instance B: 3K, Instance A: 2K
      await submitJobAndWait(INSTANCE_URL_A, 'job-1', TOKENS_5K);
      await submitJobAndWait(INSTANCE_URL_B, 'job-2', TOKENS_3K);
      await submitJobAndWait(INSTANCE_URL_A, 'job-3', TOKENS_2K);

      // Wait for allocation to reflect global usage
      const isUpdated = (alloc: { pools: Record<string, { tokensPerMinute: number }> }): boolean =>
        (alloc.pools[MODEL_ID]?.tokensPerMinute ?? TOKENS_50K) < TOKENS_50K;
      await waitForAllocationUpdate(PORT_A, isUpdated);

      // Total usage: 5K + 3K + 2K = 10K
      // Remaining: 100K - 10K = 90K, 45K per instance
      const allocA = await fetchAllocation(PORT_A);
      const tpmA = allocA.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      const allocB = await fetchAllocation(PORT_B);
      const tpmB = allocB.allocation?.pools[MODEL_ID]?.tokensPerMinute;

      expect(tpmA).toBe(TOKENS_45K);
      expect(tpmB).toBe(TOKENS_45K);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Global Usage - 29.2 Global Counter Increments', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should increment global counter with jobs from both instances',
    async () => {
      const jobsA = createJobPromises({
        baseUrl: INSTANCE_URL_A,
        jobPrefix: 'job-a',
        count: THREE_JOBS,
        actualInputTokens: TOKENS_10K,
      });
      const jobsB = createJobPromises({
        baseUrl: INSTANCE_URL_B,
        jobPrefix: 'job-b',
        count: TWO_JOBS,
        actualInputTokens: TOKENS_10K,
      });

      await submitBatchAndVerify([...jobsA, ...jobsB]);

      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);
      await waitForJobComplete(INSTANCE_URL_B, JOB_COMPLETE_TIMEOUT_MS);

      // Wait for allocation to reflect global usage
      const isUpdated = (alloc: { pools: Record<string, { tokensPerMinute: number }> }): boolean =>
        (alloc.pools[MODEL_ID]?.tokensPerMinute ?? TOKENS_50K) < TOKENS_50K;
      await waitForAllocationUpdate(PORT_A, isUpdated);

      // Total: 5 jobs * 10K = 50K tokens used
      // Remaining: 100K - 50K = 50K, 25K per instance
      const allocA = await fetchAllocation(PORT_A);
      const tpmA = allocA.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      expect(tpmA).toBe(TOKENS_25K);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Global Usage - 29.4 Remaining Capacity Decreases', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should decrease remaining capacity after usage',
    async () => {
      // Initial: 50K per instance
      const initialAlloc = await fetchAllocation(PORT_A);
      const initialTpm = initialAlloc.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      expect(initialTpm).toBe(TOKENS_50K);

      // Use 10K tokens on instance A
      await submitJobAndWait(INSTANCE_URL_A, 'test-job', TOKENS_10K);

      // Wait for allocation to reflect global usage on instance B
      const isUpdated = (alloc: { pools: Record<string, { tokensPerMinute: number }> }): boolean =>
        (alloc.pools[MODEL_ID]?.tokensPerMinute ?? TOKENS_50K) < TOKENS_50K;
      await waitForAllocationUpdate(PORT_B, isUpdated);

      // Remaining: 100K - 10K = 90K, 45K per instance
      const updatedAlloc = await fetchAllocation(PORT_B);
      const updatedTpm = updatedAlloc.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      expect(updatedTpm).toBe(TOKENS_45K);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Global Usage - 29.6 Remaining Capacity Formula', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should calculate slots based on remaining capacity',
    async () => {
      // Use 60K tokens globally - split across both instances
      const jobsA = createJobPromises({
        baseUrl: INSTANCE_URL_A,
        jobPrefix: 'job-a',
        count: THREE_JOBS,
        actualInputTokens: TOKENS_10K,
      });
      const jobsB = createJobPromises({
        baseUrl: INSTANCE_URL_B,
        jobPrefix: 'job-b',
        count: THREE_JOBS,
        actualInputTokens: TOKENS_10K,
      });

      await submitBatchAndVerify([...jobsA, ...jobsB]);

      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);
      await waitForJobComplete(INSTANCE_URL_B, JOB_COMPLETE_TIMEOUT_MS);

      // Wait for allocation to reflect global usage
      const isUpdated = (alloc: { pools: Record<string, { tokensPerMinute: number }> }): boolean =>
        (alloc.pools[MODEL_ID]?.tokensPerMinute ?? TOKENS_50K) < TOKENS_50K;
      await waitForAllocationUpdate(PORT_A, isUpdated);

      // Remaining: 100K - 60K = 40K, 20K per instance
      const allocA = await fetchAllocation(PORT_A);
      const tpmA = allocA.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      const slotsA = allocA.allocation?.pools[MODEL_ID]?.totalSlots;

      expect(tpmA).toBe(TOKENS_20K);
      // Slots: floor(20K / 10K) = 2
      expect(slotsA).toBe(TWO_SLOTS);
    },
    TEST_TIMEOUT_MS
  );
});
