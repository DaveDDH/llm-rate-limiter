/**
 * Test suite: Slots Evolve With Load
 *
 * Verifies that calculated slots evolve properly over time
 * as load increases and decreases.
 *
 * Uses the slotCalculation config preset:
 * - model-alpha: 100K TPM
 * - model-beta: 100K TPM
 * - jobTypeA: 10K tokens, ratio 0.6
 * - jobTypeB: 5K tokens, ratio 0.4
 *
 * Key behaviors to verify:
 * 1. When jobs are acquired, available slots decrease
 * 2. When jobs complete, available slots increase (slots freed up)
 * 3. New jobs can use the freed slots immediately
 * 4. The system correctly manages slot count over multiple acquire/release cycles
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

// With slotCalculation config and 2 instances:
// jobTypeA: floor((100K/10K) / 2 * 0.6) = 3 slots per instance = 6 total
// jobTypeB: floor((100K/5K) / 2 * 0.4) = 4 slots per instance = 8 total
const JOB_TYPE_A_TOTAL_SLOTS = 6;
const JOB_TYPE_B_TOTAL_SLOTS = 8;
const LONG_JOB_COUNT = 3;
const ADDITIONAL_JOBS = 3;
const DOUBLE_SLOTS = 2;
const VARIANCE_PERCENT = 0.3; // 30% variance tolerance
const INSTANCE_COUNT = 2;
const ZERO_COUNT = 0;

const SHORT_JOB_DURATION_MS = 100;
const MEDIUM_JOB_DURATION_MS = 1000;
const LONG_JOB_DURATION_MS = 5000;
const WAIT_TIMEOUT_MS = 60000;
const WAIT_TIMEOUT_DOUBLE = 2;
const BEFORE_ALL_TIMEOUT_MS = 180000;
const MAX_QUEUE_DURATION_MS = 1000;
const CONFIG_PRESET: ConfigPresetName = 'slotCalculation';

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
 * Filter jobs by prefix
 */
const filterJobsByPrefix = (data: TestData, prefix: string): Array<TestData['jobs'][string]> =>
  Object.values(data.jobs).filter((j) => j.jobId.startsWith(prefix));

/**
 * Run the sequential acquire/release test
 */
const runSequentialTest = async (): Promise<TestData> => {
  const batch1 = generateJobsOfType(JOB_TYPE_A_TOTAL_SLOTS, 'jobTypeA', {
    prefix: 'evolve-batch1',
    durationMs: SHORT_JOB_DURATION_MS,
  });

  const batch2 = generateJobsOfType(JOB_TYPE_A_TOTAL_SLOTS, 'jobTypeA', {
    prefix: 'evolve-batch2',
    durationMs: SHORT_JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'slots-evolve-sequential',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs: [...batch1, ...batch2],
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: '1:1',
    configPreset: CONFIG_PRESET,
  });
};

/**
 * Run the concurrent slot reuse test
 */
const runConcurrentTest = async (): Promise<TestData> => {
  const longJobs = generateJobsOfType(LONG_JOB_COUNT, 'jobTypeA', {
    prefix: 'long-occupy',
    durationMs: LONG_JOB_DURATION_MS,
  });

  const shortJobs = generateJobsOfType(JOB_TYPE_A_TOTAL_SLOTS, 'jobTypeA', {
    prefix: 'short-wait',
    durationMs: SHORT_JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'slots-evolve-concurrent',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs: [...longJobs, ...shortJobs],
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: '1:1',
    configPreset: CONFIG_PRESET,
    sendJobsInParallel: true,
  });
};

/**
 * Run the interleaved load test
 */
const runInterleavedTest = async (): Promise<TestData> => {
  const typeAJobs = generateJobsOfType(JOB_TYPE_A_TOTAL_SLOTS, 'jobTypeA', {
    prefix: 'interleave-a',
    durationMs: MEDIUM_JOB_DURATION_MS,
  });

  const typeBJobs = generateJobsOfType(JOB_TYPE_B_TOTAL_SLOTS, 'jobTypeB', {
    prefix: 'interleave-b',
    durationMs: MEDIUM_JOB_DURATION_MS,
  });

  const moreAJobs = generateJobsOfType(ADDITIONAL_JOBS, 'jobTypeA', {
    prefix: 'more-a',
    durationMs: SHORT_JOB_DURATION_MS,
  });

  const moreBJobs = generateJobsOfType(ADDITIONAL_JOBS, 'jobTypeB', {
    prefix: 'more-b',
    durationMs: SHORT_JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'slots-evolve-interleaved',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs: [...typeAJobs, ...typeBJobs, ...moreAJobs, ...moreBJobs],
    waitTimeoutMs: WAIT_TIMEOUT_MS * WAIT_TIMEOUT_DOUBLE,
    proxyRatio: '1:1',
    configPreset: CONFIG_PRESET,
    sendJobsInParallel: true,
  });
};

// Test state holders
let sequentialData: TestData = createEmptyTestData();
let concurrentData: TestData = createEmptyTestData();
let interleavedData: TestData = createEmptyTestData();

// Boot infrastructure once for all tests in this file
beforeAll(async () => {
  await bootInfrastructure(CONFIG_PRESET);
}, BEFORE_ALL_TIMEOUT_MS);

afterAll(async () => {
  await teardownInfrastructure();
}, AFTER_ALL_TIMEOUT_MS);

describe('Slots Evolve - Sequential Acquire and Release', () => {
  beforeAll(async () => {
    sequentialData = await runSequentialTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete all jobs from both batches', () => {
    const totalJobs = JOB_TYPE_A_TOTAL_SLOTS * DOUBLE_SLOTS;
    const completedJobs = Object.values(sequentialData.jobs).filter((j) => j.status === 'completed');
    expect(completedJobs.length).toBe(totalJobs);
  });

  it('should complete first batch quickly', () => {
    const batch1Jobs = filterJobsByPrefix(sequentialData, 'evolve-batch1');
    const completed1 = batch1Jobs.filter((j) => j.status === 'completed');
    expect(completed1.length).toBe(JOB_TYPE_A_TOTAL_SLOTS);

    for (const job of batch1Jobs) {
      const queueDuration = job.queueDurationMs ?? ZERO_COUNT;
      expect(queueDuration).toBeLessThan(MAX_QUEUE_DURATION_MS);
    }
  });

  it('should complete second batch after slots are freed', () => {
    expect(countCompletedByPrefix(sequentialData, 'evolve-batch2')).toBe(JOB_TYPE_A_TOTAL_SLOTS);
  });

  it('should not have any failed jobs', () => {
    expect(countFailedJobs(sequentialData)).toBe(ZERO_COUNT);
  });
});

describe('Slots Evolve - Concurrent Load with Slot Reuse', () => {
  beforeAll(async () => {
    concurrentData = await runConcurrentTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete all long-running jobs', () => {
    expect(countCompletedByPrefix(concurrentData, 'long-occupy')).toBe(LONG_JOB_COUNT);
  });

  it('should complete all short jobs after slots freed', () => {
    expect(countCompletedByPrefix(concurrentData, 'short-wait')).toBe(JOB_TYPE_A_TOTAL_SLOTS);
  });

  it('should not have any failed jobs', () => {
    expect(countFailedJobs(concurrentData)).toBe(ZERO_COUNT);
  });
});

describe('Slots Evolve - Multiple Job Types with Interleaved Load', () => {
  beforeAll(async () => {
    interleavedData = await runInterleavedTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should complete all jobTypeA jobs', () => {
    const typeAJobs = Object.values(interleavedData.jobs).filter(
      (j) => j.jobId.startsWith('interleave-a') || j.jobId.startsWith('more-a')
    );
    const completed = typeAJobs.filter((j) => j.status === 'completed');
    expect(completed.length).toBe(JOB_TYPE_A_TOTAL_SLOTS + ADDITIONAL_JOBS);
  });

  it('should complete all jobTypeB jobs', () => {
    const typeBJobs = Object.values(interleavedData.jobs).filter(
      (j) => j.jobId.startsWith('interleave-b') || j.jobId.startsWith('more-b')
    );
    const completed = typeBJobs.filter((j) => j.status === 'completed');
    expect(completed.length).toBe(JOB_TYPE_B_TOTAL_SLOTS + ADDITIONAL_JOBS);
  });

  it('should not have any failed jobs', () => {
    expect(countFailedJobs(interleavedData)).toBe(ZERO_COUNT);
  });

  it('should distribute roughly evenly across both instances', () => {
    const entries = Object.entries(interleavedData.summary.byInstance);
    expect(entries.length).toBe(INSTANCE_COUNT);

    const totalJobs = JOB_TYPE_A_TOTAL_SLOTS + ADDITIONAL_JOBS + JOB_TYPE_B_TOTAL_SLOTS + ADDITIONAL_JOBS;
    const expectedPerInstance = totalJobs / INSTANCE_COUNT;
    const tolerance = expectedPerInstance * VARIANCE_PERCENT;

    for (const [, stats] of entries) {
      const { total: jobCount } = stats;

      expect(jobCount).toBeGreaterThan(expectedPerInstance - tolerance);
      expect(jobCount).toBeLessThan(expectedPerInstance + tolerance);
    }
  });
});
