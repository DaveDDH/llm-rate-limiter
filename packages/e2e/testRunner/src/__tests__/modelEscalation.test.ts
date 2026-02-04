/**
 * Test suite: Model Escalation via maxWaitMS Timeout
 *
 * Verifies that when capacity is filled for 2 minutes, the 101st job
 * escalates to the next model after maxWaitMS timeout.
 *
 * Mechanism:
 * - Jobs 1-50: Fill minute 0 capacity
 * - Jobs 51-100: Fill minute 1 capacity (queued until T=60)
 * - Job 101: Needs minute 2 capacity (T=120)
 * - Job 101's maxWaitMS (~65s) expires at T=65, before minute 2
 * - Job 101 escalates to xai/grok-4.1-fast
 *
 * Configuration:
 * - openai/gpt-5.2: 500,000 TPM → 50 summary jobs per minute
 * - 100 capacity jobs + 1 test job = 101 total
 * - Job duration: 60 seconds
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { generateJobsOfType, runSuite } from '../suiteRunner.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];

// Total capacity: 500,000 TPM / 10,000 tokens = 50 jobs per minute
// Fill 2 minutes: 100 jobs
// Job 101's maxWaitMS (~65s) expires before minute 2 (T=120)
const CAPACITY_JOBS = 100;
// Duration longer than maxWaitMS default (~65s) to ensure timeout before completion
const JOB_DURATION_MS = 60000;

const WAIT_TIMEOUT_MS = 180000;
// Extra 60s for waiting for minute boundary
const BEFORE_ALL_TIMEOUT_MS = 300000;

describe('Model Escalation to Secondary', () => {
  let data: TestData;

  beforeAll(async () => {
    // Create capacity-filling jobs with long duration
    const capacityJobs = generateJobsOfType(CAPACITY_JOBS, 'summary', {
      prefix: 'escalation-capacity',
      durationMs: JOB_DURATION_MS,
    });

    // Create the job that will escalate (also long duration)
    // This is sent as a delayed job to ensure it arrives AFTER capacity jobs are queued
    const escalationJob = {
      jobId: `escalation-test-${Date.now()}`,
      jobType: 'summary',
      payload: { testData: 'Escalation test job', durationMs: JOB_DURATION_MS },
    };

    data = await runSuite({
      suiteName: 'model-escalation',
      proxyUrl: PROXY_URL,
      instanceUrls: INSTANCE_URLS,
      jobs: capacityJobs,
      delayedJobs: [escalationJob],
      delayedJobsDelayMs: 500,
      waitTimeoutMs: WAIT_TIMEOUT_MS,
      proxyRatio: '1:1',
      waitForMinuteBoundary: true,
      sendJobsInParallel: true,
    });
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should send all jobs', () => {
    expect(Object.keys(data.jobs).length).toBe(CAPACITY_JOBS + 1);
  });

  it('should not reject any jobs', () => {
    const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(0);
  });

  it('should complete all jobs', () => {
    const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
    expect(completedJobs.length).toBe(CAPACITY_JOBS + 1);
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
