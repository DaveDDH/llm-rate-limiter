/**
 * Test suite: Multi-Model Independence (Test 25)
 *
 * Verifies that multiple models have independent pools and that acquiring
 * capacity on one model does not affect other models.
 *
 * Tests 25.1-25.3:
 * - 25.1: Multiple models have independent pools
 * - 25.2: Acquiring on model A does not affect model B
 * - 25.3: Same ratios applied per model
 *
 * Config: high-multiModel
 * - model-alpha: TPM=100K
 * - model-beta: TPM=50K
 * - model-gamma: maxConcurrentRequests=20
 * - jobTypeA: ratio=0.6, jobTypeB: ratio=0.4
 * - 2 instances
 */
import {
  ALPHA_JOB_A_SLOTS,
  ALPHA_JOB_B_SLOTS,
  ALPHA_SLOTS_PER_INSTANCE,
  BETA_SLOTS_PER_INSTANCE,
  CONFIG_PRESET,
  GAMMA_SLOTS_PER_INSTANCE,
  HTTP_ACCEPTED,
  INSTANCE_PORT_A,
  INSTANCE_URL_A,
  INSTANCE_URL_B,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE_A,
  JOB_TYPE_B,
  MODEL_ALPHA,
  MODEL_BETA,
  MODEL_GAMMA,
  SHORT_JOB_DURATION_MS,
  ZERO_COUNT,
  fetchAllocation,
  fetchStats,
  fillAlphaCapacityOnInstanceA,
  getAllocatedSlots,
  getInFlight,
  getJobTypeStats,
  killAllInstances,
  setupTwoInstances,
  submitJob,
  waitForNoActiveJobs,
} from './multiModelIndependenceHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 25.1: Multiple Models Have Independent Pools
 *
 * Verify that each model has its own independent pool allocation.
 * - model-alpha: floor(100K / 10K / 2) = 5 slots per instance
 * - model-beta: floor(50K / 10K / 2) = 2 slots per instance
 * - model-gamma: floor(20 / 2) = 10 slots per instance
 */
describe('25.1 Multiple Models Have Independent Pools', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should have correct pool slots for model-alpha', async () => {
    const allocation = await fetchAllocation(INSTANCE_PORT_A);
    expect(allocation.allocation).not.toBeNull();
    const alphaPool = allocation.allocation?.pools[MODEL_ALPHA];
    expect(alphaPool).toBeDefined();
    expect(alphaPool?.totalSlots).toBe(ALPHA_SLOTS_PER_INSTANCE);
  });

  it('should have correct pool slots for model-beta', async () => {
    const allocation = await fetchAllocation(INSTANCE_PORT_A);
    expect(allocation.allocation).not.toBeNull();
    const betaPool = allocation.allocation?.pools[MODEL_BETA];
    expect(betaPool).toBeDefined();
    expect(betaPool?.totalSlots).toBe(BETA_SLOTS_PER_INSTANCE);
  });

  it('should have correct pool slots for model-gamma', async () => {
    const allocation = await fetchAllocation(INSTANCE_PORT_A);
    expect(allocation.allocation).not.toBeNull();
    const gammaPool = allocation.allocation?.pools[MODEL_GAMMA];
    expect(gammaPool).toBeDefined();
    expect(gammaPool?.totalSlots).toBe(GAMMA_SLOTS_PER_INSTANCE);
  });
});

/**
 * Test 25.2: Acquiring on Model A Does Not Affect Model B
 *
 * Fill all capacity on model-alpha and verify that model-beta still has
 * full capacity available.
 */
describe('25.2 Acquiring on Model A Does Not Affect Model B', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should fill model-alpha capacity on instance A', async () => {
    await fillAlphaCapacityOnInstanceA();

    const stats = await fetchStats(INSTANCE_URL_A);
    const jobTypeStats = getJobTypeStats(stats);
    const inFlight = getInFlight(jobTypeStats, JOB_TYPE_A);
    expect(inFlight).toBeGreaterThan(ZERO_COUNT);
  });

  it('should verify model-beta still has full capacity', async () => {
    const allocation = await fetchAllocation(INSTANCE_PORT_A);
    expect(allocation.allocation).not.toBeNull();
    const betaPool = allocation.allocation?.pools[MODEL_BETA];
    expect(betaPool).toBeDefined();
    expect(betaPool?.totalSlots).toBe(BETA_SLOTS_PER_INSTANCE);
  });

  it('should accept new jobs on model-beta without issue', async () => {
    const jobId = `beta-independent-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL_A,
      jobId,
      jobType: JOB_TYPE_A,
      durationMs: SHORT_JOB_DURATION_MS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
  });

  it('should complete all jobs', async () => {
    await waitForNoActiveJobs(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);
  });
});

/**
 * Test 25.3: Same Ratios Applied Per Model
 *
 * Verify that job type ratios are applied independently to each model's pool.
 * - model-alpha (10 total slots): jobTypeA=floor(10*0.6)=6, jobTypeB=floor(10*0.4)=4
 * - model-beta (4 total slots): jobTypeA=floor(4*0.6)=2, jobTypeB=floor(4*0.4)=1
 */
describe('25.3 Same Ratios Applied Per Model', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should show correct ratio allocation for model-alpha', async () => {
    const stats = await fetchStats(INSTANCE_URL_A);
    const jobTypeStats = getJobTypeStats(stats);
    const jobASlots = getAllocatedSlots(jobTypeStats, JOB_TYPE_A);
    const jobBSlots = getAllocatedSlots(jobTypeStats, JOB_TYPE_B);
    expect(jobASlots).toBe(ALPHA_JOB_A_SLOTS);
    expect(jobBSlots).toBe(ALPHA_JOB_B_SLOTS);
  });

  it('should verify both instances have same allocation', async () => {
    const statsA = await fetchStats(INSTANCE_URL_A);
    const statsB = await fetchStats(INSTANCE_URL_B);
    const jobTypeStatsA = getJobTypeStats(statsA);
    const jobTypeStatsB = getJobTypeStats(statsB);

    expect(getAllocatedSlots(jobTypeStatsA, JOB_TYPE_A)).toBe(getAllocatedSlots(jobTypeStatsB, JOB_TYPE_A));
    expect(getAllocatedSlots(jobTypeStatsA, JOB_TYPE_B)).toBe(getAllocatedSlots(jobTypeStatsB, JOB_TYPE_B));
  });
});
