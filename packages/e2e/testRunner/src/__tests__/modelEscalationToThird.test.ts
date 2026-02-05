/**
 * Test suite: Model Escalation to Third Model
 *
 * Verifies that when capacity is filled on BOTH primary and secondary models,
 * jobs escalate to the third model after maxWaitMS timeouts.
 *
 * Mechanism:
 * - Fill primary model (openai) with 50 long-running jobs
 * - Fill secondary model (xai) with 400 long-running jobs
 * - Send an additional job that can't fit on either
 * - The job times out on openai (~65s), then times out on xai (~65s)
 * - Job escalates to the third model (deepinfra)
 *
 * Capacity calculations:
 * - openai/gpt-5.2: 500,000 TPM / 10,000 tokens = 50 jobs
 * - xai/grok-4.1-fast: 4,000,000 TPM / 10,000 tokens = 400 jobs
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
import { ZERO_COUNT, createEmptyTestData } from './testHelpers.js';

// Capacity to fill 2 minutes worth of each model
// openai: 50/min x 2 = 100, xai: 400/min x 2 = 800
// Total: 900 capacity jobs, so job 901 (escalation) reaches deepinfra
const OPENAI_CAPACITY = 100;
const XAI_CAPACITY = 800;
const ESCALATION_JOB_COUNT = 1;

// Duration longer than maxWaitMS default (~65s) to ensure timeout
const JOB_DURATION_MS = 60000;

// Timeout values
const WAIT_TIMEOUT_MS = 360000;
const BEFORE_ALL_TIMEOUT_MS = 420000;
const DELAYED_JOB_DELAY_MS = 500;

/**
 * Create jobs to fill openai capacity
 */
const createOpenaiJobs = (): ReturnType<typeof generateJobsOfType> =>
  generateJobsOfType(OPENAI_CAPACITY, 'summary', {
    prefix: 'openai-fill',
    durationMs: JOB_DURATION_MS,
  });

/**
 * Create jobs to fill xai capacity
 */
const createXaiJobs = (): ReturnType<typeof generateJobsOfType> =>
  generateJobsOfType(XAI_CAPACITY, 'summary', {
    prefix: 'xai-fill',
    durationMs: JOB_DURATION_MS,
  });

/**
 * Create the escalation job that will escalate to deepinfra
 */
const createEscalationJob = (): { jobId: string; jobType: string; payload: Record<string, unknown> } => ({
  jobId: `escalate-to-third-${Date.now()}`,
  jobType: 'summary',
  payload: { testData: 'Should escalate to deepinfra', durationMs: JOB_DURATION_MS },
});

/**
 * Run the model escalation to third test suite
 */
const runModelEscalationThirdTest = async (): Promise<TestData> => {
  const openaiJobs = createOpenaiJobs();
  const xaiJobs = createXaiJobs();
  const capacityJobs = [...openaiJobs, ...xaiJobs];
  const escalationJob = createEscalationJob();

  return await runSuite({
    suiteName: 'model-escalation-third',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs: capacityJobs,
    delayedJobs: [escalationJob],
    delayedJobsDelayMs: DELAYED_JOB_DELAY_MS,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: '1:1',
    waitForMinuteBoundary: true,
    sendJobsInParallel: true,
  });
};

describe('Model Escalation to Third Model', () => {
  let data: TestData = createEmptyTestData();

  beforeAll(async () => {
    await bootInfrastructure();
    data = await runModelEscalationThirdTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await teardownInfrastructure();
  }, AFTER_ALL_TIMEOUT_MS);

  it('should send all jobs', () => {
    const expectedTotal = OPENAI_CAPACITY + XAI_CAPACITY + ESCALATION_JOB_COUNT;
    expect(Object.keys(data.jobs).length).toBe(expectedTotal);
  });

  it('should not reject any jobs', () => {
    const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(ZERO_COUNT);
  });

  it('should complete all jobs', () => {
    const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
    const expectedTotal = OPENAI_CAPACITY + XAI_CAPACITY + ESCALATION_JOB_COUNT;
    expect(completedJobs.length).toBe(expectedTotal);
  });

  it('should use all three models', () => {
    const modelsUsed = new Set(Object.values(data.jobs).map((j) => j.modelUsed));

    expect(modelsUsed.has('openai/gpt-5.2')).toBe(true);
    expect(modelsUsed.has('xai/grok-4.1-fast')).toBe(true);
    expect(modelsUsed.has('deepinfra/gpt-oss-20b')).toBe(true);
  });

  it('should escalate the test job to the third model', () => {
    const testJob = Object.values(data.jobs).find((j) => j.jobId.startsWith('escalate-to-third'));
    expect(testJob).toBeDefined();

    // The test job should have escalated to deepinfra
    expect(testJob?.modelUsed).toBe('deepinfra/gpt-oss-20b');
  });
});
