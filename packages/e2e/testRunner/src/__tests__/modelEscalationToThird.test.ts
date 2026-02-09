/**
 * Test suite: Model Escalation to Third Model
 *
 * Verifies that when capacity is filled on BOTH primary and secondary models,
 * jobs escalate to the third model after maxWaitMS timeouts.
 *
 * Per-model-per-jobType capacity for "summary":
 *   openai: floor(250K x 0.3 / 10K) = 7 rate slots/instance/min (14 total)
 *   xai: 36 JTM slots/instance (72 total)
 *   deepinfra: 30 JTM slots/instance (60 total)
 *
 * Mechanism:
 * - 110 capacity jobs sent in parallel with 70s duration
 * - Minute 0: 14 start on openai, rest queued
 * - T=~65s: queued jobs timeout on openai, overflow to xai (72 start)
 * - Remaining ~10 jobs queue on xai behind the 72 running
 * - Escalation job sent at T=500ms, queued behind all capacity jobs
 * - T=~125s: escalation job's xai maxWaitMS expires; xai jobs still
 *   running (70s > 60s maxWaitMS), so escalation job escalates to deepinfra
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

// 110 capacity jobs saturate both openai and xai queues.
// After maxWaitMS timeouts, overflow reaches all three models.
const CAPACITY_JOBS = 110;
const ESCALATION_JOB_COUNT = 1;
const TOTAL_JOBS = CAPACITY_JOBS + ESCALATION_JOB_COUNT;

// Duration must exceed maxWaitMS on xai (~60s) so xai jobs are still running
// when the escalation job's xai timeout fires, forcing it to deepinfra.
const JOB_DURATION_MS = 70000;

// Timeout values
const WAIT_TIMEOUT_MS = 300000;
const BEFORE_ALL_TIMEOUT_MS = 420000;
const DELAYED_JOB_DELAY_MS = 500;

// Model identifiers
const PRIMARY_MODEL = 'openai/gpt-5.2';
const SECONDARY_MODEL = 'xai/grok-4.1-fast';
const TERTIARY_MODEL = 'deepinfra/gpt-oss-20b';

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
  const capacityJobs = generateJobsOfType(CAPACITY_JOBS, 'summary', {
    prefix: 'capacity-fill',
    durationMs: JOB_DURATION_MS,
  });
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

  it('should use all three models', () => {
    const modelsUsed = new Set(Object.values(data.jobs).map((j) => j.modelUsed));

    expect(modelsUsed.has(PRIMARY_MODEL)).toBe(true);
    expect(modelsUsed.has(SECONDARY_MODEL)).toBe(true);
    expect(modelsUsed.has(TERTIARY_MODEL)).toBe(true);
  });

  it('should escalate the test job to the third model', () => {
    const testJob = Object.values(data.jobs).find((j) => j.jobId.startsWith('escalate-to-third'));
    expect(testJob).toBeDefined();

    // The test job should have escalated to deepinfra
    expect(testJob?.modelUsed).toBe(TERTIARY_MODEL);
  });
});
