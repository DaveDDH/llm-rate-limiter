/**
 * Test suite: Flexible Ratio Adjustment
 *
 * Verifies that flexible job types have their ratios adjusted
 * based on load using the donor/receiver algorithm.
 *
 * Uses the flexibleRatio config preset:
 * - flex-model: 100K TPM
 * - flexJobA, flexJobB, flexJobC: 10K tokens each, ratio 0.33 each, all flexible
 *
 * Pool (Redis): totalSlots = floor(100K / 10K / 2) = 5 per instance
 * Pool: tokensPerMinute = 100K / 2 = 50,000
 *
 * Per-model-per-jobType (JTM) for each type (tokens=10K, ratio=0.33):
 *   TPM: floor(50K × 0.33 / 10K) = 1 (windowMs=60,000)
 *   Concurrency: floor(5 × 0.33) = 1 (windowMs=0)
 *   Winner: 1 rate slot (tie-break: prefer windowMs=60,000)
 *   Total: 1 × 2 instances = 2 per type
 *
 * Note: Ratio adjustment is LOCAL to each instance (not shared across instances).
 * This is the intended behavior - each instance manages its own load balance.
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import type { ConfigPresetName } from '../resetInstance.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  INSTANCE_URLS,
  PROXY_URL,
  bootInfrastructure,
  teardownInfrastructure,
} from './infrastructureHelpers.js';
import { createEmptyTestData } from './testHelpers.js';

// Per-model-per-jobType slots (see header comment for derivation):
// Each type: floor(50K × 0.33 / 10K) = 1 per instance × 2 = 2 total
const INITIAL_SLOTS_PER_TYPE = 2;
const DOUBLE_SLOTS = 2;
const SINGLE_JOB = 1;
const ZERO_COUNT = 0;

const JOB_DURATION_MS = 100;
const LONGER_JOB_DURATION_MS = 2000; // Longer jobs to keep slots occupied
const WAIT_TIMEOUT_MS = 90000;
const BEFORE_ALL_TIMEOUT_MS = 180000;
const CONFIG_PRESET: ConfigPresetName = 'flexibleRatio';

/**
 * Count completed jobs by prefix
 */
const countCompletedByPrefix = (data: TestData, prefix: string): number =>
  Object.values(data.jobs)
    .filter((j) => j.jobId.startsWith(prefix))
    .filter((j) => j.status === 'completed').length;

/**
 * Count all failed jobs
 */
const countFailedJobs = (data: TestData): number =>
  Object.values(data.jobs).filter((j) => j.status === 'failed').length;

/**
 * Run the basic test suite with all job types
 */
const runBasicTest = async (): Promise<TestData> => {
  const jobsA = generateJobsOfType(INITIAL_SLOTS_PER_TYPE, 'flexJobA', {
    prefix: 'flex-a',
    durationMs: JOB_DURATION_MS,
  });

  const jobsB = generateJobsOfType(INITIAL_SLOTS_PER_TYPE, 'flexJobB', {
    prefix: 'flex-b',
    durationMs: JOB_DURATION_MS,
  });

  const jobsC = generateJobsOfType(INITIAL_SLOTS_PER_TYPE, 'flexJobC', {
    prefix: 'flex-c',
    durationMs: JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'flexible-ratio-basic',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs: [...jobsA, ...jobsB, ...jobsC],
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: '1:1',
    configPreset: CONFIG_PRESET,
  });
};

/**
 * Run the imbalance test suite
 */
const runImbalanceTest = async (): Promise<TestData> => {
  const jobsA = generateJobsOfType(INITIAL_SLOTS_PER_TYPE * DOUBLE_SLOTS, 'flexJobA', {
    prefix: 'imbalance-a',
    durationMs: JOB_DURATION_MS,
  });

  const jobsB = generateJobsOfType(SINGLE_JOB, 'flexJobB', {
    prefix: 'imbalance-b',
    durationMs: JOB_DURATION_MS,
  });

  const jobsC = generateJobsOfType(SINGLE_JOB, 'flexJobC', {
    prefix: 'imbalance-c',
    durationMs: JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'flexible-ratio-imbalance',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs: [...jobsA, ...jobsB, ...jobsC],
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: '1:1',
    configPreset: CONFIG_PRESET,
  });
};

/**
 * Run the concurrent load test suite
 */
const runConcurrentTest = async (): Promise<TestData> => {
  const jobsB = generateJobsOfType(INITIAL_SLOTS_PER_TYPE, 'flexJobB', {
    prefix: 'concurrent-b',
    durationMs: LONGER_JOB_DURATION_MS,
  });

  const jobsA = generateJobsOfType(INITIAL_SLOTS_PER_TYPE * DOUBLE_SLOTS, 'flexJobA', {
    prefix: 'concurrent-a',
    durationMs: JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'flexible-ratio-concurrent',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs: [...jobsB, ...jobsA],
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: '1:1',
    configPreset: CONFIG_PRESET,
    sendJobsInParallel: true,
  });
};

// Test state holders - initialized with proper typed empty data
let basicData: TestData = createEmptyTestData();
let imbalanceData: TestData = createEmptyTestData();
let concurrentData: TestData = createEmptyTestData();

// Boot infrastructure once for all tests in this file
beforeAll(async () => {
  await bootInfrastructure(CONFIG_PRESET);
}, BEFORE_ALL_TIMEOUT_MS);

afterAll(async () => {
  await teardownInfrastructure();
}, AFTER_ALL_TIMEOUT_MS);

describe('Flexible Ratio Adjustment - All Job Types Complete', () => {
  beforeAll(async () => {
    basicData = await runBasicTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete all flexJobA jobs', () => {
    expect(countCompletedByPrefix(basicData, 'flex-a')).toBe(INITIAL_SLOTS_PER_TYPE);
  });

  it('should complete all flexJobB jobs', () => {
    expect(countCompletedByPrefix(basicData, 'flex-b')).toBe(INITIAL_SLOTS_PER_TYPE);
  });

  it('should complete all flexJobC jobs', () => {
    expect(countCompletedByPrefix(basicData, 'flex-c')).toBe(INITIAL_SLOTS_PER_TYPE);
  });

  it('should not have any failed jobs', () => {
    expect(countFailedJobs(basicData)).toBe(ZERO_COUNT);
  });
});

describe('Flexible Ratio Adjustment - Load Imbalance Handling', () => {
  beforeAll(async () => {
    imbalanceData = await runImbalanceTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete all flexJobA jobs', () => {
    expect(countCompletedByPrefix(imbalanceData, 'imbalance-a')).toBe(INITIAL_SLOTS_PER_TYPE * DOUBLE_SLOTS);
  });

  it('should complete flexJobB and flexJobC jobs', () => {
    expect(countCompletedByPrefix(imbalanceData, 'imbalance-b')).toBe(SINGLE_JOB);
    expect(countCompletedByPrefix(imbalanceData, 'imbalance-c')).toBe(SINGLE_JOB);
  });

  it('should not have any failed jobs', () => {
    expect(countFailedJobs(imbalanceData)).toBe(ZERO_COUNT);
  });
});

describe('Flexible Ratio Adjustment - Concurrent Load', () => {
  beforeAll(async () => {
    concurrentData = await runConcurrentTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete all jobs', () => {
    const completedJobs = Object.values(concurrentData.jobs).filter((j) => j.status === 'completed');
    const totalJobs = INITIAL_SLOTS_PER_TYPE + INITIAL_SLOTS_PER_TYPE * DOUBLE_SLOTS;
    expect(completedJobs.length).toBe(totalJobs);
  });

  it('should not have any failed jobs', () => {
    expect(countFailedJobs(concurrentData)).toBe(ZERO_COUNT);
  });
});
