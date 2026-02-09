/**
 * Test suite: Two-Layer Acquire/Release (Test 24)
 *
 * Verifies local-then-Redis two-layer acquire pattern where jobs must satisfy
 * both local job type slot constraints and global Redis pool constraints.
 *
 * Tests 24.1 and 24.2 (allocation + fill):
 * - 24.1: Two-layer check - local then Redis (single instance)
 * - 24.2a: In-flight constraint - allocation and fill (two instances)
 *
 * Config: high-twoLayer
 * - model-alpha: maxConcurrentRequests=10
 * - jobTypeA: ratio=0.6, jobTypeB: ratio=0.4
 */
import {
  CONFIG_PRESET,
  EXPECTED_RUNNING_TEST_ONE,
  INSTANCE_URL,
  INSTANCE_URL_A,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE_A,
  JOB_TYPE_A_SLOTS_SINGLE,
  JOB_TYPE_A_SLOTS_TWO,
  JOB_TYPE_B,
  JOB_TYPE_B_SLOTS_TWO,
  LONG_JOB_DURATION_MS,
  SUBMIT_COUNT_TEST_ONE,
  SUBMIT_JOB_TYPE_A_COUNT,
  ZERO_COUNT,
  fetchStats,
  getAllocatedSlots,
  getInFlight,
  getJobTypeStats,
  killAllInstances,
  setupSingleInstance,
  setupTwoInstances,
  submitJobBatch,
  waitForNoActiveJobs,
} from './twoLayerAcquireReleaseHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 24.1: Two-Layer Check - Local Then Redis
 *
 * Single instance: 10 total slots, jobTypeA ratio 0.6 = 6 slots
 * Submit 6, only 5 should run (local limit)
 */
describe('24.1 Two-Layer Check - Local Then Redis', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should show correct allocated slots for jobTypeA', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jobTypeStats = getJobTypeStats(stats);
    const allocatedSlots = getAllocatedSlots(jobTypeStats, JOB_TYPE_A);
    expect(allocatedSlots).toBe(JOB_TYPE_A_SLOTS_SINGLE);
  });

  it('should run 5 jobs and queue the 6th', async () => {
    await submitJobBatch({
      baseUrl: INSTANCE_URL,
      prefix: 'two-layer',
      jobType: JOB_TYPE_A,
      count: SUBMIT_COUNT_TEST_ONE,
      durationMs: LONG_JOB_DURATION_MS,
    });

    const stats = await fetchStats(INSTANCE_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getInFlight(jobTypeStats, JOB_TYPE_A)).toBe(EXPECTED_RUNNING_TEST_ONE);
  });

  it('should complete all jobs without failures', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
    const stats = await fetchStats(INSTANCE_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getInFlight(jobTypeStats, JOB_TYPE_A)).toBe(ZERO_COUNT);
  });
});

/**
 * Test 24.2a: In-Flight Constraint - Allocation and Fill
 *
 * Two-instance scenario: each has 5 pool slots
 * jobTypeA: 3 slots, jobTypeB: 2 slots per instance
 */
describe('24.2a In-Flight Constraint - Allocation and Fill', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should show correct allocated slots', async () => {
    const stats = await fetchStats(INSTANCE_URL_A);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getAllocatedSlots(jobTypeStats, JOB_TYPE_A)).toBe(JOB_TYPE_A_SLOTS_TWO);
    expect(getAllocatedSlots(jobTypeStats, JOB_TYPE_B)).toBe(JOB_TYPE_B_SLOTS_TWO);
  });

  it('should fill jobTypeA capacity', async () => {
    await submitJobBatch({
      baseUrl: INSTANCE_URL_A,
      prefix: 'in-flight-a',
      jobType: JOB_TYPE_A,
      count: SUBMIT_JOB_TYPE_A_COUNT,
      durationMs: LONG_JOB_DURATION_MS,
    });

    const stats = await fetchStats(INSTANCE_URL_A);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getInFlight(jobTypeStats, JOB_TYPE_A)).toBe(SUBMIT_JOB_TYPE_A_COUNT);
  });

  it('should complete all jobs', async () => {
    await waitForNoActiveJobs(INSTANCE_URL_A, JOB_COMPLETE_TIMEOUT_MS);
  });
});
