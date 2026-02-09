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
  EIGHTY_K_TOKENS,
  JOB_COMPLETE_TIMEOUT_MS,
  MODEL_ALPHA,
  MODEL_BETA,
  PORT_A,
  TEST_TIMEOUT_MS,
  TWENTY_K_TOKENS,
  TWO_INSTANCES,
  fetchAllocation,
  fetchStats,
  getTokensPerMinute,
  killAllInstances,
  setupTwoInstances,
  submitEightJobsToModel,
  submitTwoJobsToModel,
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
      // Use 80K tokens on model-alpha (8 jobs)
      await submitEightJobsToModel(PORT_A, MODEL_ALPHA, 'alpha-job');

      // Use 20K tokens on model-beta (2 jobs)
      await submitTwoJobsToModel(PORT_A, MODEL_BETA, 'beta-job');

      // Wait for all jobs to complete
      await waitForJobsComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);

      // Verify independent tracking
      const stats = await fetchStats(PORT_A);
      const alphaTpm = getTokensPerMinute(stats, MODEL_ALPHA);
      const betaTpm = getTokensPerMinute(stats, MODEL_BETA);

      expect(alphaTpm?.current).toBe(EIGHTY_K_TOKENS);
      expect(betaTpm?.current).toBe(TWENTY_K_TOKENS);
    },
    TEST_TIMEOUT_MS
  );

  it('should have independent remaining capacity per model', async () => {
    // Query allocations on instance B
    const allocationB = await fetchAllocation(PORT_A);

    // Verify instance count
    expect(allocationB.allocation?.instanceCount).toBe(TWO_INSTANCES);

    // Verify both models have pool allocations
    const alphaPool = allocationB.allocation?.pools[MODEL_ALPHA];
    const betaPool = allocationB.allocation?.pools[MODEL_BETA];

    expect(alphaPool).toBeDefined();
    expect(betaPool).toBeDefined();
    expect(alphaPool?.totalSlots).toBeGreaterThan(MIN_SLOTS);
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
      // Use capacity on model-alpha only
      await submitEightJobsToModel(PORT_A, MODEL_ALPHA, 'capacity-alpha');

      await waitForJobsComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);

      // Verify model-alpha remaining capacity reduced
      const stats = await fetchStats(PORT_A);
      const alphaTpm = getTokensPerMinute(stats, MODEL_ALPHA);
      const betaTpm = getTokensPerMinute(stats, MODEL_BETA);

      // model-alpha: (100K - 80K) / 2 instances = 10K per instance
      expect(alphaTpm?.remaining).toBeLessThan(ALPHA_TPM / TWO_INSTANCES);

      // model-beta: (50K - 0) / 2 instances = 25K per instance (unchanged)
      expect(betaTpm?.remaining).toBeGreaterThanOrEqual(BETA_TPM / TWO_INSTANCES);
    },
    TEST_TIMEOUT_MS
  );
});
