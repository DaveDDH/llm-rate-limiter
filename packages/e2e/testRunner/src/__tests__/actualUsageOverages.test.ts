/**
 * Test suite: Actual Usage Overages (Test 10)
 *
 * Verifies that when a job completes with more actual usage than estimated,
 * the overage is added to capacity counters and tracked via callbacks.
 *
 * Tests 10.1-10.3:
 * - 10.1: Overage Added to Counter
 * - 10.2: onOverage Callback Fires
 * - 10.3: Overage Reduces Remaining Capacity
 *
 * Config: slotCalc-tpm-single
 * - model-alpha: TPM=100K, RPM=1000
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=1, ratio=1.0
 * - 1 instance: floor(100K/10K/1) = 10 slots
 */
import {
  CONFIG_PRESET,
  FULL_TPM,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE,
  MODEL_ID,
  ONE_COUNT,
  OVERAGE_INPUT_TOKENS,
  OVERAGE_OUTPUT_TOKENS,
  OVERAGE_TOTAL_TOKENS,
  SHORT_JOB_DURATION_MS,
  TOKEN_OVERAGE_AMOUNT,
  fetchOverages,
  fetchStats,
  getTokensPerMinute,
  killAllInstances,
  setupSingleInstance,
  submitJob,
  waitForJobComplete,
} from './actualUsageOveragesHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/** Submit a job that triggers a token overage */
const submitOverageJob = async (jobId: string): Promise<number> =>
  await submitJob({
    baseUrl: INSTANCE_URL,
    jobId,
    jobType: JOB_TYPE,
    durationMs: SHORT_JOB_DURATION_MS,
    extraPayload: {
      actualInputTokens: OVERAGE_INPUT_TOKENS,
      actualOutputTokens: OVERAGE_OUTPUT_TOKENS,
    },
  });

/**
 * Test 10.1: Overage Added to Counter
 *
 * Send a job with actualInputTokens=10000, actualOutputTokens=5000
 * (total=15000 vs estimated 10000). The TPM counter should show 15000.
 */
describe('10.1 Overage Added to Counter', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the job', async () => {
    const jobId = `overage-basic-${Date.now()}`;
    const status = await submitOverageJob(jobId);
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should show actual token usage including overage', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(OVERAGE_TOTAL_TOKENS);
  });
});

/**
 * Test 10.2: onOverage Callback Fires
 *
 * Verify the /api/debug/overages endpoint records the overage event
 * with correct details after a job exceeds its estimated usage.
 */
describe('10.2 onOverage Callback Fires', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the job triggering an overage', async () => {
    const jobId = `overage-callback-${Date.now()}`;
    const status = await submitOverageJob(jobId);
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should record overage event in the overages endpoint', async () => {
    const overages = await fetchOverages(INSTANCE_URL);
    expect(overages.count).toBeGreaterThanOrEqual(ONE_COUNT);
  });

  it('should have correct overage amount in the event', async () => {
    const overages = await fetchOverages(INSTANCE_URL);
    const tokenOverage = overages.overages.find((e) => e.resourceType === 'tokens');
    expect(tokenOverage).toBeDefined();
    expect(tokenOverage?.overage).toBe(TOKEN_OVERAGE_AMOUNT);
  });
});

/**
 * Test 10.3: Overage Reduces Remaining Capacity
 *
 * After a job completes with overage usage, verify that
 * remaining TPM capacity is reduced by the overage amount.
 */
describe('10.3 Overage Reduces Remaining Capacity', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the job with overage usage', async () => {
    const jobId = `overage-capacity-${Date.now()}`;
    const status = await submitOverageJob(jobId);
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should reduce remaining capacity by overage amount', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    const expectedRemaining = FULL_TPM - OVERAGE_TOTAL_TOKENS;
    expect(tpm?.remaining).toBe(expectedRemaining);
  });
});
