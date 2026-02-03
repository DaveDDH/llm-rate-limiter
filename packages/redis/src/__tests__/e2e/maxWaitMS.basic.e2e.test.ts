/**
 * E2E tests for basic maxWaitMS behavior with Redis distributed backend.
 * Tests: fail-fast (maxWaitMS: 0), waiting for capacity, and timeout behavior.
 */
import { checkRedisAvailable, createAndStartLimiter, settleDelay, sleep } from './maxWaitMS.helpers.js';
import { assertJobFailed, assertJobSucceeded, queueControllableJob, queueControllableJobs } from './maxWaitMS.jobHelpers.js';
import {
  DEFAULT_TIMEOUT,
  LONG_WAIT_MS,
  SHORT_WAIT_MS,
  SMALL_CAPACITY,
  TOLERANCE_MS,
  cleanupRemainingJobs,
  completeFirstJob,
  createE2ETestHarness,
  createFailFastJobTypes,
  createTimeoutJobTypes,
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
// Tests
// =============================================================================

describe('1.1 maxWaitMS: 0 - Job fails fast when no capacity available', () => {
  it('fails immediately without waiting', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const instance = await createAndStartLimiter({
      state,
      jobTypes: createFailFastJobTypes(),
    });

    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const startTime = Date.now();
    const overflowJob = queueControllableJob(instance.limiter, 'critical', 'overflow');
    const result = await overflowJob.jobPromise;
    const elapsed = Date.now() - startTime;

    assertJobFailed(result);
    expect(elapsed).toBeLessThan(SHORT_WAIT_MS);

    await cleanupRemainingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});

describe('1.2 maxWaitMS > 0 - Job waits for capacity', () => {
  it('waits and succeeds when capacity becomes available', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const instance = await createAndStartLimiter({
      state,
      jobTypes: createWaitingJobTypes(LONG_WAIT_MS),
    });

    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const waitingJob = queueControllableJob(instance.limiter, 'critical', 'waiting');
    await sleep(SHORT_WAIT_MS);
    completeFirstJob(blockingJobs);

    const result = await waitingJob.jobPromise;
    assertJobSucceeded(result);

    await cleanupRemainingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});

describe('1.3 maxWaitMS > 0 - Job timeout behavior', () => {
  it('times out when capacity never available', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const instance = await createAndStartLimiter({
      state,
      jobTypes: createTimeoutJobTypes(SHORT_WAIT_MS),
    });

    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const startTime = Date.now();
    const waitingJob = queueControllableJob(instance.limiter, 'critical', 'waiting');
    const result = await waitingJob.jobPromise;
    const elapsed = Date.now() - startTime;

    assertJobFailed(result);
    expect(elapsed).toBeGreaterThanOrEqual(SHORT_WAIT_MS - TOLERANCE_MS);

    await cleanupRemainingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});
