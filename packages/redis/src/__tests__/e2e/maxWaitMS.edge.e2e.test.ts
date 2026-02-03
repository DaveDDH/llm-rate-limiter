/**
 * E2E tests for edge cases with maxWaitMS feature.
 * Tests: exact capacity, very short timeouts, stress tests.
 */
import type { LLMRateLimiterInstance } from '@llm-rate-limiter/core';

import { type InstanceState, type TestJobType, checkRedisAvailable, createAndStartLimiter, createJobTypeConfig, settleDelay } from './maxWaitMS.helpers.js';
import { type ControllableJob, assertJobFailed, assertJobSucceeded, completeAllJobs, queueControllableJob, queueControllableJobs } from './maxWaitMS.jobHelpers.js';
import {
  DEFAULT_TIMEOUT,
  type JobTypesConfig,
  LONG_TIMEOUT,
  LONG_WAIT_MS,
  MEDIUM_WAIT_MS,
  NO_WAIT,
  ONE,
  SHORT_WAIT_MS,
  SMALL_CAPACITY,
  THREE,
  VERY_SHORT_TIMEOUT,
  ZERO,
  createE2ETestHarness,
  createWaitingJobTypes,
} from './maxWaitMS.testSetup.js';

// =============================================================================
// Types
// =============================================================================

type TestLimiter = LLMRateLimiterInstance<TestJobType>;

// =============================================================================
// Test Setup
// =============================================================================

const { state, beforeAllFn, afterAllFn, beforeEachFn, afterEachFn } = createE2ETestHarness();

beforeAll(beforeAllFn, DEFAULT_TIMEOUT);
afterAll(afterAllFn, DEFAULT_TIMEOUT);
beforeEach(beforeEachFn);
afterEach(afterEachFn);

// =============================================================================
// Helpers
// =============================================================================

/** Complete all blocking jobs safely */
const finishAllBlockingJobs = async (jobs: ControllableJob[]): Promise<void> => {
  await completeAllJobs(jobs);
};

/** Queue stress test jobs across all instances and job types */
const queueStressTestJobs = (instances: InstanceState[], jobTypeNames: TestJobType[]): ControllableJob[] => {
  const allJobs: ControllableJob[] = [];

  for (const instance of instances) {
    const instanceJobs = queueJobsForInstance(instance.limiter, jobTypeNames, allJobs.length);
    allJobs.push(...instanceJobs);
  }

  return allJobs;
};

/** Queue jobs for a single instance */
const queueJobsForInstance = (limiter: TestLimiter, jobTypeNames: TestJobType[], startCounter: number): ControllableJob[] => {
  const jobs: ControllableJob[] = [];
  let counter = startCounter;

  for (const jobType of jobTypeNames) {
    for (let i = ZERO; i < THREE; i += ONE) {
      jobs.push(queueControllableJob(limiter, jobType, `stress-${counter}`));
      counter += ONE;
    }
  }

  return jobs;
};

// =============================================================================
// Tests
// =============================================================================

describe('7.1 Exact capacity', () => {
  it('job arrives exactly at capacity - executes immediately', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const instance = await createAndStartLimiter({
      state,
      jobTypes: createWaitingJobTypes(LONG_WAIT_MS),
    });

    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY - ONE, 'blocking');
    await settleDelay();

    const startTime = Date.now();
    const immediateJob = queueControllableJob(instance.limiter, 'critical', 'immediate');
    immediateJob.complete();
    const result = await immediateJob.jobPromise;
    const elapsed = Date.now() - startTime;

    assertJobSucceeded(result);
    expect(elapsed).toBeLessThan(SHORT_WAIT_MS);

    await finishAllBlockingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});

describe('7.2 Very short timeout', () => {
  it('very short maxWaitMS (100ms) - timeout works correctly', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const CRITICAL_RATIO = 0.7;
    const OTHER_RATIO = 0.1;
    const jobTypes: JobTypesConfig = {
      critical: createJobTypeConfig({
        fastModel: VERY_SHORT_TIMEOUT,
        slowModel: VERY_SHORT_TIMEOUT,
        backupModel: VERY_SHORT_TIMEOUT,
      }, { initialValue: CRITICAL_RATIO }),
      lowPriority: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
      standard: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
      background: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
    };

    const instance = await createAndStartLimiter({ state, jobTypes });
    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const startTime = Date.now();
    const shortTimeoutJob = queueControllableJob(instance.limiter, 'critical', 'short-timeout');
    const result = await shortTimeoutJob.jobPromise;
    const elapsed = Date.now() - startTime;

    assertJobFailed(result);
    expect(elapsed).toBeLessThan(SHORT_WAIT_MS);

    await finishAllBlockingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});

describe('7.3 Stress test', () => {
  it('many jobs with varying maxWaitMS across instances', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const STRESS_CRITICAL_RATIO = 0.4;
    const STRESS_OTHER_RATIO = 0.2;
    const jobTypes: JobTypesConfig = {
      critical: createJobTypeConfig({ fastModel: MEDIUM_WAIT_MS }, { initialValue: STRESS_CRITICAL_RATIO }),
      lowPriority: createJobTypeConfig({ fastModel: SHORT_WAIT_MS, slowModel: SHORT_WAIT_MS, backupModel: SHORT_WAIT_MS }, { initialValue: STRESS_OTHER_RATIO }),
      standard: createJobTypeConfig({ fastModel: LONG_WAIT_MS }, { initialValue: STRESS_OTHER_RATIO }),
      background: createJobTypeConfig({ fastModel: NO_WAIT }, { initialValue: STRESS_OTHER_RATIO }),
    };

    const instances = await Promise.all([
      createAndStartLimiter({ state, jobTypes }),
      createAndStartLimiter({ state, jobTypes }),
      createAndStartLimiter({ state, jobTypes }),
    ]);
    await settleDelay();

    const jobTypeNames: TestJobType[] = ['critical', 'lowPriority', 'standard', 'background'];
    const allJobs = queueStressTestJobs(instances, jobTypeNames);

    const results = await completeAllJobs(allJobs);
    const { successCount, failureCount } = countResults(results);

    expect(successCount + failureCount).toBe(allJobs.length);
    expect(successCount).toBeGreaterThan(ZERO);
  }, LONG_TIMEOUT);
});

/** Count successful and failed results */
const countResults = (results: Array<{ success: boolean }>): { successCount: number; failureCount: number } => ({
  successCount: results.filter((r) => r.success).length,
  failureCount: results.filter((r) => !r.success).length,
});
