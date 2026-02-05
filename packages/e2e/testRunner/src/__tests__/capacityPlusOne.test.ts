/**
 * Test suite: Capacity Plus One
 *
 * Sends exactly capacity + 1 jobs distributed evenly across 2 instances.
 * The 51st job should wait for the rate limit window to reset.
 *
 * Configuration:
 * - 2 instances share jobs evenly (proxy ratio 1:1)
 * - Each instance has 250,000 TPM = 25 jobs of 10,000 tokens
 * - Total capacity = 500,000 TPM = 50 jobs
 * - 51 jobs x 10,000 tokens = 510,000 tokens exceeds total capacity by 1 job
 *
 * Expected behavior:
 * - First 50 jobs complete quickly (within total rate limit)
 * - 51st job waits for capacity (rate limit window reset)
 * - All jobs eventually complete (not rejected)
 */
import type { JobRecord, TestData } from '@llm-rate-limiter/e2e-test-results';

import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  INSTANCE_URLS,
  PROXY_URL,
  bootInfrastructure,
  teardownInfrastructure,
} from './infrastructureHelpers.js';
import { createEmptyTestData } from './testHelpers.js';

// Total capacity: 2 instances x 250,000 TPM = 500,000 TPM = 50 jobs of 10,000 tokens
const TOTAL_CAPACITY = 50;
// Send capacity + 1 to ensure exactly 1 job exceeds the limit
const ONE_EXTRA_JOB = 1;
const CAPACITY_PLUS_ONE = TOTAL_CAPACITY + ONE_EXTRA_JOB;
const JOB_DURATION_MS = 100;

// Distribute jobs evenly across both instances (1:1 ratio)
const PROXY_RATIO = '1:1';

// The 51st job must wait for the next minute window.
// Minimum wait should be significant (at least a few seconds) to prove it waited for rate limit reset.
const MIN_WAIT_FOR_RATE_LIMIT_RESET_MS = 1000;

// Periodic snapshot interval
const SNAPSHOT_INTERVAL_MS = 500;

// Longer timeout since we need to wait for rate limit reset (up to 60s)
const WAIT_TIMEOUT_MS = 90000;
const BEFORE_ALL_TIMEOUT_MS = 150000;

// Index constants
const FIRST_INDEX = 0;
const QUICK_JOB_THRESHOLD_MS = 500;

/**
 * Test setup data structure
 */
interface TestSetupData {
  data: TestData;
  jobsSortedBySentTime: JobRecord[];
}

/**
 * Setup test data by running the suite and sorting jobs
 */
const setupTestData = async (): Promise<TestSetupData> => {
  // Each job takes 100ms to process
  const jobs = generateJobsOfType(CAPACITY_PLUS_ONE, 'summary', {
    prefix: 'capacity-plus-one-test',
    durationMs: JOB_DURATION_MS,
  });

  const data = await runSuite({
    suiteName: 'capacity-plus-one',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: PROXY_RATIO,
    snapshotIntervalMs: SNAPSHOT_INTERVAL_MS,
  });

  // Sort jobs by when they were sent (sentAt)
  const jobsSortedBySentTime = Object.values(data.jobs).sort((a, b) => a.sentAt - b.sentAt);

  return { data, jobsSortedBySentTime };
};

/**
 * Create empty test setup data for initialization
 */
const createEmptyTestSetup = (): TestSetupData => ({
  data: createEmptyTestData(),
  jobsSortedBySentTime: [],
});

describe('Capacity Plus One', () => {
  let testSetup: TestSetupData = createEmptyTestSetup();

  beforeAll(async () => {
    await bootInfrastructure();
    testSetup = await setupTestData();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await teardownInfrastructure();
  }, AFTER_ALL_TIMEOUT_MS);

  it('should send all jobs', () => {
    expect(Object.keys(testSetup.data.jobs).length).toBe(CAPACITY_PLUS_ONE);
  });

  it('should not reject any jobs', () => {
    const failedJobs = Object.values(testSetup.data.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(FIRST_INDEX);
  });

  it('should eventually complete all jobs', () => {
    const completedJobs = Object.values(testSetup.data.jobs).filter((j) => j.status === 'completed');
    expect(completedJobs.length).toBe(CAPACITY_PLUS_ONE);
  });

  it('should have first 50 jobs complete quickly', () => {
    // First 50 jobs should fit within the total rate limit (500,000 TPM across 2 instances)
    const first50Jobs = testSetup.jobsSortedBySentTime.slice(FIRST_INDEX, TOTAL_CAPACITY);
    const quickJobs = first50Jobs.filter((j) => (j.queueDurationMs ?? FIRST_INDEX) < QUICK_JOB_THRESHOLD_MS);

    // All first 50 jobs should complete quickly (no waiting for rate limit)
    expect(quickJobs.length).toBe(TOTAL_CAPACITY);
  });

  it('should have the 51st job wait for rate limit window reset', () => {
    // The 51st job exceeds total capacity and must wait for the next minute window
    const [job51] = testSetup.jobsSortedBySentTime.slice(TOTAL_CAPACITY);
    expect(job51).toBeDefined();

    const job51QueueDuration = job51?.queueDurationMs ?? FIRST_INDEX;

    // The job must have waited for the rate limit window to reset
    // This should be at least MIN_WAIT_FOR_RATE_LIMIT_RESET_MS (not instant like the first 50)
    expect(job51QueueDuration).toBeGreaterThan(MIN_WAIT_FOR_RATE_LIMIT_RESET_MS);
  });

  it('should complete all jobs through the full lifecycle', () => {
    for (const job of Object.values(testSetup.data.jobs)) {
      expect(job.events.some((e) => e.type === 'queued')).toBe(true);
      expect(job.events.some((e) => e.type === 'started')).toBe(true);
      expect(job.events.some((e) => e.type === 'completed')).toBe(true);
    }
  });
});
