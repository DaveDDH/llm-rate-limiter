/**
 * E2E tests for distributed maxWaitMS behavior with Redis backend.
 * Tests: cross-instance capacity release, waiting coordination between instances.
 */
import { checkRedisAvailable, createAndStartLimiter, settleDelay, sleep } from './maxWaitMS.helpers.js';
import { assertJobSucceeded, completeAllJobs, queueControllableJob, queueControllableJobs } from './maxWaitMS.jobHelpers.js';
import {
  DEFAULT_TIMEOUT,
  ONE,
  SHORT_WAIT_MS,
  SMALL_CAPACITY,
  TOLERANCE_MS,
  TWO,
  cleanupRemainingJobs,
  completeFirstJob,
  completeSecondJob,
  createE2ETestHarness,
  createWaitingJobTypes,
  getJobsAfterSecond,
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

describe('2.1 Cross-instance capacity release', () => {
  it('Instance A waiting job gets capacity when Instance B completes job', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const jobTypes = createWaitingJobTypes();
    const instanceA = await createAndStartLimiter({ state, jobTypes });
    const instanceB = await createAndStartLimiter({ state, jobTypes });
    await settleDelay();

    const blockingJobs = queueControllableJobs(instanceB.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const waitingJob = queueControllableJob(instanceA.limiter, 'critical', 'waiting-A');
    await sleep(SHORT_WAIT_MS);
    completeFirstJob(blockingJobs);

    const result = await waitingJob.jobPromise;
    assertJobSucceeded(result);

    await cleanupRemainingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});

describe('2.2 Three instances coordination', () => {
  it('job completes on one, waiting job on another wakes', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const jobTypes = createWaitingJobTypes();
    const instanceA = await createAndStartLimiter({ state, jobTypes });
    const instanceB = await createAndStartLimiter({ state, jobTypes });
    const instanceC = await createAndStartLimiter({ state, jobTypes });
    await settleDelay();

    const jobsA = queueControllableJobs(instanceA.limiter, 'critical', TWO, 'A');
    const jobsB = queueControllableJobs(instanceB.limiter, 'critical', TWO, 'B');
    const jobsC = queueControllableJobs(instanceC.limiter, 'critical', ONE, 'C');
    await settleDelay();

    const waitingJob = queueControllableJob(instanceA.limiter, 'critical', 'waiting');
    await sleep(SHORT_WAIT_MS);
    completeFirstJob(jobsC);

    const result = await waitingJob.jobPromise;
    assertJobSucceeded(result);

    await completeAllJobs([...jobsA, ...jobsB]);
  }, DEFAULT_TIMEOUT);
});

describe('2.3 Multiple instances with waiting jobs', () => {
  it('both waiting jobs eventually complete', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const jobTypes = createWaitingJobTypes();
    const instanceA = await createAndStartLimiter({ state, jobTypes });
    const instanceB = await createAndStartLimiter({ state, jobTypes });
    await settleDelay();

    const blockingJobs = queueControllableJobs(instanceA.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const waitingA = queueControllableJob(instanceA.limiter, 'critical', 'waiting-A');
    await sleep(TOLERANCE_MS);
    const waitingB = queueControllableJob(instanceB.limiter, 'critical', 'waiting-B');

    await sleep(SHORT_WAIT_MS);
    completeFirstJob(blockingJobs);
    await settleDelay();
    completeSecondJob(blockingJobs);

    const [resultA, resultB] = await Promise.all([waitingA.jobPromise, waitingB.jobPromise]);
    assertJobSucceeded(resultA);
    assertJobSucceeded(resultB);

    await completeAllJobs(getJobsAfterSecond(blockingJobs));
  }, DEFAULT_TIMEOUT);
});
