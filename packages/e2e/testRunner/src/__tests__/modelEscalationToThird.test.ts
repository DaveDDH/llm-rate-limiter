/**
 * Test suite: Model Escalation to Third Model
 *
 * Verifies that when capacity is filled on BOTH primary and secondary models,
 * jobs escalate to the third model after maxWaitMS timeouts.
 *
 * Per-model-per-jobType capacity for "summary":
 *   openai: floor(250K × 0.3 / 10K) = 7 rate slots/instance/min (14 total)
 *   xai: concurrency-limited at floor(109 pool × 0.3) = 32/instance (64 total)
 *   deepinfra: concurrency-limited at floor(100 pool × 0.3) = 30/instance (60 total)
 *
 * Mechanism:
 * - 100 openai-fill + 800 xai-fill capacity jobs sent to saturate all queues
 * - Escalation job sent at T=500ms
 * - Times out on openai (~65s), then times out on xai (~65s)
 * - Escalates to deepinfra/gpt-oss-20b
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

// Saturate both openai and xai queues so the escalation job can't get a slot:
// openai: 7 rate slots/instance/min → 100 jobs saturates queue
// xai: 32 concurrency slots/instance → 800 jobs saturates queue
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
