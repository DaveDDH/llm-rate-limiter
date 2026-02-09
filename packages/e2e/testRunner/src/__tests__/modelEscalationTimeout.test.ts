/**
 * Test suite: Model Escalation - Timeout (Test 21)
 *
 * Verifies escalation after maxWaitMS timeout.
 *
 * Tests 21.1-21.4:
 * - 21.1: Escalation after maxWaitMS timeout
 * - 21.2: Multiple timeout escalations
 * - 21.3: Reject after all timeouts
 * - 21.4: No escalation when capacity becomes available mid-wait
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CONC_WAIT_CONFIG,
  FILL_JOB_DURATION_MS,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE_A,
  MID_WAIT_FILL_MS,
  MODEL_ALPHA,
  MODEL_BETA,
  MODEL_GAMMA,
  MULTI_TIMEOUT_CONFIG,
  QUICK_JOB_DURATION_MS,
  SETTLE_MS,
  STATUS_COMPLETED,
  STATUS_FAILED,
  THREE_MODELS,
  TPM_WAIT_CONFIG,
  WAIT_MAX_5S,
  WAIT_MAX_8S,
  WAIT_MIN_5S,
  WAIT_MIN_8S,
  ZERO_COUNT,
  fetchJobHistory,
  findJobById,
  killAllInstances,
  setupSingleInstance,
  sleep,
  submitFillJobsWithSettle,
  submitJob,
  waitForNoActiveJobs,
} from './modelEscalationTimeoutHelpers.js';

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('21.1 Escalation After maxWaitMS Timeout', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_WAIT_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should escalate to beta after 5s wait on alpha', async () => {
    const timestamp = Date.now();
    const fillJobId = `timeout-fill-${timestamp}`;
    const waitJobId = `timeout-wait-${timestamp}`;

    const fillStatus = await submitJob(INSTANCE_URL, fillJobId, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    expect(fillStatus).toBe(HTTP_ACCEPTED);

    await sleep(SETTLE_MS);

    const waitStatus = await submitJob(INSTANCE_URL, waitJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(waitStatus).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const waitJob = findJobById(history, waitJobId);

    expect(waitJob).toBeDefined();
    expect(waitJob?.modelUsed).toBe(MODEL_BETA);
    expect(waitJob?.status).toBe(STATUS_COMPLETED);

    const waitTime = (waitJob?.startedAt ?? ZERO_COUNT) - (waitJob?.queuedAt ?? ZERO_COUNT);
    expect(waitTime).toBeGreaterThanOrEqual(WAIT_MIN_5S);
    expect(waitTime).toBeLessThanOrEqual(WAIT_MAX_5S);
  });
});

describe('21.2 Multiple Timeout Escalations', () => {
  beforeAll(async () => {
    await setupSingleInstance(MULTI_TIMEOUT_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should escalate through multiple models with timeouts', async () => {
    const timestamp = Date.now();
    const fillAlphaId = `multi-fill-alpha-${timestamp}`;
    const fillBetaId = `multi-fill-beta-${timestamp}`;
    const waitJobId = `multi-wait-${timestamp}`;

    await submitJob(INSTANCE_URL, fillAlphaId, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    await sleep(SETTLE_MS);

    await submitJob(INSTANCE_URL, fillBetaId, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    await sleep(SETTLE_MS);

    const waitStatus = await submitJob(INSTANCE_URL, waitJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(waitStatus).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const waitJob = findJobById(history, waitJobId);

    expect(waitJob).toBeDefined();
    expect(waitJob?.modelUsed).toBe(MODEL_GAMMA);
    expect(waitJob?.status).toBe(STATUS_COMPLETED);
  });
});

describe('21.3 Reject After All Timeouts', () => {
  beforeAll(async () => {
    await setupSingleInstance(MULTI_TIMEOUT_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should reject after exhausting all models and timeouts', async () => {
    const timestamp = Date.now();
    const fillPrefix = `reject-fill-${timestamp}`;
    await submitFillJobsWithSettle({
      baseUrl: INSTANCE_URL,
      count: THREE_MODELS,
      prefix: fillPrefix,
      jobType: JOB_TYPE_A,
      durationMs: FILL_JOB_DURATION_MS,
      settleMs: SETTLE_MS,
    });
    const rejectJobId = `reject-timeout-${timestamp}`;
    const queueTime = Date.now();
    const status = await submitJob(INSTANCE_URL, rejectJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const rejectJob = findJobById(history, rejectJobId);

    expect(rejectJob).toBeDefined();
    expect(rejectJob?.status).toBe(STATUS_FAILED);
    expect(rejectJob?.error).toBeDefined();

    const totalWaitTime = (rejectJob?.completedAt ?? ZERO_COUNT) - queueTime;
    expect(totalWaitTime).toBeGreaterThanOrEqual(WAIT_MIN_8S);
    expect(totalWaitTime).toBeLessThanOrEqual(WAIT_MAX_8S);
  });
});

describe('21.4 No Escalation When Capacity Available Mid-Wait', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONC_WAIT_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should use primary when it becomes available during wait', async () => {
    const timestamp = Date.now();
    const fillJobId = `midwait-fill-${timestamp}`;
    const waitJobId = `midwait-wait-${timestamp}`;

    await submitJob(INSTANCE_URL, fillJobId, JOB_TYPE_A, MID_WAIT_FILL_MS);
    await sleep(SETTLE_MS);

    const waitStatus = await submitJob(INSTANCE_URL, waitJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(waitStatus).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const waitJob = findJobById(history, waitJobId);

    expect(waitJob).toBeDefined();
    expect(waitJob?.modelUsed).toBe(MODEL_ALPHA);
    expect(waitJob?.status).toBe(STATUS_COMPLETED);
  });
});
