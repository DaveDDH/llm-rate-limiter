/**
 * Test suite: Distributed Wait Queue (Test 40)
 *
 * Verifies per-instance wait queues in distributed mode.
 *
 * Uses the highest-distributedWaitQueue config preset:
 * - model-alpha: TPM=20K
 * - jobTypeA: estimatedTokens=10K, maxWaitMS=30s
 * - 2 instances: 1 slot each
 *
 * Key behaviors to verify:
 * 1. Wait queue per instance (independent queues)
 * 2. Rate limit reset wakes queue
 * 3. Backend allocation change wakes queue
 */
import {
  HTTP_ACCEPTED,
  JOB_TYPE,
  MODEL_ID,
  ONE_INSTANCE,
  ONE_SLOT,
  PORT_A,
  PORT_B,
  QUEUE_DURATION_THRESHOLD_MS,
  REALLOCATION_WAKE_THRESHOLD_MS,
  TWO_INSTANCES,
  TWO_SLOTS,
  ZERO_TOKEN_JOB,
  fetchAllocation,
  getModelPoolSlots,
  killAllInstances,
  killInstanceBAndWaitForReallocation,
  setupTwoInstances,
  submitJob,
  waitForJobResult,
} from './distributedWaitQueueHelpers.js';

const AFTER_ALL_TIMEOUT_MS = 30000;
const BEFORE_ALL_TIMEOUT_MS = 60000;
const TEST_TIMEOUT_MS = 90000;

const QUEUE_START_TIME_TOLERANCE_MS = 100;

/** Verify allocation setup for two instances with one slot each */
const verifyTwoInstanceAllocation = async (): Promise<void> => {
  const allocA = await fetchAllocation(PORT_A);
  const allocB = await fetchAllocation(PORT_B);

  expect(allocA.allocation?.instanceCount).toBe(TWO_INSTANCES);
  expect(allocB.allocation?.instanceCount).toBe(TWO_INSTANCES);

  const slotsA = getModelPoolSlots(allocA, MODEL_ID);
  const slotsB = getModelPoolSlots(allocB, MODEL_ID);

  expect(slotsA).toBe(ONE_SLOT);
  expect(slotsB).toBe(ONE_SLOT);
};

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Wait Queue - Wait Queue Per Instance', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    '40.1: should maintain independent wait queues on each instance',
    async () => {
      await verifyTwoInstanceAllocation();

      const statusJob1 = await submitJob(PORT_A, 'job-1', JOB_TYPE, ZERO_TOKEN_JOB);
      expect(statusJob1).toBe(HTTP_ACCEPTED);

      const statusJob2 = await submitJob(PORT_A, 'job-2', JOB_TYPE, ZERO_TOKEN_JOB);
      expect(statusJob2).toBe(HTTP_ACCEPTED);

      const statusJob3 = await submitJob(PORT_B, 'job-3', JOB_TYPE, ZERO_TOKEN_JOB);
      expect(statusJob3).toBe(HTTP_ACCEPTED);

      const statusJob4 = await submitJob(PORT_B, 'job-4', JOB_TYPE, ZERO_TOKEN_JOB);
      expect(statusJob4).toBe(HTTP_ACCEPTED);

      const resultJob1 = await waitForJobResult(PORT_A, 'job-1');
      expect(resultJob1.status).toBe('completed');
      expect(resultJob1.queueDuration).toBeLessThan(QUEUE_START_TIME_TOLERANCE_MS);

      const resultJob3 = await waitForJobResult(PORT_B, 'job-3');
      expect(resultJob3.status).toBe('completed');
      expect(resultJob3.queueDuration).toBeLessThan(QUEUE_START_TIME_TOLERANCE_MS);

      const resultJob2 = await waitForJobResult(PORT_A, 'job-2');
      expect(resultJob2.status).toBe('completed');
      expect(resultJob2.queueDuration).toBeGreaterThanOrEqual(QUEUE_DURATION_THRESHOLD_MS);

      const resultJob4 = await waitForJobResult(PORT_B, 'job-4');
      expect(resultJob4.status).toBe('completed');
      expect(resultJob4.queueDuration).toBeGreaterThanOrEqual(QUEUE_DURATION_THRESHOLD_MS);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Wait Queue - Backend Allocation Change Wakes Queue', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    '40.3: should wake queued job when allocation changes',
    async () => {
      const allocA = await fetchAllocation(PORT_A);
      const allocB = await fetchAllocation(PORT_B);

      expect(allocA.allocation?.instanceCount).toBe(TWO_INSTANCES);
      expect(allocB.allocation?.instanceCount).toBe(TWO_INSTANCES);

      const statusJob1 = await submitJob(PORT_A, 'fill-1', JOB_TYPE, ZERO_TOKEN_JOB);
      const statusJob2 = await submitJob(PORT_A, 'fill-2', JOB_TYPE, ZERO_TOKEN_JOB);

      expect(statusJob1).toBe(HTTP_ACCEPTED);
      expect(statusJob2).toBe(HTTP_ACCEPTED);

      const statusJobQueued = await submitJob(PORT_A, 'queued-job', JOB_TYPE, ZERO_TOKEN_JOB);
      expect(statusJobQueued).toBe(HTTP_ACCEPTED);

      await killInstanceBAndWaitForReallocation();

      const allocAAfter = await fetchAllocation(PORT_A);
      expect(allocAAfter.allocation?.instanceCount).toBe(ONE_INSTANCE);
      const slotsAfter = getModelPoolSlots(allocAAfter, MODEL_ID);
      expect(slotsAfter).toBe(TWO_SLOTS);

      const resultQueued = await waitForJobResult(PORT_A, 'queued-job');
      expect(resultQueued.status).toBe('completed');
      expect(resultQueued.modelUsed).toBe(MODEL_ID);

      if (resultQueued.queueDuration !== undefined) {
        expect(resultQueued.queueDuration).toBeLessThan(REALLOCATION_WAKE_THRESHOLD_MS);
      }
    },
    TEST_TIMEOUT_MS
  );
});
