/**
 * Test suite: Actual Usage Refunds - Additional Tests (Test 9 continued)
 *
 * Tests 9.5-9.6:
 * - 9.5: Multiple refunds accumulate correctly
 * - 9.6: Refund enables blocked job by freeing capacity
 *
 * Config: slotCalc-tpm-single
 * - model-alpha: TPM=100K, RPM=1000
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=1, ratio=1.0
 * - 1 instance: floor(100K/10K/1) = 10 slots
 */
import { sleep } from '../testUtils.js';
import {
  ACCUMULATED_TOTAL,
  CONFIG_PRESET,
  FULL_TPM,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_A_INPUT,
  JOB_A_OUTPUT,
  JOB_B_INPUT,
  JOB_B_OUTPUT,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_C_INPUT,
  JOB_C_OUTPUT,
  JOB_SETTLE_MS,
  JOB_TYPE,
  MODEL_ID,
  SHORT_JOB_DURATION_MS,
  fetchStats,
  getTokensPerMinute,
  killAllInstances,
  setupSingleInstance,
  submitJob,
  waitForJobComplete,
} from './actualUsageRefundsHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

// Refund-enables-blocked-job constants
const FILL_JOB_COUNT = 10;
const REFUND_INPUT_TOKENS = 1000;
const REFUND_OUTPUT_TOKENS = 500;
const BLOCKING_JOB_DURATION_MS = 3000;
const BLOCKED_JOB_TIMEOUT_MS = 20_000;
const MIN_TOKEN_USAGE = 1;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/** Submit a job with specific actual token overrides */
const submitJobWithTokens = async (
  jobId: string,
  inputTokens: number,
  outputTokens: number
): Promise<number> =>
  await submitJob({
    baseUrl: INSTANCE_URL,
    jobId,
    jobType: JOB_TYPE,
    durationMs: SHORT_JOB_DURATION_MS,
    extraPayload: {
      actualInputTokens: inputTokens,
      actualOutputTokens: outputTokens,
    },
  });

/**
 * Test 9.5: Multiple Refunds Accumulate
 *
 * Send 3 jobs with different actual usage values:
 * - Job A: 3000+1000 = 4000 tokens
 * - Job B: 2000+500 = 2500 tokens
 * - Job C: 1000+500 = 1500 tokens
 * Total counter should show 4000+2500+1500 = 8000
 */
describe('9.5 Multiple Refunds Accumulate', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept all three jobs', async () => {
    const timestamp = Date.now();

    const statusA = await submitJobWithTokens(`accum-a-${timestamp}`, JOB_A_INPUT, JOB_A_OUTPUT);
    expect(statusA).toBe(HTTP_ACCEPTED);

    const statusB = await submitJobWithTokens(`accum-b-${timestamp}`, JOB_B_INPUT, JOB_B_OUTPUT);
    expect(statusB).toBe(HTTP_ACCEPTED);

    const statusC = await submitJobWithTokens(`accum-c-${timestamp}`, JOB_C_INPUT, JOB_C_OUTPUT);
    expect(statusC).toBe(HTTP_ACCEPTED);

    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should show accumulated actual token total', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(ACCUMULATED_TOTAL);
  });

  it('should have more remaining capacity than if no refunds', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    const expectedRemaining = FULL_TPM - ACCUMULATED_TOTAL;
    expect(tpm?.remaining).toBe(expectedRemaining);
  });
});

/** Submit a single filling job */
const submitSingleFillingJob = async (jobId: string, durationMs: number): Promise<void> => {
  const status = await submitJob({
    baseUrl: INSTANCE_URL,
    jobId,
    jobType: JOB_TYPE,
    durationMs,
    extraPayload: {
      actualInputTokens: REFUND_INPUT_TOKENS,
      actualOutputTokens: REFUND_OUTPUT_TOKENS,
    },
  });
  expect(status).toBe(HTTP_ACCEPTED);
};

/** Submit multiple blocking jobs that fill all slots */
const submitFillingJobs = async (count: number, durationMs: number): Promise<void> => {
  const timestamp = Date.now();
  const promises = Array.from({ length: count }, async (_, i) => {
    await submitSingleFillingJob(`fill-${timestamp}-${i}`, durationMs);
  });
  await Promise.all(promises);
};

/**
 * Test 9.6: Refund Enables Blocked Job
 *
 * Fill all 10 TPM-based capacity slots, then submit an extra job
 * that must wait. As filling jobs complete with low actual usage
 * (refunding capacity), the blocked job should eventually run.
 */
describe('9.6 Refund Enables Blocked Job', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should fill all slots and queue an extra job', async () => {
    await submitFillingJobs(FILL_JOB_COUNT, BLOCKING_JOB_DURATION_MS);

    await sleep(JOB_SETTLE_MS);

    const extraJobId = `blocked-${Date.now()}`;
    await submitSingleFillingJob(extraJobId, SHORT_JOB_DURATION_MS);
  });

  it('should eventually process the blocked job after refunds', async () => {
    await waitForJobComplete(INSTANCE_URL, BLOCKED_JOB_TIMEOUT_MS);

    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBeGreaterThanOrEqual(MIN_TOKEN_USAGE);
  });
});
