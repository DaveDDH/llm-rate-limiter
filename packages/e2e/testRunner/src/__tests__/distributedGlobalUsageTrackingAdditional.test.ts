/**
 * Test suite: Distributed Global Usage Tracking - Additional (Test 29)
 *
 * Additional tests for global usage tracking:
 * - 29.3: Concurrent updates are atomic
 * - 29.5: Zero remaining capacity blocks new jobs
 *
 * Config: high-distributedBasic
 * - model-alpha: TPM=100K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 2 instances: 50K TPM per instance initially
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CONFIG_PRESET,
  HTTP_ACCEPTED,
  INSTANCE_URL_A,
  INSTANCE_URL_B,
  JOB_COMPLETE_TIMEOUT_MS,
  MODEL_ID,
  PORT_A,
  PORT_B,
  SHORT_JOB_DURATION_MS,
  TEN_JOBS,
  TEST_TIMEOUT_MS,
  TOKENS_1K,
  TOKENS_10K,
  TOKENS_40K,
  TOKENS_50K,
  ZERO_TOKENS,
  createJobPromises,
  fetchAllocation,
  killAllInstances,
  setupTwoInstances,
  submitBatchAndVerify,
  submitJob,
  waitForAllocationUpdate,
  waitForJobComplete,
} from './distributedGlobalUsageTrackingHelpers.js';

/** Build a predicate that checks if allocation TPM dropped below threshold */
const buildCapacityDroppedPredicate =
  (threshold: number): ((alloc: { pools: Record<string, { tokensPerMinute: number }> }) => boolean) =>
  (alloc) =>
    (alloc.pools[MODEL_ID]?.tokensPerMinute ?? threshold) < threshold;

/** Build a predicate that checks if allocation TPM is zero */
const buildZeroCapacityPredicate =
  (): ((alloc: { pools: Record<string, { tokensPerMinute: number }> }) => boolean) => (alloc) =>
    (alloc.pools[MODEL_ID]?.tokensPerMinute ?? TOKENS_50K) === ZERO_TOKENS;

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Global Usage - 29.3 Concurrent Updates Are Atomic', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should accumulate exactly 20K tokens from 20 concurrent jobs',
    async () => {
      const jobsA = createJobPromises({
        baseUrl: INSTANCE_URL_A,
        jobPrefix: 'atomic-a',
        count: TEN_JOBS,
        actualInputTokens: TOKENS_1K,
      });
      const jobsB = createJobPromises({
        baseUrl: INSTANCE_URL_B,
        jobPrefix: 'atomic-b',
        count: TEN_JOBS,
        actualInputTokens: TOKENS_1K,
      });

      await submitBatchAndVerify([...jobsA, ...jobsB]);

      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);
      await waitForJobComplete(INSTANCE_URL_B, JOB_COMPLETE_TIMEOUT_MS);

      await waitForAllocationUpdate(PORT_A, buildCapacityDroppedPredicate(TOKENS_50K));

      // Total: 20 jobs * 1K = 20K used, remaining: 80K, per instance: 40K
      const allocA = await fetchAllocation(PORT_A);
      const tpmA = allocA.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      const allocB = await fetchAllocation(PORT_B);
      const tpmB = allocB.allocation?.pools[MODEL_ID]?.tokensPerMinute;

      expect(tpmA).toBe(TOKENS_40K);
      expect(tpmB).toBe(TOKENS_40K);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Global Usage - 29.5 Zero Remaining Capacity Blocks', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should block new jobs when capacity is exhausted',
    async () => {
      // Use all 100K capacity: 10 jobs * 10K = 100K total
      const exhaustJobs = createJobPromises({
        baseUrl: INSTANCE_URL_A,
        jobPrefix: 'exhaust-a',
        count: TEN_JOBS,
        actualInputTokens: TOKENS_10K,
      });

      await submitBatchAndVerify(exhaustJobs);
      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      await waitForAllocationUpdate(PORT_A, buildZeroCapacityPredicate());

      const allocA = await fetchAllocation(PORT_A);
      const tpmA = allocA.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      expect(tpmA).toBe(ZERO_TOKENS);

      // Submit one more job - it should be queued (not running)
      const blockedStatus = await submitJob({
        baseUrl: INSTANCE_URL_B,
        jobId: 'blocked-job',
        jobType: 'jobTypeA',
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens: TOKENS_10K,
        actualOutputTokens: ZERO_TOKENS,
      });
      expect(blockedStatus).toBe(HTTP_ACCEPTED);

      // Verify allocation remains at zero on instance B
      const allocB = await fetchAllocation(PORT_B);
      const tpmB = allocB.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      expect(tpmB).toBe(ZERO_TOKENS);
    },
    TEST_TIMEOUT_MS
  );
});
