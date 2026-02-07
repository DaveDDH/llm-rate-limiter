/**
 * Test suite: maxWaitMS Behavior (Test 14, cases 14.2-14.3)
 *
 * 14.2: maxWaitMS=0 Causes Immediate Delegation
 * 14.3: maxWaitMS=0 Causes Immediate Rejection When No Fallback
 *
 * Configs:
 * - medium-maxWait-twoModel: model-primary + model-secondary, maxWaitMS=0 for primary
 * - medium-maxWait-singleModel: model-only, maxWaitMS=0, no fallback
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  FILL_JOB_DURATION_MS,
  HTTP_ACCEPTED,
  IMMEDIATE_DELEGATION_MAX_MS,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_SETTLE_MS,
  QUICK_JOB_DURATION_MS,
  SINGLE_MODEL_CONFIG,
  STATUS_COMPLETED,
  STATUS_FAILED,
  TWO_MODEL_CONFIG,
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
  });
});
