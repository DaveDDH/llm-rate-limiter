/**
 * Test suite: Model Escalation - Rate Limit Types (Test 20)
 *
 * Verifies escalation triggered by different rate limit types.
 *
 * Tests 20.1-20.3:
 * - 20.1: TPM exhaustion triggers escalation
 * - 20.2: RPM exhaustion triggers escalation
 * - 20.3: Concurrent limit triggers escalation
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CONCURRENT_ESCALATION_CONFIG,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE_A,
  LONG_JOB_DURATION_MS,
  MODEL_ALPHA,
  MODEL_BETA,
  QUICK_JOB_DURATION_MS,
  RPM_ESCALATION_CONFIG,
  SETTLE_MS,
  STATUS_COMPLETED,
  TPM_ESCALATION_CONFIG,
  fetchJobHistory,
  findJobById,
  killAllInstances,
  setupSingleInstance,
  sleep,
  submitJob,
  waitForNoActiveJobs,
} from './modelEscalationRateLimitsHelpers.js';

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('20.1 TPM Exhaustion Triggers Escalation', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_ESCALATION_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should escalate to beta when alpha TPM exhausted', async () => {
    const timestamp = Date.now();
    const fillJobId = `tpm-fill-${timestamp}`;
    const escalateJobId = `tpm-escalate-${timestamp}`;

    const fillStatus = await submitJob(INSTANCE_URL, fillJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(fillStatus).toBe(HTTP_ACCEPTED);

    await sleep(SETTLE_MS);

    const escalateStatus = await submitJob(INSTANCE_URL, escalateJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(escalateStatus).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const fillJob = findJobById(history, fillJobId);
    const escalateJob = findJobById(history, escalateJobId);

    expect(fillJob).toBeDefined();
    expect(fillJob?.modelUsed).toBe(MODEL_ALPHA);
    expect(fillJob?.status).toBe(STATUS_COMPLETED);

    expect(escalateJob).toBeDefined();
    expect(escalateJob?.modelUsed).toBe(MODEL_BETA);
    expect(escalateJob?.status).toBe(STATUS_COMPLETED);
  });
});

describe('20.2 RPM Exhaustion Triggers Escalation', () => {
  beforeAll(async () => {
    await setupSingleInstance(RPM_ESCALATION_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should escalate to beta when alpha RPM exhausted', async () => {
    const timestamp = Date.now();
    const fillJobId = `rpm-fill-${timestamp}`;
    const escalateJobId = `rpm-escalate-${timestamp}`;

    const fillStatus = await submitJob(INSTANCE_URL, fillJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(fillStatus).toBe(HTTP_ACCEPTED);

    await sleep(SETTLE_MS);

    const escalateStatus = await submitJob(INSTANCE_URL, escalateJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(escalateStatus).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const fillJob = findJobById(history, fillJobId);
    const escalateJob = findJobById(history, escalateJobId);

    expect(fillJob).toBeDefined();
    expect(fillJob?.modelUsed).toBe(MODEL_ALPHA);
    expect(fillJob?.status).toBe(STATUS_COMPLETED);

    expect(escalateJob).toBeDefined();
    expect(escalateJob?.modelUsed).toBe(MODEL_BETA);
    expect(escalateJob?.status).toBe(STATUS_COMPLETED);
  });
});

describe('20.3 Concurrent Limit Triggers Escalation', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONCURRENT_ESCALATION_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should escalate to beta when alpha concurrent exhausted', async () => {
    const timestamp = Date.now();
    const fillJobId = `conc-fill-${timestamp}`;
    const escalateJobId = `conc-escalate-${timestamp}`;

    const fillStatus = await submitJob(INSTANCE_URL, fillJobId, JOB_TYPE_A, LONG_JOB_DURATION_MS);
    expect(fillStatus).toBe(HTTP_ACCEPTED);

    await sleep(SETTLE_MS);

    const escalateStatus = await submitJob(INSTANCE_URL, escalateJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(escalateStatus).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const escalateJob = findJobById(history, escalateJobId);

    expect(escalateJob).toBeDefined();
    expect(escalateJob?.modelUsed).toBe(MODEL_BETA);
    expect(escalateJob?.status).toBe(STATUS_COMPLETED);
  });
});
