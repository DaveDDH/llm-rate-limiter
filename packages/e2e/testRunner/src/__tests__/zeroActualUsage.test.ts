/**
 * Test suite: Zero Actual Usage (Test 44)
 *
 * Verifies that when jobs complete with zero actual usage,
 * all capacity is refunded and immediately available.
 *
 * Tests 44.1:
 * - 44.1: Zero actual usage handled correctly
 *
 * Config: high-distributedBasic
 * - model-alpha: TPM=100K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 2 instances: floor(100K/10K/2) = 5 slots per instance
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  FIVE_JOBS,
  HTTP_ACCEPTED,
  JOB_COMPLETE_TIMEOUT_MS,
  MODEL_ID,
  PORT_A,
  PORT_B,
  ZERO_COUNT,
  fetchStats,
  getTokensPerMinute,
  killAllInstances,
  setupTwoInstanceTest,
  submitMultipleJobs,
  waitForJobComplete,
} from './zeroActualUsageHelpers.js';

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 44.1: Zero Actual Usage Handled Correctly
 *
 * Submit 5 jobs that return zero tokens, then immediately submit 10 more.
 * All should complete successfully as capacity is fully refunded.
 */
describe('44.1 Zero Actual Usage Handled Correctly', () => {
  beforeAll(async () => {
    await setupTwoInstanceTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept 5 jobs with zero actual usage on instance A', async () => {
    const statuses = await submitMultipleJobs(PORT_A, FIVE_JOBS, 'zero-usage-a');
    const allAccepted = statuses.every((status) => status === HTTP_ACCEPTED);
    expect(allAccepted).toBe(true);
  });

  it('should complete all jobs with zero tokens tracked', async () => {
    await waitForJobComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);
    const stats = await fetchStats(PORT_A);
    const tpm = getTokensPerMinute(stats, MODEL_ID);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(ZERO_COUNT);
  });

  it('should accept 10 additional jobs immediately after refund', async () => {
    const statusesA = await submitMultipleJobs(PORT_A, FIVE_JOBS, 'zero-usage-additional-a');
    const statusesB = await submitMultipleJobs(PORT_B, FIVE_JOBS, 'zero-usage-additional-b');
    const allAccepted = [...statusesA, ...statusesB].every((status) => status === HTTP_ACCEPTED);
    expect(allAccepted).toBe(true);
  });

  it('should complete all additional jobs successfully', async () => {
    await waitForJobComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);
    await waitForJobComplete(PORT_B, JOB_COMPLETE_TIMEOUT_MS);
    const statsA = await fetchStats(PORT_A);
    const statsB = await fetchStats(PORT_B);
    const tpmA = getTokensPerMinute(statsA, MODEL_ID);
    const tpmB = getTokensPerMinute(statsB, MODEL_ID);
    expect(tpmA?.current).toBe(ZERO_COUNT);
    expect(tpmB?.current).toBe(ZERO_COUNT);
  });
});
