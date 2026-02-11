/**
 * Test suite: Model Escalation - Capacity Tracking (Test 22)
 *
 * Verifies capacity tracking during escalation.
 *
 * Tests 22.1-22.4:
 * - 22.1: Primary model not charged when escalating
 * - 22.2: Partial usage on primary before escalation
 * - 22.3: Same job not counted twice
 * - 22.4: Callback receives escalated model ID
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  ESTIMATED_TOKENS,
  FILL_JOB_DURATION_MS,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE_A,
  MODEL_ALPHA,
  MODEL_BETA,
  PARTIAL_TOKENS_INPUT,
  PARTIAL_TOKENS_OUTPUT,
  PARTIAL_TOKENS_TOTAL,
  QUICK_JOB_DURATION_MS,
  REJECT_CACHED_TOKENS,
  REJECT_REQUEST_COUNT,
  SETTLE_MS,
  STATUS_COMPLETED,
  TPM_CONFIG,
  TWO_JOBS_TOKENS,
  ZERO_COUNT,
  fetchJobHistory,
  fetchStats,
  findJobById,
  getTokensPerMinute,
  killAllInstances,
  setupSingleInstance,
  sleep,
  submitJob,
  submitRejectJob,
  waitForNoActiveJobs,
  waitForSafeMinuteWindow,
} from './modelEscalationCapacityTrackingHelpers.js';

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('22.1 Primary Model Not Charged When Escalating', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should not charge alpha TPM when job escalates to beta', async () => {
    await waitForSafeMinuteWindow();
    const timestamp = Date.now();
    const fillJobId = `tracking-fill-${timestamp}`;
    const escalateJobId = `tracking-escalate-${timestamp}`;

    const fillStatus = await submitJob(INSTANCE_URL, fillJobId, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    expect(fillStatus).toBe(HTTP_ACCEPTED);

    await sleep(SETTLE_MS);

    const escalateStatus = await submitJob(INSTANCE_URL, escalateJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    expect(escalateStatus).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const stats = await fetchStats(INSTANCE_URL);
    const alphaTpm = getTokensPerMinute(stats, MODEL_ALPHA);
    const betaTpm = getTokensPerMinute(stats, MODEL_BETA);

    expect(alphaTpm).toBeDefined();
    expect(betaTpm).toBeDefined();

    expect(alphaTpm?.current).toBe(ESTIMATED_TOKENS);
    expect(betaTpm?.current).toBe(ESTIMATED_TOKENS);
  });
});

describe('22.2 Partial Usage on Primary Before Escalation via reject()', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should reflect reject() usage in alpha TPM counter', async () => {
    await waitForSafeMinuteWindow();
    const timestamp = Date.now();
    const rejectJobId = `partial-reject-${timestamp}`;
    const escalateJobId = `partial-escalate-${timestamp}`;

    const rejectStatus = await submitRejectJob(INSTANCE_URL, rejectJobId, {
      inputTokens: PARTIAL_TOKENS_INPUT,
      outputTokens: PARTIAL_TOKENS_OUTPUT,
      cachedTokens: REJECT_CACHED_TOKENS,
      requestCount: REJECT_REQUEST_COUNT,
    });
    expect(rejectStatus).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const statsAfterReject = await fetchStats(INSTANCE_URL);
    const alphaTpm = getTokensPerMinute(statsAfterReject, MODEL_ALPHA);
    expect(alphaTpm).toBeDefined();
    expect(alphaTpm?.current).toBe(PARTIAL_TOKENS_TOTAL);

    const escalateStatus = await submitJob(INSTANCE_URL, escalateJobId, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    expect(escalateStatus).toBe(HTTP_ACCEPTED);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const escalateJob = findJobById(history, escalateJobId);
    expect(escalateJob).toBeDefined();
    expect(escalateJob?.status).toBe(STATUS_COMPLETED);
  });
});

describe('22.3 Same Job Not Counted Twice', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should count escalated job only in beta', async () => {
    await waitForSafeMinuteWindow();
    const timestamp = Date.now();
    const fillJobId = `double-fill-${timestamp}`;
    const escalateJobId = `double-escalate-${timestamp}`;

    await submitJob(INSTANCE_URL, fillJobId, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    await sleep(SETTLE_MS);

    await submitJob(INSTANCE_URL, escalateJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const stats = await fetchStats(INSTANCE_URL);
    const alphaTpm = getTokensPerMinute(stats, MODEL_ALPHA);
    const betaTpm = getTokensPerMinute(stats, MODEL_BETA);

    expect(alphaTpm?.current).toBe(ESTIMATED_TOKENS);
    expect(betaTpm?.current).toBe(ESTIMATED_TOKENS);

    const totalTokens = (alphaTpm?.current ?? ZERO_COUNT) + (betaTpm?.current ?? ZERO_COUNT);
    expect(totalTokens).toBe(TWO_JOBS_TOKENS);
  });
});

describe('22.4 Callback Receives Escalated Model ID', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should record beta as modelUsed in job history', async () => {
    await waitForSafeMinuteWindow();
    const timestamp = Date.now();
    const fillJobId = `callback-fill-${timestamp}`;
    const escalateJobId = `callback-escalate-${timestamp}`;

    await submitJob(INSTANCE_URL, fillJobId, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    await sleep(SETTLE_MS);

    await submitJob(INSTANCE_URL, escalateJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);

    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const { history } = await fetchJobHistory(INSTANCE_URL);
    const escalateJob = findJobById(history, escalateJobId);

    expect(escalateJob).toBeDefined();
    expect(escalateJob?.status).toBe(STATUS_COMPLETED);
    expect(escalateJob?.modelUsed).toBe(MODEL_BETA);
  });
});
