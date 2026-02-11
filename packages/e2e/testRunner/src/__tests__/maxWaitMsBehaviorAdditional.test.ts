/**
 * Test suite: maxWaitMS Behavior Additional (Test 14, cases 14.4-14.8)
 *
 * 14.4: Explicit maxWaitMS Value Respected
 * 14.5: Per-Model maxWaitMS Configuration
 * 14.6: Timeout Removes Job From Queue Correctly
 * 14.7: Job Completes During Wait
 * 14.8: Multiple Jobs Timeout Simultaneously
 *
 * Configs:
 * - medium-maxWait-explicit: model-alpha + model-beta, maxWaitMS=5000
 * - medium-maxWait-perModel: model-fast(1s) + model-slow(10s) + fallback
 * - medium-maxWait-timeout: model-alpha + model-beta, maxWaitMS=2000
 * - medium-maxWait-release: model-alpha only, maxWaitMS=30000
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  EXPLICIT_CONFIG,
  EXPLICIT_WAIT_MAX_MS,
  EXPLICIT_WAIT_MIN_MS,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_SETTLE_MS,
  LONG_FILL_DURATION_MS,
  MEDIUM_FILL_DURATION_MS,
  PER_MODEL_CONFIG,
  PER_MODEL_TOTAL_WAIT_MAX_MS,
  PER_MODEL_TOTAL_WAIT_MIN_MS,
  QUICK_JOB_DURATION_MS,
  RELEASE_CONFIG,
  RELEASE_FILL_DURATION_MS,
  RELEASE_WAIT_MAX_MS,
  RELEASE_WAIT_MIN_MS,
  SIMULTANEOUS_JOB_COUNT,
  SIMULTANEOUS_WAIT_MAX_MS,
  STATUS_COMPLETED,
  TIMEOUT_CONFIG,
  TIMEOUT_DELEGATION_MAX_MS,
  TIMEOUT_DELEGATION_MIN_MS,
  ZERO_COUNT,
  fetchJobHistory,
  findJobById,
  killAllInstances,
  setupSingleInstance,
  sleep,
  submitJob,
  waitForNoActiveJobs,
} from './maxWaitMsBehaviorHelpers.js';

const PER_MODEL_TEST_TIMEOUT_MS = 90000;
const SIMULTANEOUS_TEST_TIMEOUT_MS = 90000;

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

    // Total time should be >= 4900ms and <= 5500ms (waited for 5s timeout)
    const job2CompletedAt = job2?.completedAt ?? ZERO_COUNT;
    const totalTime = job2CompletedAt - job2StartTime;
    expect(totalTime).toBeGreaterThanOrEqual(EXPLICIT_WAIT_MIN_MS);
    expect(totalTime).toBeLessThanOrEqual(EXPLICIT_WAIT_MAX_MS);
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

    // job-2 queue duration should reflect 2s timeout before delegation
    const job2StartedAt = job2?.startedAt ?? ZERO_COUNT;
    const job2QueuedAt = job2?.queuedAt ?? ZERO_COUNT;
    const queueDuration = job2StartedAt - job2QueuedAt;
    expect(queueDuration).toBeGreaterThanOrEqual(TIMEOUT_DELEGATION_MIN_MS);
    expect(queueDuration).toBeLessThanOrEqual(TIMEOUT_DELEGATION_MAX_MS);
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

/**
 * Test 14.5: Per-Model maxWaitMS Configuration
 *
 * Config: model-fast(1s) + model-slow(10s) + model-fallback.
 * Fill model-fast and model-slow, then submit job-3.
 * Job-3 waits 1s on model-fast, escalates to model-slow,
 * waits 10s on model-slow, escalates to model-fallback.
 * Total wait >= 10.5s and <= 13s.
 */
describe('14.5 Per-Model maxWaitMS Configuration', () => {
  beforeAll(async () => {
    await setupSingleInstance(PER_MODEL_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it(
    'should escalate through per-model timeouts to fallback',
    async () => {
      const timestamp = Date.now();
      const fill1Id = `permodel-fill1-${timestamp}`;
      const fill2Id = `permodel-fill2-${timestamp}`;
      const job3Id = `permodel-job3-${timestamp}`;

      // Fill model-fast and model-slow with long-running jobs
      const s1 = await submitJob(INSTANCE_URL, fill1Id, 'jobTypeA', LONG_FILL_DURATION_MS);
      expect(s1).toBe(HTTP_ACCEPTED);
      const s2 = await submitJob(INSTANCE_URL, fill2Id, 'jobTypeA', LONG_FILL_DURATION_MS);
      expect(s2).toBe(HTTP_ACCEPTED);

      await sleep(JOB_SETTLE_MS);

      // Submit job-3, which must escalate through both
      const job3Start = Date.now();
      const s3 = await submitJob(INSTANCE_URL, job3Id, 'jobTypeA', QUICK_JOB_DURATION_MS);
      expect(s3).toBe(HTTP_ACCEPTED);

      await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

      const { history } = await fetchJobHistory(INSTANCE_URL);
      const job3 = findJobById(history, job3Id);
      expect(job3).toBeDefined();
      expect(job3?.modelUsed).toBe('model-fallback');

      const job3CompletedAt = job3?.completedAt ?? ZERO_COUNT;
      const totalTime = job3CompletedAt - job3Start;
      expect(totalTime).toBeGreaterThanOrEqual(PER_MODEL_TOTAL_WAIT_MIN_MS);
      expect(totalTime).toBeLessThanOrEqual(PER_MODEL_TOTAL_WAIT_MAX_MS);
    },
    PER_MODEL_TEST_TIMEOUT_MS
  );
});

/** Submit multiple simultaneous jobs */
const submitSimultaneousJobs = async (count: number, prefix: string): Promise<string[]> => {
  const ids = Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
  const promises = ids.map(async (id) => {
    const status = await submitJob(INSTANCE_URL, id, 'jobTypeA', QUICK_JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);
  });
  await Promise.all(promises);
  return ids;
};

/**
 * Test 14.8: Multiple Jobs Timeout Simultaneously
 *
 * Config: medium-maxWait-explicit (maxWaitMS=5000).
 * Fill model-alpha, submit 10 jobs at once.
 * All should be delegated to model-beta after ~5s.
 */
describe('14.8 Multiple Jobs Timeout Simultaneously', () => {
  beforeAll(async () => {
    await setupSingleInstance(EXPLICIT_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it(
    'should delegate all 10 jobs after ~5s timeout',
    async () => {
      const timestamp = Date.now();
      const fillId = `simul-fill-${timestamp}`;

      // Fill model-alpha
      const fillStatus = await submitJob(INSTANCE_URL, fillId, 'jobTypeA', LONG_FILL_DURATION_MS);
      expect(fillStatus).toBe(HTTP_ACCEPTED);

      await sleep(JOB_SETTLE_MS);

      const submitStart = Date.now();
      const jobIds = await submitSimultaneousJobs(SIMULTANEOUS_JOB_COUNT, `simul-${timestamp}`);

      await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

      const { history } = await fetchJobHistory(INSTANCE_URL);
      const jobs = jobIds.map((id) => findJobById(history, id));

      // All jobs should have been delegated to model-beta
      for (const job of jobs) {
        expect(job).toBeDefined();
        expect(job?.status).toBe(STATUS_COMPLETED);
        expect(job?.modelUsed).toBe('model-beta');
      }

      // All delegation times should be approximately 5s
      for (const job of jobs) {
        const queuedAt = job?.queuedAt ?? ZERO_COUNT;
        const delegationTime = queuedAt - submitStart;
        expect(delegationTime).toBeLessThanOrEqual(SIMULTANEOUS_WAIT_MAX_MS);
      }
    },
    SIMULTANEOUS_TEST_TIMEOUT_MS
  );
});
