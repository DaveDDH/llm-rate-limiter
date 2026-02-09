/**
 * Test suite: Distributed Escalation (Test 41)
 *
 * Verifies that escalation works across instances in distributed mode.
 *
 * Uses the highest-distributedEscalation config preset:
 * - model-alpha: TPM=50K (2 instances -> 25K each, ~2 slots per instance)
 * - model-beta: TPM=1M (large)
 * - jobTypeA: estimatedTokens=10K, maxWaitMS=0 (immediate escalation)
 *
 * Key behaviors to verify:
 * 1. Escalation works across instances
 * 2. Global capacity checked before escalation
 */
import {
  ALPHA_SLOTS_PER_INSTANCE,
  HTTP_ACCEPTED,
  JOB_TYPE,
  MEDIUM_JOB_DURATION_MS,
  MODEL_ALPHA,
  MODEL_BETA,
  PORT_A,
  ZERO_SLOTS,
  fetchAllocation,
  fillAlphaSlots,
  getModelPoolSlots,
  killAllInstances,
  setupTwoInstances,
  submitJob,
  verifyInstanceCount,
  waitForJobResult,
} from './distributedEscalationHelpers.js';

const AFTER_ALL_TIMEOUT_MS = 30000;
const BEFORE_ALL_TIMEOUT_MS = 60000;
const TEST_TIMEOUT_MS = 90000;

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Escalation - Escalation Works Across Instances', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    '41.1: should escalate to model-beta when model-alpha is full',
    async () => {
      await verifyInstanceCount();

      const allocA = await fetchAllocation(PORT_A);
      const slotsA = getModelPoolSlots(allocA, MODEL_ALPHA);
      expect(slotsA).toBe(ALPHA_SLOTS_PER_INSTANCE);

      await fillAlphaSlots(PORT_A, 'fill-a');
      await fillAlphaSlots(PORT_A, 'fill-b');

      const statusEscalated = await submitJob(PORT_A, 'escalated-job', JOB_TYPE, MEDIUM_JOB_DURATION_MS);
      expect(statusEscalated).toBe(HTTP_ACCEPTED);

      const resultEscalated = await waitForJobResult(PORT_A, 'escalated-job');
      expect(resultEscalated.status).toBe('completed');
      expect(resultEscalated.modelUsed).toBe(MODEL_BETA);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Escalation - Global Capacity Checked Before Escalation', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    '41.2: should consider global capacity when deciding escalation',
    async () => {
      await verifyInstanceCount();

      const allocA = await fetchAllocation(PORT_A);
      const betaSlotsA = getModelPoolSlots(allocA, MODEL_BETA);
      expect(betaSlotsA).toBeGreaterThan(ZERO_SLOTS);

      await fillAlphaSlots(PORT_A, 'alpha');

      const statusNewJob = await submitJob(PORT_A, 'new-job', JOB_TYPE, MEDIUM_JOB_DURATION_MS);
      expect(statusNewJob).toBe(HTTP_ACCEPTED);

      const resultNewJob = await waitForJobResult(PORT_A, 'new-job');
      expect(resultNewJob.status).toBe('completed');
      expect(resultNewJob.modelUsed).toBe(MODEL_BETA);
    },
    TEST_TIMEOUT_MS
  );
});
