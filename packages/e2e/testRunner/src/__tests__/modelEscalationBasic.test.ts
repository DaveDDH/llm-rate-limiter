/**
 * Test suite: Model Escalation - Basic (Test 19)
 *
 * Verifies basic model escalation behavior.
 *
 * Tests 19.1-19.6:
 * - 19.1: No escalation when primary has capacity
 * - 19.2: Escalation to second model on capacity exhaustion
 * - 19.3: Escalation to third model
 * - 19.4: Escalation follows defined order
 * - 19.5: Single model - no escalation possible
 * - 19.6: Job rejects when all models exhausted
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  EXPECTED_SINGLE_MODEL,
  FILL_JOB_DURATION_MS,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE_A,
  MODEL_ALPHA,
  MODEL_BETA,
  MODEL_GAMMA,
  MODEL_PRIMARY,
  MODEL_SECONDARY,
  QUICK_JOB_DURATION_MS,
  SETTLE_MS,
  STATUS_COMPLETED,
  STATUS_FAILED,
  THREE_MODELS,
  THREE_MODEL_CONFIG,
  TWO_MODEL_CONFIG,
  fetchJobHistory,
  findJobById,
  killAllInstances,
  setupSingleInstance,
  sleep,
  submitFillJobsWithSettle,
  submitJob,
  waitForNoActiveJobs,
} from './modelEscalationBasicHelpers.js';

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('19.1 No Escalation When Primary Has Capacity', () => {
  beforeAll(async () => {
    await setupSingleInstance(TWO_MODEL_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should use primary model when capacity available', async () => {
    const timestamp = Date.now();
    const jobId = `no-escalation-${timestamp}`;

    const status = await submitJob(INSTANCE_URL, jobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const job = findJobById(history, jobId);

    expect(job).toBeDefined();
    expect(job?.status).toBe(STATUS_COMPLETED);
    expect(job?.modelUsed).toBe(MODEL_PRIMARY);
    expect(job?.modelsTried).toHaveLength(EXPECTED_SINGLE_MODEL);
  });
});

describe('19.2 Escalation to Second Model on Capacity Exhaustion', () => {
  beforeAll(async () => {
    await setupSingleInstance(TWO_MODEL_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should escalate to secondary when primary exhausted', async () => {
    const timestamp = Date.now();
    const fillJobId = `escalate-fill-${timestamp}`;
    const escalateJobId = `escalate-job-${timestamp}`;

    const fillStatus = await submitJob(INSTANCE_URL, fillJobId, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    expect(fillStatus).toBe(HTTP_ACCEPTED);

    await sleep(SETTLE_MS);

    const escalateStatus = await submitJob(INSTANCE_URL, escalateJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(escalateStatus).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const fillJob = findJobById(history, fillJobId);
    const escalateJob = findJobById(history, escalateJobId);

    expect(fillJob).toBeDefined();
    expect(fillJob?.modelUsed).toBe(MODEL_PRIMARY);
    expect(fillJob?.status).toBe(STATUS_COMPLETED);

    expect(escalateJob).toBeDefined();
    expect(escalateJob?.modelUsed).toBe(MODEL_SECONDARY);
    expect(escalateJob?.status).toBe(STATUS_COMPLETED);
  });
});

describe('19.3 Escalation to Third Model', () => {
  beforeAll(async () => {
    await setupSingleInstance(THREE_MODEL_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should escalate to third model when first two exhausted', async () => {
    const timestamp = Date.now();
    const fillAlphaId = `escalate-alpha-${timestamp}`;
    const fillBetaId = `escalate-beta-${timestamp}`;
    const gammaJobId = `escalate-gamma-${timestamp}`;

    const alphaStatus = await submitJob(INSTANCE_URL, fillAlphaId, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    expect(alphaStatus).toBe(HTTP_ACCEPTED);

    await sleep(SETTLE_MS);

    const betaStatus = await submitJob(INSTANCE_URL, fillBetaId, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    expect(betaStatus).toBe(HTTP_ACCEPTED);

    await sleep(SETTLE_MS);

    const gammaStatus = await submitJob(INSTANCE_URL, gammaJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(gammaStatus).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const gammaJob = findJobById(history, gammaJobId);

    expect(gammaJob).toBeDefined();
    expect(gammaJob?.modelUsed).toBe(MODEL_GAMMA);
    expect(gammaJob?.status).toBe(STATUS_COMPLETED);
  });
});

describe('19.4 Escalation Follows Defined Order', () => {
  beforeAll(async () => {
    await setupSingleInstance(THREE_MODEL_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should try models in escalation order', async () => {
    const timestamp = Date.now();
    const job1Id = `order-alpha-${timestamp}`;
    const job2Id = `order-beta-${timestamp}`;
    const job3Id = `order-gamma-${timestamp}`;

    await submitJob(INSTANCE_URL, job1Id, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    await sleep(SETTLE_MS);

    await submitJob(INSTANCE_URL, job2Id, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    await sleep(SETTLE_MS);

    await submitJob(INSTANCE_URL, job3Id, JOB_TYPE_A, QUICK_JOB_DURATION_MS);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const job1 = findJobById(history, job1Id);
    const job2 = findJobById(history, job2Id);
    const job3 = findJobById(history, job3Id);

    expect(job1?.modelUsed).toBe(MODEL_ALPHA);
    expect(job2?.modelUsed).toBe(MODEL_BETA);
    expect(job3?.modelUsed).toBe(MODEL_GAMMA);
  });
});

describe('19.6 Job Rejects When All Models Exhausted', () => {
  beforeAll(async () => {
    await setupSingleInstance(THREE_MODEL_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should reject job when all models at capacity', async () => {
    const timestamp = Date.now();
    const fillPrefix = `exhaust-${timestamp}`;
    await submitFillJobsWithSettle({
      baseUrl: INSTANCE_URL,
      count: THREE_MODELS,
      prefix: fillPrefix,
      jobType: JOB_TYPE_A,
      durationMs: FILL_JOB_DURATION_MS,
      settleMs: SETTLE_MS,
    });

    const rejectJobId = `reject-${timestamp}`;
    const status = await submitJob(INSTANCE_URL, rejectJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const rejectJob = findJobById(history, rejectJobId);

    expect(rejectJob).toBeDefined();
    expect(rejectJob?.status).toBe(STATUS_FAILED);
    expect(rejectJob?.error).toBeDefined();
  });
});
