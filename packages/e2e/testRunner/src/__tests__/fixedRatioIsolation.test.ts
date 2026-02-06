/**
 * Test suite: Fixed Ratio Isolation
 *
 * Verifies that job types with flexible: false maintain their capacity
 * even when other job types fill up or have high load.
 *
 * Uses the fixedRatio config preset:
 * - test-model: 100K TPM
 * - fixedJobType: 10K tokens, ratio 0.4, flexible: false
 * - flexibleJobTypeA: 10K tokens, ratio 0.3, flexible: true
 * - flexibleJobTypeB: 10K tokens, ratio 0.3, flexible: true
 *
 * Pool (Redis): totalSlots = floor(100K / 10K / 2) = 5 per instance
 * Pool: tokensPerMinute = 100K / 2 = 50,000
 *
 * Per-model-per-jobType (JTM):
 *   fixedJobType: floor(50K × 0.4 / 10K) = 2 per instance = 4 total
 *   flexibleJobTypeA: floor(50K × 0.3 / 10K) = 1 per instance = 2 total
 *   flexibleJobTypeB: floor(50K × 0.3 / 10K) = 1 per instance = 2 total
 *
 * Key behavior to verify:
 * - When flexible types are overloaded, fixedJobType capacity remains unchanged
 * - Fixed ratio job types maintain their allocated slots regardless of load on other types
 * - Flexible types can borrow from each other but not from fixed types
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import type { ConfigPresetName } from '../resetInstance.js';
import { type GeneratedJob, generateJobsOfType, runSuite } from '../suiteRunner.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  INSTANCE_URLS,
  PROXY_URL,
  bootInfrastructure,
  teardownInfrastructure,
} from './infrastructureHelpers.js';
import { ZERO_COUNT, createEmptyTestData } from './testHelpers.js';

// Per-model-per-jobType slots (see header comment for derivation):
// fixedJobType: floor(50K × 0.4 / 10K) = 2 per instance = 4 total
// flexibleJobTypeA: floor(50K × 0.3 / 10K) = 1 per instance = 2 total
// flexibleJobTypeB: floor(50K × 0.3 / 10K) = 1 per instance = 2 total
const FIXED_JOB_TYPE_SLOTS = 4;
const FLEXIBLE_JOB_TYPE_A_SLOTS = 2;
const FLEXIBLE_JOB_TYPE_B_SLOTS = 2;
const OVERLOAD_EXTRA_JOBS = 2;
const HEAVY_LOAD_EXTRA_JOBS = 3;
const SINGLE_JOB = 1;

const JOB_DURATION_MS = 100;
const LONG_JOB_DURATION_MS = 1000;
const WAIT_TIMEOUT_MS = 60000;
const WAIT_TIMEOUT_MULTIPLIER = 2;
const BEFORE_ALL_TIMEOUT_MS = 120000;
const MAX_QUEUE_DURATION_MS = 2000;
const CONFIG_PRESET: ConfigPresetName = 'fixedRatio';

/**
 * Filter jobs by prefix
 */
const filterJobsByPrefix = (data: TestData, prefix: string): Array<TestData['jobs'][string]> =>
  Object.values(data.jobs).filter((j) => j.jobId.startsWith(prefix));

/**
 * Count completed jobs by prefix
 */
const countCompletedByPrefix = (data: TestData, prefix: string): number =>
  filterJobsByPrefix(data, prefix).filter((j) => j.status === 'completed').length;

/**
 * Count failed jobs
 */
const countFailedJobs = (data: TestData): number =>
  Object.values(data.jobs).filter((j) => j.status === 'failed').length;

/**
 * Verify fixed jobs complete quickly
 */
const verifyFixedJobsCompleteQuickly = (data: TestData, prefix: string): void => {
  const fixedJobs = filterJobsByPrefix(data, prefix);
  for (const job of fixedJobs) {
    const queueDuration = job.queueDurationMs ?? ZERO_COUNT;
    expect(queueDuration).toBeLessThan(MAX_QUEUE_DURATION_MS);
  }
};

/**
 * Run basic capacity test
 */
const runBasicCapacityTest = async (): Promise<TestData> => {
  const fixedJobs = generateJobsOfType(FIXED_JOB_TYPE_SLOTS, 'fixedJobType', {
    prefix: 'fixed-basic',
    durationMs: JOB_DURATION_MS,
  });

  const flexibleJobsA = generateJobsOfType(FLEXIBLE_JOB_TYPE_A_SLOTS, 'flexibleJobTypeA', {
    prefix: 'flex-a-basic',
    durationMs: JOB_DURATION_MS,
  });

  const flexibleJobsB = generateJobsOfType(FLEXIBLE_JOB_TYPE_B_SLOTS, 'flexibleJobTypeB', {
    prefix: 'flex-b-basic',
    durationMs: JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'fixed-ratio-basic',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs: [...fixedJobs, ...flexibleJobsA, ...flexibleJobsB],
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: '1:1',
    configPreset: CONFIG_PRESET,
    sendJobsInParallel: true,
  });
};

/**
 * Create overload flexible jobs
 */
const createOverloadFlexibleJobs = (): GeneratedJob[] => {
  const flexibleJobsA = generateJobsOfType(
    FLEXIBLE_JOB_TYPE_A_SLOTS + OVERLOAD_EXTRA_JOBS,
    'flexibleJobTypeA',
    { prefix: 'overload-flex-a', durationMs: LONG_JOB_DURATION_MS }
  );

  const flexibleJobsB = generateJobsOfType(
    FLEXIBLE_JOB_TYPE_B_SLOTS + OVERLOAD_EXTRA_JOBS,
    'flexibleJobTypeB',
    { prefix: 'overload-flex-b', durationMs: LONG_JOB_DURATION_MS }
  );

  return [...flexibleJobsA, ...flexibleJobsB];
};

/**
 * Run overload test
 */
const runOverloadTest = async (): Promise<TestData> => {
  const flexibleJobs = createOverloadFlexibleJobs();
  const fixedJobs = generateJobsOfType(FIXED_JOB_TYPE_SLOTS, 'fixedJobType', {
    prefix: 'protected-fixed',
    durationMs: JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'fixed-not-affected-by-overload',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs: [...flexibleJobs, ...fixedJobs],
    waitTimeoutMs: WAIT_TIMEOUT_MS * WAIT_TIMEOUT_MULTIPLIER,
    proxyRatio: '1:1',
    configPreset: CONFIG_PRESET,
    waitForMinuteBoundary: true,
  });
};

/**
 * Run borrow test
 */
const runBorrowTest = async (): Promise<TestData> => {
  const flexibleJobsA = generateJobsOfType(
    FLEXIBLE_JOB_TYPE_A_SLOTS + HEAVY_LOAD_EXTRA_JOBS,
    'flexibleJobTypeA',
    { prefix: 'heavy-flex-a', durationMs: JOB_DURATION_MS }
  );

  const flexibleJobsB = generateJobsOfType(SINGLE_JOB, 'flexibleJobTypeB', {
    prefix: 'light-flex-b',
    durationMs: JOB_DURATION_MS,
  });

  const fixedJobs = generateJobsOfType(FIXED_JOB_TYPE_SLOTS, 'fixedJobType', {
    prefix: 'fixed-protected',
    durationMs: JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'flexible-borrow-not-from-fixed',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs: [...flexibleJobsA, ...flexibleJobsB, ...fixedJobs],
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: '1:1',
    configPreset: CONFIG_PRESET,
    waitForMinuteBoundary: true,
  });
};

// Test state holders - initialized with proper typed empty data
let basicCapacityData: TestData = createEmptyTestData();
let overloadTestData: TestData = createEmptyTestData();
let borrowTestData: TestData = createEmptyTestData();

// Boot infrastructure once for all tests in this file
beforeAll(async () => {
  await bootInfrastructure(CONFIG_PRESET);
}, BEFORE_ALL_TIMEOUT_MS);

afterAll(async () => {
  await teardownInfrastructure();
}, AFTER_ALL_TIMEOUT_MS);

describe('Fixed Ratio Isolation - All Job Types Complete at Capacity', () => {
  beforeAll(async () => {
    basicCapacityData = await runBasicCapacityTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete all fixedJobType jobs', () => {
    expect(countCompletedByPrefix(basicCapacityData, 'fixed-basic')).toBe(FIXED_JOB_TYPE_SLOTS);
  });

  it('should complete all flexibleJobTypeA jobs', () => {
    expect(countCompletedByPrefix(basicCapacityData, 'flex-a-basic')).toBe(FLEXIBLE_JOB_TYPE_A_SLOTS);
  });

  it('should complete all flexibleJobTypeB jobs', () => {
    expect(countCompletedByPrefix(basicCapacityData, 'flex-b-basic')).toBe(FLEXIBLE_JOB_TYPE_B_SLOTS);
  });

  it('should not have any failed jobs', () => {
    expect(countFailedJobs(basicCapacityData)).toBe(ZERO_COUNT);
  });
});

describe('Fixed Ratio Isolation - Not Affected by Flexible Overload', () => {
  beforeAll(async () => {
    overloadTestData = await runOverloadTest();
  }, BEFORE_ALL_TIMEOUT_MS * WAIT_TIMEOUT_MULTIPLIER);

  it('should complete all fixedJobType jobs', () => {
    expect(countCompletedByPrefix(overloadTestData, 'protected-fixed')).toBe(FIXED_JOB_TYPE_SLOTS);
  });

  it('should eventually complete all flexibleJobTypeA jobs', () => {
    expect(countCompletedByPrefix(overloadTestData, 'overload-flex-a')).toBe(
      FLEXIBLE_JOB_TYPE_A_SLOTS + OVERLOAD_EXTRA_JOBS
    );
  });

  it('should eventually complete all flexibleJobTypeB jobs', () => {
    expect(countCompletedByPrefix(overloadTestData, 'overload-flex-b')).toBe(
      FLEXIBLE_JOB_TYPE_B_SLOTS + OVERLOAD_EXTRA_JOBS
    );
  });

  it('should not have any failed jobs', () => {
    expect(countFailedJobs(overloadTestData)).toBe(ZERO_COUNT);
  });

  it('fixedJobType jobs should complete quickly without waiting', () => {
    verifyFixedJobsCompleteQuickly(overloadTestData, 'protected-fixed');
  });
});

describe('Fixed Ratio Isolation - Flexible Types Borrow From Each Other Not Fixed', () => {
  beforeAll(async () => {
    borrowTestData = await runBorrowTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete all fixedJobType jobs', () => {
    expect(countCompletedByPrefix(borrowTestData, 'fixed-protected')).toBe(FIXED_JOB_TYPE_SLOTS);
  });

  it('should complete all flexibleJobTypeA jobs (using borrowed capacity)', () => {
    expect(countCompletedByPrefix(borrowTestData, 'heavy-flex-a')).toBe(
      FLEXIBLE_JOB_TYPE_A_SLOTS + HEAVY_LOAD_EXTRA_JOBS
    );
  });

  it('should complete the flexibleJobTypeB job', () => {
    expect(countCompletedByPrefix(borrowTestData, 'light-flex-b')).toBe(SINGLE_JOB);
  });

  it('should not have any failed jobs', () => {
    expect(countFailedJobs(borrowTestData)).toBe(ZERO_COUNT);
  });

  it('fixedJobType jobs should complete quickly', () => {
    verifyFixedJobsCompleteQuickly(borrowTestData, 'fixed-protected');
  });
});
