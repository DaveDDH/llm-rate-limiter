/**
 * Test suite: Distributed Cross-Instance Propagation - Additional (Test 30)
 *
 * Additional tests for cross-instance propagation:
 * - 30.6: Refund propagates to other instances
 * - 30.7: Overage propagates to other instances
 *
 * Config: high-distributedBasic
 * - model-alpha: TPM=100K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 2 instances: 50K TPM per instance initially
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CONFIG_BASIC,
  HTTP_ACCEPTED,
  INITIAL_PER_INSTANCE,
  INSTANCE_URL_A,
  JOB_COMPLETE_TIMEOUT_MS,
  MODEL_ID,
  OVERAGE_ACTUAL_INPUT,
  OVERAGE_ACTUAL_OUTPUT,
  PORT_B,
  REFUND_ACTUAL_INPUT,
  REFUND_ACTUAL_OUTPUT,
  TEST_TIMEOUT_MS,
  TPM_AFTER_OVERAGE,
  TPM_AFTER_REFUND,
  fetchAllocation,
  killAllInstances,
  setupTwoInstances,
  submitJobWithUsage,
  waitForAllocationUpdate,
  waitForJobComplete,
} from './distributedCrossInstancePropagationAdditionalHelpers.js';

/** Build predicate: allocation changed from initial value */
const buildChangedPredicate =
  (initialTpm: number): ((alloc: { pools: Record<string, { tokensPerMinute: number }> }) => boolean) =>
  (alloc) =>
    (alloc.pools[MODEL_ID]?.tokensPerMinute ?? initialTpm) !== initialTpm;

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('30.6 Refund Propagates to Other Instances', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_BASIC);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should increase Instance B capacity after refund on Instance A',
    async () => {
      // Verify initial allocation
      const initialAlloc = await fetchAllocation(PORT_B);
      const initialTpm = initialAlloc.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      expect(initialTpm).toBe(INITIAL_PER_INSTANCE);

      // Instance A: job with refund (estimated 10K, actual 6K = 4K refund)
      const status = await submitJobWithUsage(
        INSTANCE_URL_A,
        'refund-job',
        REFUND_ACTUAL_INPUT,
        REFUND_ACTUAL_OUTPUT
      );
      expect(status).toBe(HTTP_ACCEPTED);

      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      // Wait for Instance B to receive updated allocation
      await waitForAllocationUpdate(PORT_B, buildChangedPredicate(INITIAL_PER_INSTANCE));

      // Remaining: 100K - 6K = 94K, per instance: 47K
      const allocB = await fetchAllocation(PORT_B);
      const tpmB = allocB.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      expect(tpmB).toBe(TPM_AFTER_REFUND);
    },
    TEST_TIMEOUT_MS
  );
});

describe('30.7 Overage Propagates to Other Instances', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_BASIC);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should reduce Instance B capacity after overage on Instance A',
    async () => {
      // Verify initial allocation
      const initialAlloc = await fetchAllocation(PORT_B);
      const initialTpm = initialAlloc.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      expect(initialTpm).toBe(INITIAL_PER_INSTANCE);

      // Instance A: job with overage (estimated 10K, actual 15K = 5K overage)
      const status = await submitJobWithUsage(
        INSTANCE_URL_A,
        'overage-job',
        OVERAGE_ACTUAL_INPUT,
        OVERAGE_ACTUAL_OUTPUT
      );
      expect(status).toBe(HTTP_ACCEPTED);

      await waitForJobComplete(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);

      // Wait for Instance B to receive updated allocation
      await waitForAllocationUpdate(PORT_B, buildChangedPredicate(INITIAL_PER_INSTANCE));

      // Remaining: 100K - 15K = 85K, per instance: 42.5K
      const allocB = await fetchAllocation(PORT_B);
      const tpmB = allocB.allocation?.pools[MODEL_ID]?.tokensPerMinute;
      expect(tpmB).toBe(TPM_AFTER_OVERAGE);
    },
    TEST_TIMEOUT_MS
  );
});
