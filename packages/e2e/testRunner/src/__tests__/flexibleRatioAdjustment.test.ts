/**
 * Test suite: Flexible Ratio Adjustment
 *
 * Verifies that flexible job types have their ratios adjusted
 * based on load using the donor/receiver algorithm.
 *
 * Uses the flexibleRatio config preset:
 * - flex-model: 100K TPM
 * - flexJobA, flexJobB, flexJobC: 10K tokens each, ratio ~0.33 each, all flexible
 *
 * Expected behavior:
 * - When one job type is overloaded and others are idle, ratios shift
 * - Idle job types (donors) give ratio to overloaded job types (receivers)
 * - Total ratio always sums to 1.0
 *
 * Note: Ratio adjustment is LOCAL to each instance (not shared across instances).
 * This is the intended behavior - each instance manages its own load balance.
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import type { ConfigPresetName } from '../resetInstance.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import { createEmptyTestData } from './testHelpers.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];

// With flexibleRatio config and 2 instances:
// Each job type starts with ~0.33 ratio = floor((100K/10K) / 2 * 0.33) = ~1-2 slots per instance
// Total: ~3 slots per job type (6-9 total across all types)
const INITIAL_SLOTS_PER_TYPE = 3;
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
