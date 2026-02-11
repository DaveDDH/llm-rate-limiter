/**
 * Test suite: Actual Usage Overages - Additional Tests (Test 10 continued)
 *
 * Tests 10.4-10.5:
 * - 10.4: Cross-window overage still counted
 * - 10.5: Request overage tracked separately from token refund
 *
 * Config: slotCalc-tpm-single
 * - model-alpha: TPM=100K, RPM=1000
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=1, ratio=1.0
 * - 1 instance: floor(100K/10K/1) = 10 slots
 */
import {
  CONFIG_PRESET,
  FULL_RPM,
  FULL_TPM,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE,
  MIXED_INPUT_TOKENS,
  MIXED_OUTPUT_TOKENS,
  MIXED_REQUEST_COUNT,
  MIXED_TOTAL_TOKENS,
  MODEL_ID,
  OVERAGE_INPUT_TOKENS,
  OVERAGE_OUTPUT_TOKENS,
  SHORT_JOB_DURATION_MS,
  TOKEN_OVERAGE_AMOUNT,
  fetchOverages,
  fetchStats,
  getRequestsPerMinute,
  getSecondsIntoMinute,
  getTokensPerMinute,
  killAllInstances,
  setupSingleInstance,
  sleep,
  submitJob,
  waitForJobComplete,
  waitForMinuteBoundary,
} from './actualUsageOveragesHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;
const CROSS_WINDOW_TEST_TIMEOUT_MS = 120000;

// Cross-window overage test (10.4) constants
const CROSS_WINDOW_JOB_DURATION_MS = 10000;
const SECONDS_NEAR_END_OF_MINUTE = 50;
const MS_PER_SECOND = 1000;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/** Wait until we are near end of minute (past :50) */
const waitUntilNearMinuteEnd = async (): Promise<void> => {
  const currentSeconds = getSecondsIntoMinute();
  if (currentSeconds >= SECONDS_NEAR_END_OF_MINUTE) {
    return;
  }
  const waitMs = (SECONDS_NEAR_END_OF_MINUTE - currentSeconds) * MS_PER_SECOND;
  await sleep(waitMs);
};

/** Submit a cross-window overage job */
const submitCrossWindowOverageJob = async (jobId: string): Promise<number> =>
  await submitJob({
    baseUrl: INSTANCE_URL,
    jobId,
    jobType: JOB_TYPE,
    durationMs: CROSS_WINDOW_JOB_DURATION_MS,
    extraPayload: {
      actualInputTokens: OVERAGE_INPUT_TOKENS,
      actualOutputTokens: OVERAGE_OUTPUT_TOKENS,
    },
  });

/**
 * Test 10.4: Cross-Window Overage Still Counted
 *
 * Job starts near end of minute N with estimated 10K tokens.
 * Job completes in minute N+1 with actual 15K tokens (overage 5K).
 * Overages are always counted, even across windows.
 * Minute N+1 counter should reflect the overage amount.
 */
describe('10.4 Cross-Window Overage Still Counted', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it(
    'should count overage in completion window',
    async () => {
      await waitUntilNearMinuteEnd();

      const jobId = `cross-overage-${Date.now()}`;
      const status = await submitCrossWindowOverageJob(jobId);
      expect(status).toBe(HTTP_ACCEPTED);

      // Wait for minute boundary and job completion
      await waitForMinuteBoundary();
      await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

      // New window should reflect only the overage delta (actual - estimated)
      // The estimated 10K was already counted in the old window (no refund cross-window)
      const stats = await fetchStats(INSTANCE_URL);
      const tpm = getTokensPerMinute(stats, MODEL_ID);
      expect(tpm).toBeDefined();
      expect(tpm?.current).toBe(TOKEN_OVERAGE_AMOUNT);
    },
    CROSS_WINDOW_TEST_TIMEOUT_MS
  );
});

/** Submit the mixed refund/overage job used by test 10.5 */
const submitMixedJob = async (): Promise<void> => {
  const jobId = `mixed-${Date.now()}`;
  const status = await submitJob({
    baseUrl: INSTANCE_URL,
    jobId,
    jobType: JOB_TYPE,
    durationMs: SHORT_JOB_DURATION_MS,
    extraPayload: {
      actualInputTokens: MIXED_INPUT_TOKENS,
      actualOutputTokens: MIXED_OUTPUT_TOKENS,
      actualRequestCount: MIXED_REQUEST_COUNT,
    },
  });
  expect(status).toBe(HTTP_ACCEPTED);
  await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
};

/**
 * Test 10.5a: Token Refund Side of Mixed Scenario
 *
 * Tokens: actual 8000 < estimated 10000 (refund 2000)
 * Token counter should show 8000 (refund applied).
 */
describe('10.5a Token Refund in Mixed Scenario', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
    await submitMixedJob();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should show refunded token usage in TPM counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(MIXED_TOTAL_TOKENS);
  });

  it('should show correct remaining TPM after token refund', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    const expectedRemaining = FULL_TPM - MIXED_TOTAL_TOKENS;
    expect(tpm?.remaining).toBe(expectedRemaining);
  });
});

/**
 * Test 10.5b: Request Overage Side of Mixed Scenario
 *
 * Requests: actual 3 > estimated 1 (overage 2)
 * Request counter should show 3 (overage applied).
 * Overages endpoint should record the request overage event.
 */
describe('10.5b Request Overage in Mixed Scenario', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
    await submitMixedJob();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should show overage request count in RPM counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const rpm = getRequestsPerMinute(stats, MODEL_ID);
    expect(rpm).toBeDefined();
    expect(rpm?.current).toBe(MIXED_REQUEST_COUNT);
  });

  it('should show correct remaining RPM after request overage', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const rpm = getRequestsPerMinute(stats, MODEL_ID);
    expect(rpm).toBeDefined();
    const expectedRemaining = FULL_RPM - MIXED_REQUEST_COUNT;
    expect(rpm?.remaining).toBe(expectedRemaining);
  });

  it('should record request overage in overages endpoint', async () => {
    const overages = await fetchOverages(INSTANCE_URL);
    const requestOverage = overages.overages.find((e) => e.resourceType === 'requests');
    expect(requestOverage).toBeDefined();
  });
});
