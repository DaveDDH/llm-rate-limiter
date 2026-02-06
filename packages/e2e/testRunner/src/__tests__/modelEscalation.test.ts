/**
 * Test suite: Model Escalation via maxWaitMS Timeout
 *
 * Verifies that when the openai rate capacity is exhausted, an additional
 * job escalates to the next model after maxWaitMS timeout.
 *
 * Per-model-per-jobType rate capacity for "summary" on openai:
 *   Per-instance: floor(250,000 × 0.3 / 10,000) = 7 rate slots per minute
 *   Total: 2 × 7 = 14 rate slots per minute window
 *
 * Mechanism:
 * - 100 capacity jobs sent in parallel (saturates both instances' queues)
 * - Minute 0: 7 start per instance (14 total), remaining queued
 * - Escalation job sent at T=500ms, queued behind capacity jobs
 * - Rate slots don't free on job completion (window counter stays at 7/7)
 * - At minute boundaries, window resets but capacity jobs ahead in queue
 *   consume the new rate slots before the escalation job
 * - T=~65s: maxWaitMS expires → escalation job moves to xai/grok-4.1-fast
 * - On xai, the escalation job starts immediately (xai queue is empty)
 *
 * Configuration:
 * - openai/gpt-5.2: 500,000 TPM, 500 RPM
 * - summary: 10,000 tokens, 1 request, ratio 0.3
 * - 100 capacity jobs + 1 escalation job = 101 total
 * - Job duration: 60 seconds (longer than maxWaitMS ~65s)
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

// Per-model-per-jobType rate capacity for "summary" on openai:
// floor(250,000 × 0.3 / 10,000) = 7 per instance = 14 rate slots per minute
// 100 capacity jobs saturate the queue so the escalation job can't get a slot
// Escalation job's maxWaitMS (~65s) expires → escalates to xai
const CAPACITY_JOBS = 100;
const ESCALATION_JOB_COUNT = 1;
const TOTAL_JOBS = CAPACITY_JOBS + ESCALATION_JOB_COUNT;

// Duration longer than maxWaitMS default (~65s) to ensure timeout before completion
const JOB_DURATION_MS = 60000;

const WAIT_TIMEOUT_MS = 180000;
// Extra 60s for waiting for minute boundary
const BEFORE_ALL_TIMEOUT_MS = 300000;

// Constants
const DELAYED_JOB_DELAY_MS = 500;

/**
 * Create the escalation test job
 */
const createEscalationJob = (): { jobId: string; jobType: string; payload: Record<string, unknown> } => ({
  jobId: `escalation-test-${Date.now()}`,
  jobType: 'summary',
  payload: { testData: 'Escalation test job', durationMs: JOB_DURATION_MS },
});

/**
 * Run the model escalation test suite
 */
const runModelEscalationTest = async (): Promise<TestData> => {
  const capacityJobs = generateJobsOfType(CAPACITY_JOBS, 'summary', {
    prefix: 'escalation-capacity',
    durationMs: JOB_DURATION_MS,
  });

  const escalationJob = createEscalationJob();

  return await runSuite({
    suiteName: 'model-escalation',
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

describe('Model Escalation to Secondary', () => {
  let data: TestData = createEmptyTestData();

  beforeAll(async () => {
    await bootInfrastructure();
    data = await runModelEscalationTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await teardownInfrastructure();
  }, AFTER_ALL_TIMEOUT_MS);

  it('should send all jobs', () => {
    expect(Object.keys(data.jobs).length).toBe(TOTAL_JOBS);
  });

  it('should not reject any jobs', () => {
    const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(ZERO_COUNT);
  });

  it('should complete all jobs', () => {
    const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
    expect(completedJobs.length).toBe(TOTAL_JOBS);
  });

  it('should run all capacity jobs on the primary model', () => {
    const capacityJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('escalation-capacity'));
    const jobsOnPrimary = capacityJobs.filter((j) => j.modelUsed === 'openai/gpt-5.2');

    // All 100 capacity jobs should complete on openai
    expect(jobsOnPrimary.length).toBe(CAPACITY_JOBS);
  });

  it('should escalate the test job to the secondary model', () => {
    const testJob = Object.values(data.jobs).find((j) => j.jobId.startsWith('escalation-test'));
    expect(testJob).toBeDefined();

    // The test job (job 101) should have escalated to xai
    expect(testJob?.modelUsed).toBe('xai/grok-4.1-fast');
  });
});
