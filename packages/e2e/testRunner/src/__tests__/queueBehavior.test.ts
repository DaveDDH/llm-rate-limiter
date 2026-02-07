/**
 * Test suite: Queue Behavior (Test 13, cases 13.1, 13.2, 13.4)
 *
 * Verifies queue behavior with concurrency-based rate limiting.
 *
 * 13.1: Job Queued When Capacity Unavailable
 * 13.2: Queued Job Starts When Capacity Available
 * 13.4: Concurrent Acquires Respect Pool Limit
 *
 * Config: medium-queue-concurrent
 * model-alpha: maxConcurrent=5, maxWaitMS=60000
 * 1 instance → 5 concurrent slots
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CONFIG_PRESET,
  EXPECTED_ACTIVE_WITH_QUEUE,
  FILL_CAPACITY_COUNT,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_SETTLE_MS,
  LONG_JOB_DURATION_MS,
  MAX_CONCURRENT,
  SHORT_JOB_DURATION_MS,
  SIMULTANEOUS_JOBS,
  ZERO_COUNT,
  fetchActiveJobs,
  fetchStats,
  killAllInstances,
  setupSingleInstance,
  sleep,
  submitJob,
  submitJobBatch,
  waitForNoActiveJobs,
} from './queueBehaviorHelpers.js';

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('13.1 Job Queued When Capacity Unavailable', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should queue a 6th job when 5 slots are full', async () => {
    const timestamp = Date.now();

    // Fill all 5 concurrent slots with long-running jobs
    await submitJobBatch(INSTANCE_URL, 'fill', FILL_CAPACITY_COUNT, LONG_JOB_DURATION_MS);

    await sleep(JOB_SETTLE_MS);

    // Submit one more job that should be queued
    const extraJobId = `queued-${timestamp}`;
    const status = await submitJob(INSTANCE_URL, extraJobId, 'jobTypeA', LONG_JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);

    await sleep(JOB_SETTLE_MS);

    // Active jobs should include all 6 (5 running + 1 queued)
    const activeJobs = await fetchActiveJobs(INSTANCE_URL);
    expect(activeJobs.count).toBe(EXPECTED_ACTIVE_WITH_QUEUE);
  });
});

describe('13.2 Queued Job Starts When Capacity Available', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete all 6 jobs after first batch finishes', async () => {
    // Fill slots with short jobs
    await submitJobBatch(INSTANCE_URL, 'short', FILL_CAPACITY_COUNT, SHORT_JOB_DURATION_MS);

    // Submit one more queued job
    const timestamp = Date.now();
    const queuedJobId = `queued-short-${timestamp}`;
    const status = await submitJob(INSTANCE_URL, queuedJobId, 'jobTypeA', SHORT_JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);

    // Wait for all jobs to finish
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const activeJobs = await fetchActiveJobs(INSTANCE_URL);
    expect(activeJobs.count).toBe(ZERO_COUNT);
  });
});

describe('13.4 Concurrent Acquires Respect Pool Limit', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should limit active concurrency to 5', async () => {
    // Submit 10 jobs simultaneously, all long-running
    await submitJobBatch(INSTANCE_URL, 'concurrent', SIMULTANEOUS_JOBS, LONG_JOB_DURATION_MS);

    await sleep(JOB_SETTLE_MS);

    // Check concurrency stats: only 5 should be active
    const stats = await fetchStats(INSTANCE_URL);
    const concurrency = stats.stats.models['model-alpha']?.concurrency;
    expect(concurrency).toBeDefined();
    expect(concurrency?.active).toBe(MAX_CONCURRENT);
  });
});
