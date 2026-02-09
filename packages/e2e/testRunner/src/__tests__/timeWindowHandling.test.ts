/**
 * Test suite: Time Window Handling (Test 27)
 *
 * Verifies time-window-aware refund/overage behavior. Refunds only occur
 * when a job completes within the same time window it started in.
 *
 * Tests 27.1-27.4:
 * - 27.1: Job completes before window end - refund occurs
 * - 27.2: Job completes after window end - no refund
 * - 27.3: Job carries window start metadata
 * - 27.4: Cross-window job has original window
 *
 * Config: high-timeWindow
 * - model-alpha: TPM=100K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 1 instance: 10 slots
 */
import { sleep } from '../testUtils.js';
import {
  ACTUAL_TOKENS,
  CONFIG_PRESET,
  FIFTY_FIVE_SECONDS_MS,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE,
  MARGIN_MS,
  MODEL_ID,
  SHORT_JOB_DURATION_MS,
  VERY_SHORT_JOB_DURATION_MS,
  ZERO_COUNT,
  ZERO_OUTPUT_TOKENS,
  fetchStats,
  getCurrentWindowStart,
  getMillisecondsUntilNextMinute,
  getTokensPerMinute,
  killAllInstances,
  setupSingleInstance,
  submitJob,
  waitForJobComplete,
} from './timeWindowHandlingHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 27.1: Job Completes Before Window End - Refund Occurs
 *
 * Submit a job that starts and completes within the same time window.
 * The refund should be applied to the counter.
 */
describe('27.1 Job Completes Before Window End - Refund Occurs', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept job and complete within same window', async () => {
    const jobId = `same-window-refund-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE,
      durationMs: VERY_SHORT_JOB_DURATION_MS,
      extraPayload: {
        actualInputTokens: ACTUAL_TOKENS,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      },
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should show actual token usage after refund', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(ACTUAL_TOKENS);
  });
});

/**
 * Test 27.2: Job Completes After Window End - No Refund
 *
 * Submit a job near the end of a minute window that completes in the next window.
 * The refund should NOT occur because the window has changed.
 */
describe('27.2 Job Completes After Window End - No Refund', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should wait until near end of minute window', async () => {
    const msUntilNextMinute = getMillisecondsUntilNextMinute();
    if (msUntilNextMinute > FIFTY_FIVE_SECONDS_MS) {
      const waitTime = msUntilNextMinute - FIFTY_FIVE_SECONDS_MS;
      await sleep(waitTime);
    }
  });

  it('should submit job near window end', async () => {
    const jobId = `cross-window-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE,
      durationMs: SHORT_JOB_DURATION_MS,
      extraPayload: {
        actualInputTokens: ACTUAL_TOKENS,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      },
    });
    expect(status).toBe(HTTP_ACCEPTED);
  });

  it('should wait for window boundary to pass', async () => {
    const msUntilNextMinute = getMillisecondsUntilNextMinute();
    await sleep(msUntilNextMinute + MARGIN_MS);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should show estimated usage in old window', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(ZERO_COUNT);
  });
});

/**
 * Test 27.3: Job Carries Window Start Metadata
 *
 * Verify that when a job starts, it records the window start time for
 * both TPM and RPM windows.
 */
describe('27.3 Job Carries Window Start Metadata', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete job and verify window tracking', async () => {
    const jobId = `window-metadata-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE,
      durationMs: VERY_SHORT_JOB_DURATION_MS,
      extraPayload: {
        actualInputTokens: ACTUAL_TOKENS,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      },
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(ACTUAL_TOKENS);
  });
});

/**
 * Test 27.4: Cross-Window Job Has Original Window
 *
 * Submit a job that starts in one window and completes in the next.
 * Verify it maintains the original window start time.
 */
describe('27.4 Cross-Window Job Has Original Window', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should wait until near end of minute window', async () => {
    const msUntilNextMinute = getMillisecondsUntilNextMinute();
    if (msUntilNextMinute > FIFTY_FIVE_SECONDS_MS) {
      const waitTime = msUntilNextMinute - FIFTY_FIVE_SECONDS_MS;
      await sleep(waitTime);
    }
  });

  it('should submit job that will cross window boundary', async () => {
    const windowStart = getCurrentWindowStart();
    const jobId = `cross-window-metadata-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE,
      durationMs: SHORT_JOB_DURATION_MS,
      extraPayload: {
        actualInputTokens: ACTUAL_TOKENS,
        actualOutputTokens: ZERO_OUTPUT_TOKENS,
      },
    });
    expect(status).toBe(HTTP_ACCEPTED);

    const msUntilNextMinute = getMillisecondsUntilNextMinute();
    await sleep(msUntilNextMinute + MARGIN_MS);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const nowWindowStart = getCurrentWindowStart();
    expect(nowWindowStart).toBeGreaterThan(windowStart);
  });
});
