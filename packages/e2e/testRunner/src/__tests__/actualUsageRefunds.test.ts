/**
 * Test suite: Actual Usage Refunds (Test 9)
 *
 * Verifies that when a job completes with less actual usage than estimated,
 * the difference is refunded to the capacity counters.
 *
 * Tests 9.1-9.3:
 * - 9.1: Same-Window Refund (partial token usage)
 * - 9.2: Full Refund (zero actual tokens)
 * - 9.3: Request Count Refund
 *
 * Config: slotCalc-tpm-single (9.1, 9.2)
 * - model-alpha: TPM=100K, RPM=1000
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=1, ratio=1.0
 * - 1 instance: floor(100K/10K/1) = 10 slots
 *
 * Config: medium-refund-partialRequest (9.3)
 * - model-alpha: TPM=100K, RPM=1000
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=5, ratio=1.0
 */
import {
  ACTUAL_INPUT_TOKENS_PARTIAL,
  ACTUAL_OUTPUT_TOKENS_PARTIAL,
  ACTUAL_TOTAL_TOKENS_PARTIAL,
  CONFIG_PRESET,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE,
  MODEL_ID,
  PARTIAL_REQUEST_ACTUAL,
  SHORT_JOB_DURATION_MS,
  ZERO_COUNT,
  ZERO_TOKENS,
  fetchStats,
  getRequestsPerMinute,
  getTokensPerMinute,
  killAllInstances,
  setupPartialRequestInstance,
  setupSingleInstance,
  submitJob,
  waitForJobComplete,
} from './actualUsageRefundsHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 9.1: Same-Window Refund - Partial Token Usage
 *
 * Send a job with actualInputTokens=4000, actualOutputTokens=2000 (total=6000).
 * Estimated was 10000 tokens, so 4000 tokens should be refunded.
 * TPM counter should show 6000 after completion.
 */
describe('9.1 Same-Window Refund - Partial Token Usage', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the job', async () => {
    const jobId = `refund-partial-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE,
      durationMs: SHORT_JOB_DURATION_MS,
      extraPayload: {
        actualInputTokens: ACTUAL_INPUT_TOKENS_PARTIAL,
        actualOutputTokens: ACTUAL_OUTPUT_TOKENS_PARTIAL,
      },
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should show actual token usage in TPM counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(ACTUAL_TOTAL_TOKENS_PARTIAL);
  });
});

/**
 * Test 9.2: Full Refund - Zero Actual Tokens
 *
 * Send a job with all actual tokens = 0.
 * Entire estimated amount should be refunded.
 * TPM counter should show 0 after completion.
 */
describe('9.2 Full Refund - Zero Actual Tokens', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the job with zero actual tokens', async () => {
    const jobId = `refund-full-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE,
      durationMs: SHORT_JOB_DURATION_MS,
      extraPayload: {
        actualInputTokens: ZERO_TOKENS,
        actualOutputTokens: ZERO_TOKENS,
        actualCachedTokens: ZERO_TOKENS,
      },
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should show zero token usage in TPM counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(ZERO_COUNT);
  });
});

/**
 * Test 9.3: Request Count Refund
 *
 * Config: medium-refund-partialRequest (estimatedRequests=5).
 * Send a job with actualRequestCount=2 (partial refund from estimated 5).
 * RPM counter should show 2 after completion.
 */
describe('9.3 Request Count Refund', () => {
  beforeAll(async () => {
    await setupPartialRequestInstance();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the job with partial actual requests', async () => {
    const jobId = `refund-requests-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE,
      durationMs: SHORT_JOB_DURATION_MS,
      extraPayload: { actualRequestCount: PARTIAL_REQUEST_ACTUAL },
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should show actual request count in RPM counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const rpm = getRequestsPerMinute(stats, MODEL_ID);
    expect(rpm).toBeDefined();
    expect(rpm?.current).toBe(PARTIAL_REQUEST_ACTUAL);
  });
});
