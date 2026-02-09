/**
 * Test suite: Distributed Dynamic Limits (Test 32)
 *
 * Verifies that dynamic limits update local rate limiters in distributed mode.
 * When global usage changes, Redis calculates new per-instance limits and
 * broadcasts them to all instances via pub/sub.
 *
 * Config: high-distributedBasic
 * - model-alpha: TPM=100K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 2 instances: 50K TPM per instance initially
 *
 * Key behaviors to verify:
 * 1. Dynamic limits update local rate limiters
 * 2. DynamicLimits applied to local rate limiters
 * 3. Pool slots recalculated with dynamic limits
 * 4. Dynamic limits propagated to local rate limiters
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CONFIG_PRESET,
  HTTP_ACCEPTED,
  INITIAL_SLOTS,
  INITIAL_TPM_PER_INSTANCE,
  INSTANCE_URL_A,
  INSTANCE_URL_B,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE,
  MODEL_ID,
  PORT_A,
  PORT_B,
  SHORT_JOB_DURATION_MS,
  SLOTS_AFTER_20K_USAGE,
  TEST_TIMEOUT_MS,
  TOKENS_10K,
  TOKENS_20K,
  TOKENS_40K,
  fetchAllocation,
  killAllInstances,
  setupTwoInstances,
  submitJob,
  waitForJobComplete,
} from './distributedDynamicLimitsHelpers.js';

// Test constants
const ZERO_OUTPUT_TOKENS = 0;
const SIX_JOBS = 6;
const INSTANCE_SPLIT_THRESHOLD = 3;
const TWO_SLOTS = 2;
const LOOP_INCREMENT = 1;

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Dynamic Limits - 32.1 Dynamic Limits Update Local Rate Limiters', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should update local rate limiters with new dynamic limits',
    async () => {
      // Initial allocation: 50K TPM per instance
      const initialAlloc = await fetchAllocation(PORT_B);
      const initialTpm = initialAlloc.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      expect(initialTpm).toBe(INITIAL_TPM_PER_INSTANCE);

      // Use 20K tokens globally (10K per instance)
      const status1 = await submitJob({
        baseUrl: INSTANCE_URL_A,
        jobId: 'job-1',
        jobType: JOB_TYPE,
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens: TOKENS_10K,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      });
      expect(status1).toBe(HTTP_ACCEPTED);
      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      const status2 = await submitJob({
        baseUrl: INSTANCE_URL_B,
        jobId: 'job-2',
        jobType: JOB_TYPE,
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens: TOKENS_10K,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      });
      expect(status2).toBe(HTTP_ACCEPTED);
      await waitForJobComplete(INSTANCE_URL_B, JOB_COMPLETE_TIMEOUT_MS);

      // Remaining: 100K - 20K = 80K, 40K per instance
      const updatedAlloc = await fetchAllocation(PORT_B);
      const updatedTpm = updatedAlloc.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      expect(updatedTpm).toBe(TOKENS_40K);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Dynamic Limits - 32.2 DynamicLimits Applied to Local Rate Limiters', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should apply dynamic limits to local rate limiters after overage',
    async () => {
      // Use 60K tokens on instance A (overage)
      const jobPromises: Array<Promise<number>> = [];
      for (let i = 0; i < SIX_JOBS; i += LOOP_INCREMENT) {
        jobPromises.push(
          submitJob({
            baseUrl: INSTANCE_URL_A,
            jobId: `job-${i}`,
            jobType: JOB_TYPE,
            durationMs: SHORT_JOB_DURATION_MS,
            actualInputTokens: TOKENS_10K,
            actualOutputTokens: ZERO_OUTPUT_TOKENS,
          })
        );
      }

      const statuses = await Promise.all(jobPromises);
      statuses.forEach((status) => {
        expect(status).toBe(HTTP_ACCEPTED);
      });
      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      // Remaining: 100K - 60K = 40K, 20K per instance
      const allocB = await fetchAllocation(PORT_B);
      const tpmB = allocB.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      const slotsB = allocB.allocation?.pools[MODEL_ID]?.totalSlots;

      expect(tpmB).toBe(TOKENS_20K);
      // Instance B can only queue 2 jobs (20K / 10K)
      expect(slotsB).toBe(TWO_SLOTS);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Dynamic Limits - 32.3 Pool Slots Recalculated With Dynamic Limits', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should recalculate pool slots based on dynamic limits',
    async () => {
      // Initial: 50K TPM / 10K = 5 slots per instance
      const initialAlloc = await fetchAllocation(PORT_A);
      const initialSlots = initialAlloc.allocation?.pools[MODEL_ID]?.totalSlots;
      expect(initialSlots).toBe(INITIAL_SLOTS);

      // Use 20K tokens globally
      const status1 = await submitJob({
        baseUrl: INSTANCE_URL_A,
        jobId: 'job-1',
        jobType: JOB_TYPE,
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens: TOKENS_10K,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      });
      expect(status1).toBe(HTTP_ACCEPTED);
      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      const status2 = await submitJob({
        baseUrl: INSTANCE_URL_B,
        jobId: 'job-2',
        jobType: JOB_TYPE,
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens: TOKENS_10K,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      });
      expect(status2).toBe(HTTP_ACCEPTED);
      await waitForJobComplete(INSTANCE_URL_B, JOB_COMPLETE_TIMEOUT_MS);

      // After 20K used: 80K remaining / 2 = 40K per instance
      const allocAfter20K = await fetchAllocation(PORT_A);
      const slotsAfter20K = allocAfter20K.allocation?.pools[MODEL_ID]?.totalSlots;
      expect(slotsAfter20K).toBe(SLOTS_AFTER_20K_USAGE);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Dynamic Limits - 32.4 Dynamic Limits Propagated to Local Rate Limiters', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should propagate dynamic limits to all local rate limiters',
    async () => {
      // Use 60K tokens globally
      const jobPromises: Array<Promise<number>> = [];
      for (let i = 0; i < SIX_JOBS; i += LOOP_INCREMENT) {
        const baseUrl = i < INSTANCE_SPLIT_THRESHOLD ? INSTANCE_URL_A : INSTANCE_URL_B;
        jobPromises.push(
          submitJob({
            baseUrl,
            jobId: `job-${i}`,
            jobType: JOB_TYPE,
            durationMs: SHORT_JOB_DURATION_MS,
            actualInputTokens: TOKENS_10K,
            actualOutputTokens: ZERO_OUTPUT_TOKENS,
          })
        );
      }

      const statuses = await Promise.all(jobPromises);
      statuses.forEach((status) => {
        expect(status).toBe(HTTP_ACCEPTED);
      });
      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);
      await waitForJobComplete(INSTANCE_URL_B, JOB_COMPLETE_TIMEOUT_MS);

      // Remaining: 100K - 60K = 40K, 20K per instance
      const allocA = await fetchAllocation(PORT_A);
      const tpmA = allocA.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      const allocB = await fetchAllocation(PORT_B);
      const tpmB = allocB.allocation?.pools[MODEL_ID]?.tokensPerMinute;

      // Both instances should enforce 20K TPM limit
      expect(tpmA).toBe(TOKENS_20K);
      expect(tpmB).toBe(TOKENS_20K);
    },
    TEST_TIMEOUT_MS
  );
});
