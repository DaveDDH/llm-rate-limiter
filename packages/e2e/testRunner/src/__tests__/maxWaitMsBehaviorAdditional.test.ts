/**
 * Test suite: maxWaitMS Behavior Additional (Test 14, cases 14.4, 14.6, 14.7)
 *
 * 14.4: Explicit maxWaitMS Value Respected
 * 14.6: Timeout Removes Job From Queue Correctly
 * 14.7: Job Completes During Wait
 *
 * Configs:
 * - medium-maxWait-explicit: model-alpha + model-beta, maxWaitMS=5000
 * - medium-maxWait-timeout: model-alpha + model-beta, maxWaitMS=2000
 * - medium-maxWait-release: model-alpha only, maxWaitMS=30000
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  EXPLICIT_CONFIG,
  EXPLICIT_WAIT_MIN_MS,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_SETTLE_MS,
  LONG_FILL_DURATION_MS,
  MEDIUM_FILL_DURATION_MS,
  QUICK_JOB_DURATION_MS,
  RELEASE_CONFIG,
  RELEASE_FILL_DURATION_MS,
  RELEASE_WAIT_MAX_MS,
  RELEASE_WAIT_MIN_MS,
  STATUS_COMPLETED,
  TIMEOUT_CONFIG,
  ZERO_COUNT,
  fetchJobHistory,
  findJobById,
  killAllInstances,
  setupSingleInstance,
  sleep,
  submitJob,
  waitForNoActiveJobs,
} from './maxWaitMsBehaviorHelpers.js';

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('14.4 Explicit maxWaitMS Value Respected', () => {
  beforeAll(async () => {
    await setupSingleInstance(EXPLICIT_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should delegate job-2 to model-beta after ~5s wait', async () => {
    const timestamp = Date.now();
    const job1Id = `explicit-job1-${timestamp}`;
    const job2Id = `explicit-job2-${timestamp}`;

    // Fill model-alpha with long-running job
    const status1 = await submitJob(INSTANCE_URL, job1Id, 'jobTypeA', LONG_FILL_DURATION_MS);
    expect(status1).toBe(HTTP_ACCEPTED);

    await sleep(JOB_SETTLE_MS);

    // Submit job-2 that will wait for maxWaitMS then delegate
    const job2StartTime = Date.now();
    const status2 = await submitJob(INSTANCE_URL, job2Id, 'jobTypeA', QUICK_JOB_DURATION_MS);
    expect(status2).toBe(HTTP_ACCEPTED);

    // Wait for job-2 to complete (it should delegate after ~5s)
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const job2 = findJobById(history, job2Id);

    expect(job2).toBeDefined();
    expect(job2?.modelUsed).toBe('model-beta');

    // Total time should be >= 4500ms (waited for timeout minus tolerance)
    const job2CompletedAt = job2?.completedAt ?? ZERO_COUNT;
    const totalTime = job2CompletedAt - job2StartTime;
    expect(totalTime).toBeGreaterThanOrEqual(EXPLICIT_WAIT_MIN_MS);
  });
});

describe('14.6 Timeout Removes Job From Queue Correctly', () => {
  beforeAll(async () => {
    await setupSingleInstance(TIMEOUT_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should delegate to beta after 2s timeout, both complete', async () => {
    const timestamp = Date.now();
    const job1Id = `timeout-job1-${timestamp}`;
    const job2Id = `timeout-job2-${timestamp}`;

    // Fill model-alpha with medium duration job
    const status1 = await submitJob(INSTANCE_URL, job1Id, 'jobTypeA', MEDIUM_FILL_DURATION_MS);
    expect(status1).toBe(HTTP_ACCEPTED);

    await sleep(JOB_SETTLE_MS);

    // Submit job-2 (will wait 2s then delegate to beta)
    const status2 = await submitJob(INSTANCE_URL, job2Id, 'jobTypeA', QUICK_JOB_DURATION_MS);
    expect(status2).toBe(HTTP_ACCEPTED);

    // Wait for both to complete
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const job1 = findJobById(history, job1Id);
    const job2 = findJobById(history, job2Id);

    expect(job1).toBeDefined();
    expect(job2).toBeDefined();

    // Both should complete successfully
    expect(job1?.status).toBe(STATUS_COMPLETED);
    expect(job2?.status).toBe(STATUS_COMPLETED);

    // job-2 should have been delegated to model-beta
    expect(job2?.modelUsed).toBe('model-beta');
  });
});

describe('14.7 Job Completes During Wait', () => {
  beforeAll(async () => {
    await setupSingleInstance(RELEASE_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should run job-2 on model-alpha after job-1 finishes', async () => {
    const timestamp = Date.now();
    const job1Id = `release-job1-${timestamp}`;
    const job2Id = `release-job2-${timestamp}`;

    // Job-1: 2s duration on model-alpha
    const status1 = await submitJob(INSTANCE_URL, job1Id, 'jobTypeA', RELEASE_FILL_DURATION_MS);
    expect(status1).toBe(HTTP_ACCEPTED);

    await sleep(JOB_SETTLE_MS);

    // Submit job-2 (will queue, then run when job-1 finishes)
    const status2 = await submitJob(INSTANCE_URL, job2Id, 'jobTypeA', QUICK_JOB_DURATION_MS);
    expect(status2).toBe(HTTP_ACCEPTED);

    // Wait for all to complete
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const job1 = findJobById(history, job1Id);
    const job2 = findJobById(history, job2Id);

    expect(job1).toBeDefined();
    expect(job2).toBeDefined();

    // Both run on model-alpha (no delegation needed)
    expect(job1?.modelUsed).toBe('model-alpha');
    expect(job2?.modelUsed).toBe('model-alpha');

    // job-2 queue duration should be between 1.5s and 3s
    const job2StartedAt = job2?.startedAt ?? ZERO_COUNT;
    const job2QueuedAt = job2?.queuedAt ?? ZERO_COUNT;
    const queueDuration = job2StartedAt - job2QueuedAt;
    expect(queueDuration).toBeGreaterThanOrEqual(RELEASE_WAIT_MIN_MS);
    expect(queueDuration).toBeLessThanOrEqual(RELEASE_WAIT_MAX_MS);
  });
});
