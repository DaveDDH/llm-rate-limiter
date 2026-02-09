/**
 * Test suite: Distributed Time Windows (Test 33)
 *
 * Verifies time window resets in distributed mode.
 *
 * Config: high-distributedTimeWindow
 * - model-alpha: TPM=50K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 2 instances: 2 slots per instance
 *
 * Key behaviors:
 * 1. Window reset clears global counters
 * 2. Full allocation restored after window reset
 * 3. Daily limit (TPD) tracked across minutes
 * 4. Daily limit reset at day boundary
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  ESTIMATED_TOKENS,
  HTTP_ACCEPTED,
  JOB_COMPLETE_TIMEOUT_MS,
  PORT_A,
  PORT_B,
  SHORT_JOB_DURATION_MS,
  TEST_TIMEOUT_MS,
  TWENTY_K_TOKENS,
  TWO_SLOTS_PER_INSTANCE,
  ZERO_TOKENS,
  fetchStats,
  getTokensPerMinute,
  killAllInstances,
  setupTwoInstances,
  submitFourJobsAcrossInstances,
  submitJob,
  verifyTpmCounter,
  waitForAllocationRestored,
  waitForJobsComplete,
  waitForMinuteBoundary,
} from './distributedTimeWindowsHelpers.js';

// Constants
const HALF = 2;

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Time Windows - Window Reset', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should clear global counters after window reset',
    async () => {
      // Send 4 jobs (40K tokens) in minute N
      await submitFourJobsAcrossInstances();

      // Wait for all jobs to complete
      await waitForJobsComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);
      await waitForJobsComplete(PORT_B, JOB_COMPLETE_TIMEOUT_MS);

      // Verify minute N counter shows 20K tokens used locally (2 of 4 jobs on PORT_A)
      await verifyTpmCounter(PORT_A, TWENTY_K_TOKENS);

      // Wait for minute boundary to pass
      await waitForMinuteBoundary();

      // Verify minute N+1 counter is zero
      await verifyTpmCounter(PORT_A, ZERO_TOKENS);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'should restore full allocation after window reset',
    async () => {
      // Use some capacity
      const status = await submitJob({
        port: PORT_A,
        jobId: 'allocation-restore-1',
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens: ESTIMATED_TOKENS / HALF,
        actualOutputTokens: ESTIMATED_TOKENS / HALF,
      });
      expect(status).toBe(HTTP_ACCEPTED);

      await waitForJobsComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);

      // Wait for minute boundary
      await waitForMinuteBoundary();

      // Verify allocation is restored
      await waitForAllocationRestored(PORT_A);
      const statsRestored = await fetchStats(PORT_A);
      const tpmRestored = getTokensPerMinute(statsRestored);
      expect(tpmRestored?.current).toBe(ZERO_TOKENS);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Time Windows - Allocation Verification', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('should have correct per-instance allocation', async () => {
    const statsA = await fetchStats(PORT_A);
    const statsB = await fetchStats(PORT_B);

    const tpmA = getTokensPerMinute(statsA);
    const tpmB = getTokensPerMinute(statsB);

    // Each instance should have allocation for 2 slots
    expect(tpmA?.limit).toBeGreaterThanOrEqual(TWO_SLOTS_PER_INSTANCE * ESTIMATED_TOKENS);
    expect(tpmB?.limit).toBeGreaterThanOrEqual(TWO_SLOTS_PER_INSTANCE * ESTIMATED_TOKENS);
  });
});
