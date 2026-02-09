/**
 * Test suite: Distributed Multi-Model Tracking (Test 35)
 *
 * Verifies per-model tracking in distributed mode.
 *
 * Config: high-distributedMultiModel
 * - model-alpha: TPM=100K
 * - model-beta: TPM=50K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 2 instances
 *
 * Key behaviors:
 * 1. Multiple models tracked independently
 * 2. Usage on model-alpha does not affect model-beta
 * 3. Remaining capacity calculated separately per model
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  ALPHA_TPM,
  BEFORE_ALL_TIMEOUT_MS,
  BETA_TPM,
  FIFTY_K_TOKENS,
  JOB_COMPLETE_TIMEOUT_MS,
  MODEL_ALPHA,
  MODEL_BETA,
  PORT_A,
  TEST_TIMEOUT_MS,
  TWO_INSTANCES,
  ZERO_TOKENS,
  fetchAllocation,
  fetchStats,
  getTokensPerMinute,
  killAllInstances,
  setupTwoInstances,
  submitEightJobsToModel,
  submitFiveJobs,
  waitForJobsComplete,
} from './distributedMultiModelTrackingHelpers.js';

// Minimum slots constant
const MIN_SLOTS = 0;

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Multi-Model Tracking - Independent Tracking', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should track multiple models independently',
    async () => {
      // Submit 5 jobs (all go to alpha via escalation order, 5 slots per instance)
      await submitFiveJobs(PORT_A, 'alpha-job');

      // Wait for all jobs to complete
      await waitForJobsComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);

      // Verify independent tracking: alpha has usage, beta is unaffected
      const stats = await fetchStats(PORT_A);
      const alphaTpm = getTokensPerMinute(stats, MODEL_ALPHA);
      const betaTpm = getTokensPerMinute(stats, MODEL_BETA);

      // 5 jobs * 10K = 50K tokens on alpha
      expect(alphaTpm?.current).toBe(FIFTY_K_TOKENS);
      // Beta counter is independent (no jobs routed to beta)
      expect(betaTpm?.current ?? ZERO_TOKENS).toBe(ZERO_TOKENS);
    },
    TEST_TIMEOUT_MS
  );

  it('should have independent remaining capacity per model', async () => {
    // Query allocations
    const allocation = await fetchAllocation(PORT_A);

    // Verify instance count
    expect(allocation.allocation?.instanceCount).toBe(TWO_INSTANCES);

    // Verify both models have pool allocations
    const alphaPool = allocation.allocation?.pools[MODEL_ALPHA];
    const betaPool = allocation.allocation?.pools[MODEL_BETA];

    expect(alphaPool).toBeDefined();
    expect(betaPool).toBeDefined();
    // Alpha has remaining capacity (50K used of 100K)
    expect(alphaPool?.totalSlots).toBeGreaterThan(MIN_SLOTS);
    // Beta is completely unaffected
    expect(betaPool?.totalSlots).toBeGreaterThan(MIN_SLOTS);
  });
});

describe('Distributed Multi-Model Tracking - Capacity Calculation', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should calculate remaining capacity independently per model',
    async () => {
      // Use capacity on model-alpha only (all jobs go to alpha via escalation)
      await submitEightJobsToModel(PORT_A, MODEL_ALPHA, 'capacity-alpha');

      await waitForJobsComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);

      // Verify model-alpha remaining capacity reduced
      const stats = await fetchStats(PORT_A);
      const alphaTpm = getTokensPerMinute(stats, MODEL_ALPHA);
      const betaTpm = getTokensPerMinute(stats, MODEL_BETA);

      // model-alpha: used capacity, remaining should be less than half the total
      expect(alphaTpm?.remaining).toBeLessThan(ALPHA_TPM / TWO_INSTANCES);

      // model-beta: (50K - 0) / 2 instances = 25K per instance (unchanged)
      expect(betaTpm?.remaining).toBeGreaterThanOrEqual(BETA_TPM / TWO_INSTANCES);
    },
    TEST_TIMEOUT_MS
  );
});
