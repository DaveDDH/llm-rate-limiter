/**
 * Test suite: Distributed Pub/Sub (Test 31)
 *
 * Verifies pub/sub allocation broadcasts in distributed mode.
 * When a job completes, Redis publishes new allocation to all instances.
 *
 * Config: high-distributedPubSub
 * - model-alpha: TPM=100K, RPM=500
 * - model-beta: TPM=50K
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=2, ratio=1.0
 *
 * Key behaviors to verify:
 * 1. Job completion triggers allocation broadcast
 * 2. All instances receive allocation update
 * 3. Instance receives own allocation
 * 4. Pub/sub message contains complete allocation info
 * 5. Release updates global usage and triggers reallocation
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CONFIG_PRESET,
  EXPECTED_TPM_AFTER_8K_USAGE,
  HTTP_ACCEPTED,
  INSTANCE_URL_A,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE,
  MODEL_ALPHA,
  MODEL_BETA,
  PORT_A,
  PORT_B,
  PORT_C,
  SHORT_JOB_DURATION_MS,
  TEST_TIMEOUT_MS,
  TOKENS_8K,
  fetchAllocation,
  killAllInstances,
  setupThreeInstances,
  setupTwoInstances,
  submitJob,
  waitForJobComplete,
} from './distributedPubSubHelpers.js';

// Test constants
const ZERO_OUTPUT_TOKENS = 0;
const THREE_INSTANCES = 3;
const TWO_INSTANCES = 2;
const MIN_SLOTS = 0;

/** Submit a test job to instance A and wait for completion */
const submitTestJobAndWait = async (jobId: string): Promise<void> => {
  const status = await submitJob({
    baseUrl: INSTANCE_URL_A,
    jobId,
    jobType: JOB_TYPE,
    durationMs: SHORT_JOB_DURATION_MS,
    actualInputTokens: TOKENS_8K,
    actualOutputTokens: ZERO_OUTPUT_TOKENS,
  });
  expect(status).toBe(HTTP_ACCEPTED);
  await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);
};

/** Pool shape for type safety */
interface PoolEntry {
  totalSlots?: number;
  tokensPerMinute?: number;
  requestsPerMinute?: number;
}

/** Dynamic limit shape for type safety */
interface DynamicLimitEntry {
  tokensPerMinute?: number;
  requestsPerMinute?: number;
}

/** Verify model pool has positive slot, TPM, and RPM values */
const verifyModelPoolHasPositiveValues = (
  pools: Record<string, PoolEntry> | undefined,
  modelId: string
): void => {
  expect(pools?.[modelId]).toBeDefined();
  expect(pools?.[modelId]?.totalSlots).toBeGreaterThan(MIN_SLOTS);
  expect(pools?.[modelId]?.tokensPerMinute).toBeGreaterThan(MIN_SLOTS);
  expect(pools?.[modelId]?.requestsPerMinute).toBeGreaterThan(MIN_SLOTS);
};

/** Verify dynamicLimits contains per-model TPM/RPM values */
const verifyDynamicLimitsForModel = (
  dynamicLimits: Record<string, DynamicLimitEntry> | undefined,
  modelId: string
): void => {
  expect(dynamicLimits).toBeDefined();
  const limits = dynamicLimits?.[modelId];
  expect(limits).toBeDefined();
  expect(limits?.tokensPerMinute).toBeDefined();
  expect(limits?.requestsPerMinute).toBeDefined();
};

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Pub/Sub - 31.1 Job Completion Triggers Allocation Broadcast', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should broadcast allocation update after job completion',
    async () => {
      // Send 1 job to instance A
      const status = await submitJob({
        baseUrl: INSTANCE_URL_A,
        jobId: 'test-job',
        jobType: JOB_TYPE,
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens: TOKENS_8K,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      });
      expect(status).toBe(HTTP_ACCEPTED);

      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      // Check if instance B received allocation update
      const allocB = await fetchAllocation(PORT_B);
      expect(allocB.allocation).not.toBeNull();
      expect(allocB.allocation?.pools[MODEL_ALPHA]).toBeDefined();
      expect(allocB.allocation?.dynamicLimits).toBeDefined();
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Pub/Sub - 31.2 All Instances Receive Allocation Update', () => {
  beforeAll(async () => {
    await setupThreeInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should send allocation update to all three instances',
    async () => {
      // Send job to instance A
      const status = await submitJob({
        baseUrl: INSTANCE_URL_A,
        jobId: 'test-job',
        jobType: JOB_TYPE,
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens: TOKENS_8K,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      });
      expect(status).toBe(HTTP_ACCEPTED);

      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      // Verify all instances received update
      const allocA = await fetchAllocation(PORT_A);
      const allocB = await fetchAllocation(PORT_B);
      const allocC = await fetchAllocation(PORT_C);

      expect(allocA.allocation).not.toBeNull();
      expect(allocB.allocation).not.toBeNull();
      expect(allocC.allocation).not.toBeNull();

      // All should have same instance count
      expect(allocA.allocation?.instanceCount).toBe(THREE_INSTANCES);
      expect(allocB.allocation?.instanceCount).toBe(THREE_INSTANCES);
      expect(allocC.allocation?.instanceCount).toBe(THREE_INSTANCES);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Pub/Sub - 31.3 Instance Receives Own Allocation', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should allow instance to receive its own allocation update',
    async () => {
      // Send job to instance A
      const status = await submitJob({
        baseUrl: INSTANCE_URL_A,
        jobId: 'test-job',
        jobType: JOB_TYPE,
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens: TOKENS_8K,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      });
      expect(status).toBe(HTTP_ACCEPTED);

      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      // Instance A should receive update
      const allocA = await fetchAllocation(PORT_A);
      expect(allocA.allocation).not.toBeNull();
      expect(allocA.allocation?.pools[MODEL_ALPHA]).toBeDefined();
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Pub/Sub - 31.4 Pub/Sub Message Contains Complete Allocation Info', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should include complete allocation info in pub/sub message',
    async () => {
      // Send job to instance A
      await submitTestJobAndWait('test-job');

      // Check allocation on instance B
      const allocB = await fetchAllocation(PORT_B);
      const { allocation } = allocB;

      expect(allocation).not.toBeNull();
      expect(allocation?.instanceCount).toBe(TWO_INSTANCES);
      verifyModelPoolHasPositiveValues(allocation?.pools, MODEL_ALPHA);
      expect(allocation?.pools[MODEL_BETA]).toBeDefined();
      expect(allocation?.pools[MODEL_BETA]?.totalSlots).toBeGreaterThan(MIN_SLOTS);

      verifyDynamicLimitsForModel(allocation?.dynamicLimits, MODEL_ALPHA);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Pub/Sub - 31.5 Release Updates Global Usage and Triggers Reallocation', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should update global usage and trigger reallocation on release',
    async () => {
      // Send job that completes with 8K tokens actual
      const status = await submitJob({
        baseUrl: INSTANCE_URL_A,
        jobId: 'test-job',
        jobType: JOB_TYPE,
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens: TOKENS_8K,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      });
      expect(status).toBe(HTTP_ACCEPTED);

      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      // Both instances should receive new allocation
      const allocA = await fetchAllocation(PORT_A);
      const allocB = await fetchAllocation(PORT_B);

      expect(allocA.allocation).not.toBeNull();
      expect(allocB.allocation).not.toBeNull();

      // Global usage: 8K used, remaining: 92K, per instance: 46K
      const tpmA = allocA.allocation?.pools[MODEL_ALPHA]?.tokensPerMinute;
      const tpmB = allocB.allocation?.pools[MODEL_ALPHA]?.tokensPerMinute;

      expect(tpmA).toBe(EXPECTED_TPM_AFTER_8K_USAGE);
      expect(tpmB).toBe(EXPECTED_TPM_AFTER_8K_USAGE);
    },
    TEST_TIMEOUT_MS
  );
});
