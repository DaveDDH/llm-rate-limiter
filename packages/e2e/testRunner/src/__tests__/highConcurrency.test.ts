/**
 * Test suite: High Concurrency (Test 46)
 *
 * Verifies global limits are respected under high concurrency.
 *
 * Tests 46.1-46.2:
 * - 46.1: Global limit respected under high concurrency
 * - 46.2: High-volume escalation
 *
 * Config: highest-highConcurrency
 * - model-alpha: TPM=100K, tokens=1K per job → 100 jobs/min
 * - model-beta: TPM=1M
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  ALPHA_CAPACITY,
  BEFORE_ALL_TIMEOUT_MS,
  CONFIG_PRESET_ESCALATION,
  FIFTY_JOBS,
  HTTP_ACCEPTED,
  JOB_COMPLETE_TIMEOUT_MS,
  MAX_JOBS_FIRST_MINUTE,
  MODEL_ALPHA,
  MODEL_BETA,
  PORT_A,
  PORT_B,
  PORT_C,
  TEST_TIMEOUT_MS,
  ZERO_COUNT,
  countJobsByModel,
  fetchJobResults,
  killAllInstances,
  setupThreeInstanceTest,
  setupTwoInstanceTest,
  submitMultipleJobs,
  waitForAllJobsComplete,
} from './highConcurrencyHelpers.js';

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 46.1: Global Limit Respected Under High Concurrency
 *
 * Submit 50 jobs to each of 3 instances (150 total).
 * Verify that only 100 complete in the first minute (TPM limit).
 */
describe('46.1 Global Limit Respected Under High Concurrency', () => {
  beforeAll(async () => {
    await setupThreeInstanceTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  it(
    'should accept all jobs from 3 instances',
    async () => {
      const statusesA = await submitMultipleJobs(PORT_A, FIFTY_JOBS, 'concurrency-a');
      const statusesB = await submitMultipleJobs(PORT_B, FIFTY_JOBS, 'concurrency-b');
      const statusesC = await submitMultipleJobs(PORT_C, FIFTY_JOBS, 'concurrency-c');
      const allAccepted = [...statusesA, ...statusesB, ...statusesC].every(
        (status) => status === HTTP_ACCEPTED
      );
      expect(allAccepted).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'should complete at most 100 jobs in the first minute',
    async () => {
      await waitForAllJobsComplete([PORT_A, PORT_B, PORT_C], JOB_COMPLETE_TIMEOUT_MS);

      const resultsA = await fetchJobResults(PORT_A);
      const resultsB = await fetchJobResults(PORT_B);
      const resultsC = await fetchJobResults(PORT_C);
      const allResults = [...resultsA, ...resultsB, ...resultsC];

      const alphaCount = countJobsByModel(allResults, MODEL_ALPHA);
      expect(alphaCount).toBeLessThanOrEqual(MAX_JOBS_FIRST_MINUTE);
    },
    TEST_TIMEOUT_MS
  );
});

/**
 * Test 46.2: High-Volume Escalation
 *
 * alpha capacity=10, beta capacity=100.
 * Submit 50 jobs → 10 on alpha, 40 on beta.
 */
describe('46.2 High-Volume Escalation', () => {
  beforeAll(async () => {
    await setupTwoInstanceTest(CONFIG_PRESET_ESCALATION);
  }, BEFORE_ALL_TIMEOUT_MS);

  it(
    'should accept all 50 jobs across both instances',
    async () => {
      const statusesA = await submitMultipleJobs(PORT_A, FIFTY_JOBS, 'escalation-a');
      const statusesB = await submitMultipleJobs(PORT_B, FIFTY_JOBS, 'escalation-b');
      const allAccepted = [...statusesA, ...statusesB].every((status) => status === HTTP_ACCEPTED);
      expect(allAccepted).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'should distribute jobs across models',
    async () => {
      await waitForAllJobsComplete([PORT_A, PORT_B], JOB_COMPLETE_TIMEOUT_MS);

      const resultsA = await fetchJobResults(PORT_A);
      const resultsB = await fetchJobResults(PORT_B);
      const allResults = [...resultsA, ...resultsB];

      const alphaCount = countJobsByModel(allResults, MODEL_ALPHA);
      const betaCount = countJobsByModel(allResults, MODEL_BETA);

      expect(alphaCount).toBeLessThanOrEqual(ALPHA_CAPACITY);
      expect(betaCount).toBeGreaterThan(ZERO_COUNT);
      expect(alphaCount + betaCount).toBe(allResults.length);
    },
    TEST_TIMEOUT_MS
  );
});
