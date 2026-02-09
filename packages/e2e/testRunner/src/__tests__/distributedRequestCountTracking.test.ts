/**
 * Test suite: Distributed Request Count Tracking (Test 34)
 *
 * Verifies RPM/RPD tracked separately from TPM/TPD in distributed mode.
 *
 * Config presets:
 * - high-rpmTracking (34.1): TPM=100K, RPM=50
 * - high-tpmRpmTracking (34.2): TPM=1M, RPM=100, TPD=10M, RPD=1K
 *
 * Key behaviors:
 * 1. RPM tracking separate from TPM
 * 2. Request count tracked separately
 * 3. RPM counter increments by request count
 * 4. Multi-request job affects both TPM and RPM
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  EIGHTY_JOBS,
  EXPECTED_RPM_THREE,
  EXPECTED_TPM_EIGHT_K,
  HTTP_ACCEPTED,
  JOB_COMPLETE_TIMEOUT_MS,
  PORT_A,
  PORT_B,
  REQUEST_COUNT_THREE,
  RPM_TRACKING_ESTIMATED_TOKENS,
  SHORT_JOB_DURATION_MS,
  TEN_JOBS,
  TEST_TIMEOUT_MS,
  TPM_RPM_TRACKING_ESTIMATED_TOKENS,
  fetchStats,
  getRequestsPerDay,
  getRequestsPerMinute,
  getTokensPerDay,
  getTokensPerMinute,
  killAllInstances,
  setupTwoInstances,
  submitEightyJobs,
  submitJob,
  submitTenJobsAcrossInstances,
  waitForJobsComplete,
} from './distributedRequestCountTrackingHelpers.js';

// Constants for token calculations
const TOKEN_MULTIPLIER = 0.4;

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Request Count Tracking - RPM Separate from TPM', () => {
  beforeAll(async () => {
    await setupTwoInstances('high-rpmTracking');
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should track RPM separately from TPM',
    async () => {
      // Send 10 jobs with actualRequestCount=3 and 8000 tokens each
      await submitTenJobsAcrossInstances(TOKEN_MULTIPLIER, REQUEST_COUNT_THREE);

      // Wait for all jobs to complete
      await waitForJobsComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);
      await waitForJobsComplete(PORT_B, JOB_COMPLETE_TIMEOUT_MS);

      // Verify TPM and RPM counters
      const statsA = await fetchStats(PORT_A);
      const tpmA = getTokensPerMinute(statsA);
      const rpmA = getRequestsPerMinute(statsA);

      // 10 jobs * 8000 tokens = 80,000 tokens
      expect(tpmA?.current).toBe(TEN_JOBS * EXPECTED_TPM_EIGHT_K);

      // 10 jobs * 3 requests = 30 requests
      expect(rpmA?.current).toBe(TEN_JOBS * EXPECTED_RPM_THREE);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Request Count Tracking - All Counters', () => {
  beforeAll(async () => {
    await setupTwoInstances('high-tpmRpmTracking');
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should track TPM, RPM, TPD, RPD separately',
    async () => {
      // Send 80 jobs from instance A
      await submitEightyJobs(PORT_A, TPM_RPM_TRACKING_ESTIMATED_TOKENS);

      // Wait for all jobs to complete
      await waitForJobsComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);

      // Verify all four counters
      const stats = await fetchStats(PORT_A);
      const tpm = getTokensPerMinute(stats);
      const rpm = getRequestsPerMinute(stats);
      const tpd = getTokensPerDay(stats);
      const rpd = getRequestsPerDay(stats);

      // 80 jobs * 1000 tokens = 80,000 tokens
      expect(tpm?.current).toBe(EIGHTY_JOBS * TPM_RPM_TRACKING_ESTIMATED_TOKENS);
      expect(tpd?.current).toBe(EIGHTY_JOBS * TPM_RPM_TRACKING_ESTIMATED_TOKENS);

      // 80 jobs * 1 request = 80 requests
      expect(rpm?.current).toBe(EIGHTY_JOBS);
      expect(rpd?.current).toBe(EIGHTY_JOBS);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Request Count Tracking - Multi-Request Job', () => {
  beforeAll(async () => {
    await setupTwoInstances('high-rpmTracking');
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should increment RPM by request count for multi-request job',
    async () => {
      // Send a single job with requestCount=3
      const status = await submitJob({
        port: PORT_A,
        jobId: 'multi-request-job',
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens: RPM_TRACKING_ESTIMATED_TOKENS * TOKEN_MULTIPLIER,
        actualOutputTokens: RPM_TRACKING_ESTIMATED_TOKENS * TOKEN_MULTIPLIER,
        actualRequestCount: REQUEST_COUNT_THREE,
      });
      expect(status).toBe(HTTP_ACCEPTED);

      await waitForJobsComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);

      // Verify both counters incremented
      const stats = await fetchStats(PORT_A);
      const tpm = getTokensPerMinute(stats);
      const rpm = getRequestsPerMinute(stats);

      expect(tpm?.current).toBe(EXPECTED_TPM_EIGHT_K);
      expect(rpm?.current).toBe(EXPECTED_RPM_THREE);
    },
    TEST_TIMEOUT_MS
  );
});
