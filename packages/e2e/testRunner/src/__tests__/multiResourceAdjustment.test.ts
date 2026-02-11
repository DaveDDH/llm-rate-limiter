/**
 * Test suite: Multi-Resource Adjustment (Test 26)
 *
 * Verifies that all resource types (TPM, RPM, TPD, RPD) are adjusted together
 * when a job completes with actual usage different from estimated.
 *
 * Tests 26.1-26.2:
 * - 26.1: All resource types adjusted together (refunds)
 * - 26.2: Mixed refund and overage (tokens refunded, requests have overage)
 *
 * Config: high-multiResource (26.1)
 * - model-alpha: TPM=100K, RPM=500, TPD=1M, RPD=10K
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=5, ratio=1.0
 * - 1 instance
 *
 * Config: high-multiResource-mixedOverage (26.2)
 * - Same model limits, but estimatedRequests=1
 * - Allows testing request overage (actual=3 > estimated=1)
 */
import {
  ACTUAL_REQUESTS_OVERAGE,
  ACTUAL_REQUESTS_PARTIAL,
  ACTUAL_TOKENS_PARTIAL,
  ACTUAL_TOKENS_REFUND,
  CONFIG_PRESET,
  INSTANCE_URL,
  MODEL_ID,
  fetchStats,
  getRequestsPerDay,
  getRequestsPerMinute,
  getTokensPerDay,
  getTokensPerMinute,
  killAllInstances,
  setupMixedOverageInstance,
  setupSingleInstance,
  submitMixedUsageJob,
  submitPartialUsageJob,
} from './multiResourceAdjustmentHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 26.1: All Resource Types Adjusted Together
 *
 * Submit a job with estimated 10K tokens and 5 requests.
 * Actual usage: 6K tokens and 3 requests.
 * All four counters (TPM, RPM, TPD, RPD) should be refunded.
 */
describe('26.1 All Resource Types Adjusted Together', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept job with partial actual usage', async () => {
    await submitPartialUsageJob();
  });

  it('should show actual token usage in TPM counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(ACTUAL_TOKENS_PARTIAL);
  });

  it('should show actual request count in RPM counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const rpm = getRequestsPerMinute(stats, MODEL_ID);
    expect(rpm).toBeDefined();
    expect(rpm?.current).toBe(ACTUAL_REQUESTS_PARTIAL);
  });

  it('should show actual token usage in TPD counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpd = getTokensPerDay(stats, MODEL_ID);
    expect(tpd).toBeDefined();
    expect(tpd?.current).toBe(ACTUAL_TOKENS_PARTIAL);
  });

  it('should show actual request count in RPD counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const rpd = getRequestsPerDay(stats, MODEL_ID);
    expect(rpd).toBeDefined();
    expect(rpd?.current).toBe(ACTUAL_REQUESTS_PARTIAL);
  });
});

/**
 * Test 26.2: Mixed Refund and Overage
 *
 * Config: high-multiResource-mixedOverage (estimatedRequests=1).
 * Submit a job with estimated 10K tokens and 1 request.
 * Actual usage: 6K tokens (refund from 10K) and 3 requests (overage from 1).
 * Tokens should be refunded, requests should show overage.
 */
describe('26.2 Mixed Refund and Overage', () => {
  beforeAll(async () => {
    await setupMixedOverageInstance();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept job with mixed actual usage', async () => {
    await submitMixedUsageJob();
  });

  it('should show refunded token usage in TPM counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(ACTUAL_TOKENS_REFUND);
  });

  it('should show overage in RPM counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const rpm = getRequestsPerMinute(stats, MODEL_ID);
    expect(rpm).toBeDefined();
    expect(rpm?.current).toBe(ACTUAL_REQUESTS_OVERAGE);
  });

  it('should show refunded token usage in TPD counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpd = getTokensPerDay(stats, MODEL_ID);
    expect(tpd).toBeDefined();
    expect(tpd?.current).toBe(ACTUAL_TOKENS_REFUND);
  });

  it('should show overage in RPD counter', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const rpd = getRequestsPerDay(stats, MODEL_ID);
    expect(rpd).toBeDefined();
    expect(rpd?.current).toBe(ACTUAL_REQUESTS_OVERAGE);
  });
});
