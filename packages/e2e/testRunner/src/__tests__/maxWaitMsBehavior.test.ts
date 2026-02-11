/**
 * Test suite: maxWaitMS Behavior (Test 14, cases 14.1-14.3)
 *
 * 14.1: Default maxWaitMS Calculated from Time to Next Minute + 5s
 * 14.2: maxWaitMS=0 Causes Immediate Delegation
 * 14.3: maxWaitMS=0 Causes Immediate Rejection When No Fallback
 *
 * Configs:
 * - medium-maxWait-default: model-alpha + model-beta, no explicit maxWaitMS
 * - medium-maxWait-twoModel: model-primary + model-secondary, maxWaitMS=0
 * - medium-maxWait-singleModel: model-only, maxWaitMS=0, no fallback
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  DEFAULT_CONFIG,
  DEFAULT_TIMING_TOLERANCE_MS,
  DEFAULT_WAIT_BUFFER_S,
  DEFAULT_WAIT_FILL_MS,
  FILL_JOB_DURATION_MS,
  HTTP_ACCEPTED,
  IMMEDIATE_DELEGATION_MAX_MS,
  IMMEDIATE_REJECTION_MAX_MS,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_SETTLE_MS,
  QUICK_JOB_DURATION_MS,
  SECONDS_PER_MINUTE,
  SINGLE_MODEL_CONFIG,
  STATUS_COMPLETED,
  STATUS_FAILED,
  TWO_MODEL_CONFIG,
  ZERO_COUNT,
  fetchJobHistory,
  findJobById,
  getSecondsIntoMinute,
  killAllInstances,
  setupSingleInstance,
  sleep,
  submitJob,
  waitForNoActiveJobs,
} from './maxWaitMsBehaviorHelpers.js';

const DEFAULT_TEST_TIMEOUT_MS = 120000;
const MS_PER_SECOND = 1000;

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/** Calculate expected default maxWaitMS from current second */
const calcExpectedDefaultWait = (secondsInMinute: number): number =>
  (SECONDS_PER_MINUTE - secondsInMinute + DEFAULT_WAIT_BUFFER_S) * MS_PER_SECOND;

/**
 * Test 14.1: Default maxWaitMS Calculated from Time to Next Minute + 5s
 *
 * When no explicit maxWaitMS is configured, the system uses the default:
 * (60 - secondsInMinute + 5) * 1000 ms.
 * Fill capacity, submit a queued job, and verify delegation timing.
 */
describe('14.1 Default maxWaitMS Calculated', () => {
  beforeAll(async () => {
    await setupSingleInstance(DEFAULT_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it(
    'should delegate after default wait based on minute position',
    async () => {
      const timestamp = Date.now();
      const job1Id = `default-fill-${timestamp}`;
      const job2Id = `default-wait-${timestamp}`;

      // Fill model-alpha with long-running job (must outlast default maxWaitMS of up to 65s)
      const status1 = await submitJob(INSTANCE_URL, job1Id, 'jobTypeA', DEFAULT_WAIT_FILL_MS);
      expect(status1).toBe(HTTP_ACCEPTED);

      await sleep(JOB_SETTLE_MS);

      // Record second in minute when job-2 is submitted
      const secondsAtSubmit = getSecondsIntoMinute();
      const expectedWait = calcExpectedDefaultWait(secondsAtSubmit);

      const job2Start = Date.now();
      const status2 = await submitJob(INSTANCE_URL, job2Id, 'jobTypeA', QUICK_JOB_DURATION_MS);
      expect(status2).toBe(HTTP_ACCEPTED);

      // Wait for job-2 to complete via delegation
      await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

      const { history } = await fetchJobHistory(INSTANCE_URL);
      const job2 = findJobById(history, job2Id);
      expect(job2).toBeDefined();

      // Job should have been delegated to model-beta
      expect(job2?.modelUsed).toBe('model-beta');

      // Verify timing matches default formula within tolerance
      const job2CompletedAt = job2?.completedAt ?? ZERO_COUNT;
      const totalTime = job2CompletedAt - job2Start;
      const minExpected = expectedWait - DEFAULT_TIMING_TOLERANCE_MS;
      const maxExpected = expectedWait + DEFAULT_TIMING_TOLERANCE_MS;
      expect(totalTime).toBeGreaterThanOrEqual(minExpected);
      expect(totalTime).toBeLessThanOrEqual(maxExpected);
    },
    DEFAULT_TEST_TIMEOUT_MS
  );
});

describe('14.2 maxWaitMS=0 Causes Immediate Delegation', () => {
  beforeAll(async () => {
    await setupSingleInstance(TWO_MODEL_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should delegate job-2 to model-secondary immediately', async () => {
    const timestamp = Date.now();
    const job1Id = `delegation-job1-${timestamp}`;
    const job2Id = `delegation-job2-${timestamp}`;

    // Fill model-primary capacity with job-1
    const status1 = await submitJob(INSTANCE_URL, job1Id, 'jobTypeA', QUICK_JOB_DURATION_MS);
    expect(status1).toBe(HTTP_ACCEPTED);

    // Immediately submit job-2 (should delegate to secondary)
    const status2 = await submitJob(INSTANCE_URL, job2Id, 'jobTypeA', QUICK_JOB_DURATION_MS);
    expect(status2).toBe(HTTP_ACCEPTED);

    // Wait for both to complete
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const job1 = findJobById(history, job1Id);
    const job2 = findJobById(history, job2Id);

    expect(job1).toBeDefined();
    expect(job2).toBeDefined();

    // job-1 uses model-primary, job-2 uses model-secondary
    expect(job1?.modelUsed).toBe('model-primary');
    expect(job2?.modelUsed).toBe('model-secondary');

    // job-2 should complete quickly (delegation was immediate)
    const completedAt = job2?.completedAt ?? ZERO_COUNT;
    const queuedAt = job2?.queuedAt ?? ZERO_COUNT;
    const job2Duration = completedAt - queuedAt;
    expect(job2Duration).toBeLessThan(IMMEDIATE_DELEGATION_MAX_MS);
  });
});

describe('14.3 maxWaitMS=0 Immediate Rejection No Fallback', () => {
  beforeAll(async () => {
    await setupSingleInstance(SINGLE_MODEL_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should reject job-2 when no fallback model exists', async () => {
    const timestamp = Date.now();
    const job1Id = `reject-job1-${timestamp}`;
    const job2Id = `reject-job2-${timestamp}`;

    // Fill model-only capacity with job-1
    const status1 = await submitJob(INSTANCE_URL, job1Id, 'jobTypeA', FILL_JOB_DURATION_MS);
    expect(status1).toBe(HTTP_ACCEPTED);

    // Wait for job-1 to start processing
    await sleep(JOB_SETTLE_MS);

    // Submit job-2 (should be rejected - no capacity, no fallback)
    const status2 = await submitJob(INSTANCE_URL, job2Id, 'jobTypeA', QUICK_JOB_DURATION_MS);
    expect(status2).toBe(HTTP_ACCEPTED);

    // Wait for all jobs to settle
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const job1 = findJobById(history, job1Id);
    const job2 = findJobById(history, job2Id);

    expect(job1).toBeDefined();
    expect(job2).toBeDefined();

    // job-1 completed, job-2 failed
    expect(job1?.status).toBe(STATUS_COMPLETED);
    expect(job2?.status).toBe(STATUS_FAILED);

    // job-2 error should mention capacity
    expect(job2?.error).toBeDefined();

    // job-2 should be rejected immediately (within 500ms)
    const completedAt = job2?.completedAt ?? ZERO_COUNT;
    const queuedAt = job2?.queuedAt ?? ZERO_COUNT;
    const rejectionDuration = completedAt - queuedAt;
    expect(rejectionDuration).toBeLessThan(IMMEDIATE_REJECTION_MAX_MS);
  });
});
