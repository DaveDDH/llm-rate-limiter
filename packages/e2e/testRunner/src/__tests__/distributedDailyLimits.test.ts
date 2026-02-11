/**
 * Test 33.3: Daily Limit (TPD) Tracked Across Minutes
 *
 * Verifies that TPD counter accumulates across minute boundaries
 * without resetting (unlike TPM which resets each minute).
 *
 * Config: high-distributedDailyLimit
 * - model-alpha: TPM=100K, TPD=200K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 2 instances: 5 TPM slots per instance (TPM-limited)
 *
 * Flow:
 * 1. Minute M:   Submit 8 jobs (4 per instance) = 80K tokens
 * 2. Minute M+1: Submit 8 jobs (4 per instance) = 80K tokens
 * 3. Minute M+2: Verify TPD accumulated to 160K, only 40K remains
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CUMULATIVE_TPD_AFTER_TWO_MINUTES,
  DAILY_LIMIT_TEST_TIMEOUT_MS,
  PORT_A,
  PORT_B,
  REMAINING_TPD_AFTER_TWO_MINUTES,
  TPD_CAPACITY,
  ZERO_TOKENS,
  fetchStats,
  getTokensPerDay,
  getTokensPerMinute,
  killAllInstances,
  setupTwoInstances,
  submitJobsForPhase,
  waitForAllJobsComplete,
  waitForMinuteBoundary,
} from './distributedDailyLimitsHelpers.js';

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('33.3 Daily Limit (TPD) Tracked Across Minutes', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should accumulate TPD across minute boundaries',
    async () => {
      // === MINUTE M: Submit 80K tokens (8 jobs total) ===
      await submitJobsForPhase('m0');
      await waitForAllJobsComplete();

      // Verify TPD counter after minute M
      await verifyTpdAfterMinuteM();

      // Wait for minute boundary
      await waitForMinuteBoundary();

      // Verify TPM reset but TPD persists
      await verifyTpmResetAfterBoundary();

      // === MINUTE M+1: Submit another 80K tokens ===
      await submitJobsForPhase('m1');
      await waitForAllJobsComplete();

      // Wait for minute M+2 boundary
      await waitForMinuteBoundary();

      // === MINUTE M+2: Verify TPD accumulated across both minutes ===
      await verifyTpdAccumulatedAcrossMinutes();
    },
    DAILY_LIMIT_TEST_TIMEOUT_MS
  );
});

/** Verify TPD shows usage after minute M */
const verifyTpdAfterMinuteM = async (): Promise<void> => {
  const statsA = await fetchStats(PORT_A);
  const tpdA = getTokensPerDay(statsA);

  // TPD should show accumulated usage (combined local of port A)
  expect(tpdA).toBeDefined();
  expect(tpdA?.current).toBeGreaterThan(ZERO_TOKENS);
};

/** Verify TPM resets at minute boundary but TPD persists */
const verifyTpmResetAfterBoundary = async (): Promise<void> => {
  const statsA = await fetchStats(PORT_A);
  const tpmA = getTokensPerMinute(statsA);
  const tpdA = getTokensPerDay(statsA);

  // TPM should reset to zero in new minute
  expect(tpmA?.current).toBe(ZERO_TOKENS);

  // TPD should still show previous minute's accumulated usage
  expect(tpdA).toBeDefined();
  expect(tpdA?.current).toBeGreaterThan(ZERO_TOKENS);
};

/** Verify TPD accumulated across both minutes */
const verifyTpdAccumulatedAcrossMinutes = async (): Promise<void> => {
  const statsA = await fetchStats(PORT_A);
  const statsB = await fetchStats(PORT_B);
  const tpdA = getTokensPerDay(statsA);
  const tpdB = getTokensPerDay(statsB);

  // Both instances should report TPD usage
  expect(tpdA).toBeDefined();
  expect(tpdB).toBeDefined();

  // Combined local TPD usage across both instances should be close to 160K
  const combinedLocalTpd = (tpdA?.current ?? ZERO_TOKENS) + (tpdB?.current ?? ZERO_TOKENS);
  expect(combinedLocalTpd).toBe(CUMULATIVE_TPD_AFTER_TWO_MINUTES);

  // TPD remaining should be around 40K (200K - 160K)
  const tpdLimit = tpdA?.limit ?? TPD_CAPACITY;
  const remainingCapacity = tpdLimit - combinedLocalTpd;
  expect(remainingCapacity).toBe(REMAINING_TPD_AFTER_TWO_MINUTES);

  // TPM should have reset in minute M+2 (no new jobs submitted)
  const tpmA = getTokensPerMinute(statsA);
  expect(tpmA?.current).toBe(ZERO_TOKENS);
};
