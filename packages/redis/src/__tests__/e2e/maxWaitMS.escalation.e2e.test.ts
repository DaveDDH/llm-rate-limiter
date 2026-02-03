/**
 * E2E tests for model escalation with maxWaitMS feature.
 * Tests: fail-fast escalation, wait-then-escalate, different wait times per model.
 */
import { checkRedisAvailable, createAndStartLimiter, createJobTypeConfig, settleDelay, sleep } from './maxWaitMS.helpers.js';
import { type ControllableJob, assertJobSucceeded, completeAllJobs, queueControllableJob, queueControllableJobs } from './maxWaitMS.jobHelpers.js';
import {
  DEFAULT_TIMEOUT,
  type JobTypesConfig,
  LONG_WAIT_MS,
  MEDIUM_WAIT_MS,
  NO_WAIT,
  SHORT_WAIT_MS,
  SMALL_CAPACITY,
  TOLERANCE_MS,
  cleanupRemainingJobs,
  completeFirstJob,
  createE2ETestHarness,
  createWaitingJobTypes,
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
// Helper
// =============================================================================

/** Complete all blocking jobs safely */
const finishAllBlockingJobs = async (jobs: ControllableJob[]): Promise<void> => {
  await completeAllJobs(jobs);
};

// =============================================================================
// Tests
// =============================================================================

describe('4.1 Immediate escalation with maxWaitMS: 0', () => {
  it('first model at capacity - immediately escalates', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const CRITICAL_RATIO = 0.7;
    const OTHER_RATIO = 0.1;
    const jobTypes: JobTypesConfig = {
      critical: createJobTypeConfig({ fastModel: NO_WAIT, slowModel: NO_WAIT, backupModel: NO_WAIT }, { initialValue: CRITICAL_RATIO }),
      lowPriority: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
      standard: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
      background: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
    };

    const instance = await createAndStartLimiter({ state, jobTypes });
    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const startTime = Date.now();
    const escalatingJob = queueControllableJob(instance.limiter, 'critical', 'escalating');
    escalatingJob.complete();
    await escalatingJob.jobPromise;
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeLessThan(SHORT_WAIT_MS);
    await finishAllBlockingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});

describe('4.2 Wait and get capacity', () => {
  it('first model at capacity, maxWaitMS > 0 - waits and gets capacity', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const instance = await createAndStartLimiter({
      state,
      jobTypes: createWaitingJobTypes(LONG_WAIT_MS),
      escalationOrder: ['fastModel'],
    });

    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const waitingJob = queueControllableJob(instance.limiter, 'critical', 'waiting');
    await sleep(SHORT_WAIT_MS);
    completeFirstJob(blockingJobs);

    waitingJob.complete();
    const result = await waitingJob.jobPromise;
    assertJobSucceeded(result);
    expect(result.modelUsed).toBe('fastModel');

    await cleanupRemainingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});

describe('4.3 Timeout-based escalation', () => {
  it('first model timeout expires - escalates to next model', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const CRITICAL_RATIO = 0.7;
    const OTHER_RATIO = 0.1;
    const jobTypes: JobTypesConfig = {
      critical: createJobTypeConfig({ fastModel: SHORT_WAIT_MS, slowModel: LONG_WAIT_MS }, { initialValue: CRITICAL_RATIO }),
      lowPriority: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
      standard: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
      background: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
    };

    const instance = await createAndStartLimiter({
      state,
      jobTypes,
      escalationOrder: ['fastModel', 'slowModel'],
    });

    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const escalatingJob = queueControllableJob(instance.limiter, 'critical', 'escalating');
    await sleep(SHORT_WAIT_MS + TOLERANCE_MS);

    escalatingJob.complete();
    const result = await escalatingJob.jobPromise;
    assertJobSucceeded(result);

    await finishAllBlockingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});

describe('4.4 Different maxWaitMS per model', () => {
  it('uses configured wait times for each model', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const CRITICAL_RATIO = 0.7;
    const OTHER_RATIO = 0.1;
    const jobTypes: JobTypesConfig = {
      critical: createJobTypeConfig({ fastModel: SHORT_WAIT_MS, slowModel: LONG_WAIT_MS, backupModel: MEDIUM_WAIT_MS }, { initialValue: CRITICAL_RATIO }),
      lowPriority: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
      standard: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
      background: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
    };

    const instance = await createAndStartLimiter({ state, jobTypes });
    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const job = queueControllableJob(instance.limiter, 'critical', 'escalating');
    await sleep(SHORT_WAIT_MS + TOLERANCE_MS);
    completeFirstJob(blockingJobs);

    job.complete();
    const result = await job.jobPromise;
    assertJobSucceeded(result);

    await cleanupRemainingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});
