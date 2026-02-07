/**
 * Test suite: Token Type Breakdown (Test 11)
 *
 * Verifies that input, output, and cached tokens are all counted
 * in the TPM counter, and that overages from cached tokens are tracked.
 *
 * Config: slotCalc-tpm-single (model-alpha TPM=100K, jobTypeA 10K tokens)
 * 1 instance -> 10 slots
 *
 * 11.1: Input + Output + Cached Totaled
 * 11.2: Cached Tokens Counted
 * 11.3: Cached in Overage
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  MODEL_ALPHA,
  TEST_11_1_CACHED_TOKENS,
  TEST_11_1_EXPECTED_TPM,
  TEST_11_1_INPUT_TOKENS,
  TEST_11_1_OUTPUT_TOKENS,
  TEST_11_2_CACHED_TOKENS,
  TEST_11_2_EXPECTED_TPM,
  TEST_11_2_INPUT_TOKENS,
  TEST_11_2_OUTPUT_TOKENS,
  TEST_11_3_CACHED_TOKENS,
  TEST_11_3_EXPECTED_OVERAGE,
  TEST_11_3_EXPECTED_TPM,
  TEST_11_3_INPUT_TOKENS,
  TEST_11_3_OUTPUT_TOKENS,
  TPM_SINGLE_CONFIG,
  ZERO_COUNT,
  fetchOverages,
  fetchStats,
  getTokensPerMinute,
  killAllInstances,
  setupSingleInstance,
  submitTokenJob,
  waitForNoActiveJobs,
} from './tokenTypeBreakdownHelpers.js';

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('11.1 Input + Output + Cached Totaled', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_SINGLE_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the job', async () => {
    const jobId = `token-breakdown-11-1-${Date.now()}`;
    const status = await submitTokenJob(INSTANCE_URL, jobId, {
      inputTokens: TEST_11_1_INPUT_TOKENS,
      outputTokens: TEST_11_1_OUTPUT_TOKENS,
      cachedTokens: TEST_11_1_CACHED_TOKENS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should show TPM = 6000 (3000+2000+1000)', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ALPHA);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(TEST_11_1_EXPECTED_TPM);
  });
});

describe('11.2 Cached Tokens Counted', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_SINGLE_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the cached-only job', async () => {
    const jobId = `token-breakdown-11-2-${Date.now()}`;
    const status = await submitTokenJob(INSTANCE_URL, jobId, {
      inputTokens: TEST_11_2_INPUT_TOKENS,
      outputTokens: TEST_11_2_OUTPUT_TOKENS,
      cachedTokens: TEST_11_2_CACHED_TOKENS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should show TPM = 5000 from cached tokens alone', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ALPHA);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(TEST_11_2_EXPECTED_TPM);
  });
});

describe('11.3 Cached in Overage', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_SINGLE_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the overage job', async () => {
    const jobId = `token-breakdown-11-3-${Date.now()}`;
    const status = await submitTokenJob(INSTANCE_URL, jobId, {
      inputTokens: TEST_11_3_INPUT_TOKENS,
      outputTokens: TEST_11_3_OUTPUT_TOKENS,
      cachedTokens: TEST_11_3_CACHED_TOKENS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
  });

  it('should show TPM = 12000 (3000+2000+7000)', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ALPHA);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(TEST_11_3_EXPECTED_TPM);
  });

  it('should record an overage of 2000 tokens', async () => {
    const overages = await fetchOverages(INSTANCE_URL);
    expect(overages.count).toBeGreaterThan(ZERO_COUNT);
    const tokenOverage = overages.overages.find((o) => o.resourceType === 'tokensPerMinute');
    expect(tokenOverage).toBeDefined();
    expect(tokenOverage?.overage).toBe(TEST_11_3_EXPECTED_OVERAGE);
  });
});
