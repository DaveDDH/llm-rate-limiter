/**
 * Test suite: Error Handling - Additional (Tests 12.4-12.6)
 *
 * Verifies error scenarios where jobs call reject() with usage data.
 *
 * 12.4: Reject With Full Usage - Adjusts Like Success
 *   reject(inputTokens=4000, outputTokens=2000) => TPM = 6000 (not 10000)
 *
 * 12.5: Reject With Zero Usage - Full Refund
 *   reject(all zeros) => TPM = 0 (full refund)
 *
 * 12.6: Reject With Overage Usage
 *   reject(inputTokens=10000, outputTokens=8000) => TPM = 18000 (overage)
 */
import { sleep } from '../testUtils.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_SETTLE_MS,
  MODEL_ALPHA,
  REJECT_FULL_INPUT,
  REJECT_FULL_OUTPUT,
  REJECT_FULL_TOTAL,
  REJECT_OVERAGE_INPUT,
  REJECT_OVERAGE_OUTPUT,
  REJECT_OVERAGE_REQUEST_COUNT,
  REJECT_OVERAGE_TOTAL,
  REJECT_ZERO_TOTAL,
  TPM_CONFIG,
  fetchStats,
  getTokensPerMinute,
  killAllInstances,
  setupSingleInstance,
  submitRejectJob,
  waitForNoActiveJobs,
} from './errorHandlingHelpers.js';

// Reject usage: zero for cached tokens in all tests
const ZERO_CACHED = 0;
const ZERO_REQUESTS = 0;
const ONE_REQUEST = 1;

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('12.4 Reject With Full Usage - Adjusts Like Success', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the reject job', async () => {
    const jobId = `reject-full-usage-${Date.now()}`;
    const status = await submitRejectJob(INSTANCE_URL, jobId, {
      inputTokens: REJECT_FULL_INPUT,
      outputTokens: REJECT_FULL_OUTPUT,
      cachedTokens: ZERO_CACHED,
      requestCount: ONE_REQUEST,
    });
    expect(status).toBe(HTTP_ACCEPTED);
  });

  it('should adjust TPM to actual usage (6000)', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
    await sleep(JOB_SETTLE_MS);
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ALPHA);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(REJECT_FULL_TOTAL);
  });
});

describe('12.5 Reject With Zero Usage - Full Refund', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the reject-zero job', async () => {
    const jobId = `reject-zero-usage-${Date.now()}`;
    const status = await submitRejectJob(INSTANCE_URL, jobId, {
      inputTokens: REJECT_ZERO_TOTAL,
      outputTokens: REJECT_ZERO_TOTAL,
      cachedTokens: ZERO_CACHED,
      requestCount: ZERO_REQUESTS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
  });

  it('should refund fully to TPM = 0', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
    await sleep(JOB_SETTLE_MS);
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ALPHA);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(REJECT_ZERO_TOTAL);
  });
});

describe('12.6 Reject With Overage Usage', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the reject-overage job', async () => {
    const jobId = `reject-overage-usage-${Date.now()}`;
    const status = await submitRejectJob(INSTANCE_URL, jobId, {
      inputTokens: REJECT_OVERAGE_INPUT,
      outputTokens: REJECT_OVERAGE_OUTPUT,
      cachedTokens: ZERO_CACHED,
      requestCount: REJECT_OVERAGE_REQUEST_COUNT,
    });
    expect(status).toBe(HTTP_ACCEPTED);
  });

  it('should show TPM = 18000 (overage tracked)', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
    await sleep(JOB_SETTLE_MS);
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ALPHA);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(REJECT_OVERAGE_TOTAL);
  });
});
