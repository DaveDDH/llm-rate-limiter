/**
 * E2E tests for per-job-type maxWaitMS configuration.
 * Tests: different job types with different wait behaviors.
 */
import { checkRedisAvailable, createAndStartLimiter, createJobTypeConfig, settleDelay } from './maxWaitMS.helpers.js';
import { assertJobFailed, assertJobSucceeded, queueControllableJob, queueControllableJobs } from './maxWaitMS.jobHelpers.js';
import {
  DEFAULT_TIMEOUT,
  type JobTypesConfig,
  LONG_WAIT_MS,
  NO_WAIT,
  SHORT_WAIT_MS,
  SMALL_CAPACITY,
  cleanupRemainingJobs,
  completeFirstJob,
  createE2ETestHarness,
} from './maxWaitMS.testSetup.js';

// =============================================================================
// Test Setup
// =============================================================================

const { state, beforeAllFn, afterAllFn, beforeEachFn, afterEachFn } = createE2ETestHarness();

beforeAll(beforeAllFn, DEFAULT_TIMEOUT);
afterAll(afterAllFn, DEFAULT_TIMEOUT);
beforeEach(beforeEachFn);
afterEach(afterEachFn);

// =============================================================================
// Tests
// =============================================================================

describe('5.1 Low priority with fail-fast', () => {
  it('low priority (maxWaitMS: 0) fails fast while critical waits', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const CRITICAL_RATIO = 0.5;
    const LOW_PRIORITY_RATIO = 0.3;
    const OTHER_RATIO = 0.1;
    const jobTypes: JobTypesConfig = {
      critical: createJobTypeConfig({ fastModel: LONG_WAIT_MS }, { initialValue: CRITICAL_RATIO }),
      lowPriority: createJobTypeConfig({ fastModel: NO_WAIT, slowModel: NO_WAIT, backupModel: NO_WAIT }, { initialValue: LOW_PRIORITY_RATIO }),
      standard: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
      background: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
    };

    const instance = await createAndStartLimiter({ state, jobTypes });
    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const criticalJob = queueControllableJob(instance.limiter, 'critical', 'critical-waiting');
    const lowPriorityJob = queueControllableJob(instance.limiter, 'lowPriority', 'low-priority');

    const lowPriorityResult = await lowPriorityJob.jobPromise;
    assertJobFailed(lowPriorityResult);

    completeFirstJob(blockingJobs);
    criticalJob.complete();
    const criticalResult = await criticalJob.jobPromise;
    assertJobSucceeded(criticalResult);

    await cleanupRemainingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});

describe('5.2 Different maxWaitMS values per job type', () => {
  it('two job types with different maxWaitMS values', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const CRITICAL_RATIO = 0.5;
    const LOW_PRIORITY_RATIO = 0.3;
    const OTHER_RATIO = 0.1;
    const jobTypes: JobTypesConfig = {
      critical: createJobTypeConfig({ fastModel: LONG_WAIT_MS }, { initialValue: CRITICAL_RATIO }),
      lowPriority: createJobTypeConfig({ fastModel: SHORT_WAIT_MS, slowModel: SHORT_WAIT_MS, backupModel: SHORT_WAIT_MS }, { initialValue: LOW_PRIORITY_RATIO }),
      standard: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
      background: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
    };

    const instance = await createAndStartLimiter({ state, jobTypes });
    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const criticalJob = queueControllableJob(instance.limiter, 'critical', 'critical');
    const lowPriorityJob = queueControllableJob(instance.limiter, 'lowPriority', 'low');

    const lowResult = await lowPriorityJob.jobPromise;
    assertJobFailed(lowResult);

    completeFirstJob(blockingJobs);
    criticalJob.complete();
    const criticalResult = await criticalJob.jobPromise;
    assertJobSucceeded(criticalResult);

    await cleanupRemainingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});
