/**
 * Test suite: Two-Layer Acquire/Release - Additional (Test 24.2b, 24.3)
 *
 * Verifies cross-type independence and release behavior.
 *
 * Tests:
 * - 24.2b: Cross-type independence (two instances)
 * - 24.3: Release decrements in-flight counter (single instance)
 *
 * Config: high-twoLayer
 * - model-alpha: maxConcurrentRequests=10
 * - jobTypeA: ratio=0.6, jobTypeB: ratio=0.4
 */
import {
  CONFIG_PRESET,
  INSTANCE_URL,
  INSTANCE_URL_A,
  JOB_TYPE_A,
  JOB_TYPE_A_SLOTS_NONEQUAL_SINGLE,
  JOB_TYPE_B,
  LONG_JOB_DURATION_MS,
  MAX_CONCURRENT,
  SHORT_JOB_DURATION_MS,
  SUBMIT_JOB_TYPE_A_COUNT,
  SUBMIT_JOB_TYPE_B_COUNT,
  ZERO_IN_FLIGHT,
  fetchStats,
  getInFlight,
  getJobTypeStats,
  killAllInstances,
  setupSingleInstance,
  setupTwoInstances,
  submitJobBatch,
  submitSingleJobAndSettle,
  verifyAllJobsComplete,
  waitForNoActiveJobs,
} from './twoLayerAcquireReleaseHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 24.2b: Cross-Type Independence
 *
 * Fill jobTypeA, then verify jobTypeB starts immediately
 */
describe('24.2b Cross-Type Independence', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should fill jobTypeA capacity', async () => {
    await submitJobBatch({
      baseUrl: INSTANCE_URL_A,
      prefix: 'cross-a',
      jobType: JOB_TYPE_A,
      count: SUBMIT_JOB_TYPE_A_COUNT,
      durationMs: LONG_JOB_DURATION_MS,
    });

    const stats = await fetchStats(INSTANCE_URL_A);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getInFlight(jobTypeStats, JOB_TYPE_A)).toBe(SUBMIT_JOB_TYPE_A_COUNT);
  });

  it('should queue additional jobTypeA', async () => {
    await submitSingleJobAndSettle(INSTANCE_URL_A, 'cross-a-wait', JOB_TYPE_A, SHORT_JOB_DURATION_MS);

    const stats = await fetchStats(INSTANCE_URL_A);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getInFlight(jobTypeStats, JOB_TYPE_A)).toBe(SUBMIT_JOB_TYPE_A_COUNT);
  });

  it('should start jobTypeB immediately', async () => {
    await submitSingleJobAndSettle(INSTANCE_URL_A, 'cross-b', JOB_TYPE_B, LONG_JOB_DURATION_MS);

    const stats = await fetchStats(INSTANCE_URL_A);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getInFlight(jobTypeStats, JOB_TYPE_B)).toBe(SUBMIT_JOB_TYPE_B_COUNT);
  });

  it('should complete all jobs', async () => {
    await verifyAllJobsComplete(INSTANCE_URL_A, [JOB_TYPE_A, JOB_TYPE_B]);
  });
});

/**
 * Test 24.3: Release Decrements In-Flight Counter
 *
 * Single instance: fill capacity, verify, wait for release
 */
describe('24.3 Release Decrements In-Flight Counter', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should fill all concurrent capacity', async () => {
    await submitJobBatch({
      baseUrl: INSTANCE_URL,
      prefix: 'release-fill',
      jobType: JOB_TYPE_A,
      count: MAX_CONCURRENT,
      durationMs: LONG_JOB_DURATION_MS,
    });

    const stats = await fetchStats(INSTANCE_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getInFlight(jobTypeStats, JOB_TYPE_A)).toBe(JOB_TYPE_A_SLOTS_NONEQUAL_SINGLE);
  });

  it('should decrement in-flight after jobs complete', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, BEFORE_ALL_TIMEOUT_MS);
    const stats = await fetchStats(INSTANCE_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getInFlight(jobTypeStats, JOB_TYPE_A)).toBe(ZERO_IN_FLIGHT);
  });

  it('should accept new jobs after release', async () => {
    await submitSingleJobAndSettle(INSTANCE_URL, 'release-new', JOB_TYPE_A, LONG_JOB_DURATION_MS);

    const stats = await fetchStats(INSTANCE_URL);
    const jobTypeStats = getJobTypeStats(stats);
    expect(getInFlight(jobTypeStats, JOB_TYPE_A)).toBe(SUBMIT_JOB_TYPE_B_COUNT);
  });

  it('should complete final jobs', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, BEFORE_ALL_TIMEOUT_MS);
  });
});
