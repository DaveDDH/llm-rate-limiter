/**
 * Test suite: Exact Capacity
 *
 * Sends exactly the rate limiter capacity worth of jobs and verifies all complete.
 *
 * Capacity calculation for openai/gpt-5.2:
 * - TPM limit: 500,000 tokens/minute
 * - Summary job: 10,000 tokens each
 * - Capacity: 500,000 / 10,000 = 50 jobs
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  INSTANCE_URLS,
  PROXY_URL,
  bootInfrastructure,
  teardownInfrastructure,
} from './infrastructureHelpers.js';
import { createEmptyTestData } from './testHelpers.js';

// Exact capacity: 500,000 TPM / 10,000 tokens per summary job = 50 jobs
const EXACT_CAPACITY = 50;
const JOB_DURATION_MS = 100;
const WAIT_TIMEOUT_MS = 60000;
const BEFORE_ALL_TIMEOUT_MS = 120000;

// Constants
const ZERO_COUNT = 0;
const INSTANCE_COUNT = 2;
const JOBS_PER_INSTANCE = EXACT_CAPACITY / INSTANCE_COUNT;

/**
 * Setup test data by running the suite
 */
const setupTestData = async (): Promise<TestData> => {
  const jobs = generateJobsOfType(EXACT_CAPACITY, 'summary', {
    prefix: 'capacity-test',
    durationMs: JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'exact-capacity',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: '1:1',
  });
};

/** Verify job lifecycle events */
const verifyJobLifecycle = (data: TestData): void => {
  for (const job of Object.values(data.jobs)) {
    expect(job.events.some((e) => e.type === 'queued')).toBe(true);
    expect(job.events.some((e) => e.type === 'started')).toBe(true);
    expect(job.events.some((e) => e.type === 'completed')).toBe(true);
  }
};

/** Verify job distribution across instances */
const verifyJobDistribution = (data: TestData): void => {
  const { summary } = data;
  const { byInstance } = summary;
  const entries = Object.entries(byInstance);
  expect(entries.length).toBe(INSTANCE_COUNT);
  for (const [, instanceStats] of entries) {
    expect(instanceStats).toBeDefined();
    expect(instanceStats.total).toBe(JOBS_PER_INSTANCE);
  }
};

// Test state
let testData: TestData = createEmptyTestData();

beforeAll(async () => {
  await bootInfrastructure();
  testData = await setupTestData();
}, BEFORE_ALL_TIMEOUT_MS);

afterAll(async () => {
  await teardownInfrastructure();
}, AFTER_ALL_TIMEOUT_MS);

describe('Exact Capacity', () => {
  it('should send exactly the capacity number of jobs', () => {
    expect(Object.keys(testData.jobs).length).toBe(EXACT_CAPACITY);
  });

  it('should complete all jobs without failures', () => {
    const completedJobs = Object.values(testData.jobs).filter((j) => j.status === 'completed');
    const failedJobs = Object.values(testData.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(ZERO_COUNT);
    expect(completedJobs.length).toBe(EXACT_CAPACITY);
  });

  it('should process all jobs through the rate limiter', () => {
    verifyJobLifecycle(testData);
  });

  it('should distribute jobs evenly across both instances', () => {
    verifyJobDistribution(testData);
  });

  it('should use the primary model for all jobs', () => {
    const { summary } = testData;
    const { byModel } = summary;
    const primaryModel = Object.entries(byModel).find(([key]) => key === 'openai/gpt-5.2');
    expect(primaryModel).toBeDefined();
    const [, modelStats] = primaryModel ?? [];
    expect(modelStats?.completed).toBe(EXACT_CAPACITY);
  });
});
