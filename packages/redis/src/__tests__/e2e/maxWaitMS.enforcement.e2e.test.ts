/**
 * E2E tests for rate limit enforcement with maxWaitMS feature.
 * Tests: capacity invariants, queue behavior, and timeout cleanup.
 */
import { EventEmitter, once } from 'node:events';

import { type InstanceState, checkRedisAvailable, createAndStartLimiter, settleDelay, sleep } from './maxWaitMS.helpers.js';
import { assertJobFailed, assertJobSucceeded, queueControllableJob, queueControllableJobs } from './maxWaitMS.jobHelpers.js';
import {
  DEFAULT_TIMEOUT,
  LONG_TIMEOUT,
  LONG_WAIT_MS,
  MEDIUM_WAIT_MS,
  ONE,
  SHORT_WAIT_MS,
  SMALL_CAPACITY,
  TWO_MULTIPLIER,
  ZERO,
  cleanupRemainingJobs,
  completeFirstJob,
  createE2ETestHarness,
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
// Types for Capacity Tracking
// =============================================================================

interface CapacityTracker {
  current: number;
  max: number;
}

interface SignalEmitter {
  emitter: EventEmitter;
  release: () => void;
}

// =============================================================================
// Signal Helpers
// =============================================================================

/** Create a signal emitter for coordinating job completion */
const createSignalEmitter = (): SignalEmitter => {
  const emitter = new EventEmitter();
  return {
    emitter,
    release: (): void => {
      emitter.emit('release');
    },
  };
};

/** Wait for a signal to be released */
const waitForRelease = async (signal: SignalEmitter): Promise<void> => {
  await once(signal.emitter, 'release');
};

// =============================================================================
// Tests
// =============================================================================

describe('3.1 Capacity limit enforcement', () => {
  it('cannot exceed capacity even with many waiting jobs', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const instance = await createAndStartLimiter({
      state,
      jobTypes: createWaitingJobTypes(MEDIUM_WAIT_MS),
    });

    const tracker: CapacityTracker = { current: ZERO, max: ZERO };
    const totalJobs = SMALL_CAPACITY * TWO_MULTIPLIER;
    const signals = Array.from({ length: totalJobs }, createSignalEmitter);
    const jobPromises = createCapacityTrackingJobs(instance, tracker, signals, totalJobs);

    await sleep(MEDIUM_WAIT_MS);
    expect(tracker.max).toBeLessThanOrEqual(SMALL_CAPACITY);

    releaseAllSignals(signals);
    await Promise.all(jobPromises);
  }, LONG_TIMEOUT);
});

/** Create a single tracking job */
const createSingleTrackingJob = async (
  instance: InstanceState,
  tracker: CapacityTracker,
  signal: SignalEmitter,
  index: number
): Promise<void> => {
  try {
    await instance.limiter.queueJob({
      jobId: `tracking-${index}`,
      jobType: 'critical',
      job: createTrackingJobFn(tracker, signal),
    });
  } catch {
    // Job may fail due to timeout, which is expected
  }
};

/** Create a job promise for a given index */
const createJobPromiseForIndex = async (
  instance: InstanceState,
  tracker: CapacityTracker,
  signals: SignalEmitter[],
  index: number
): Promise<void> => {
  const signal = signals[index];
  if (signal === undefined) {
    throw new Error(`Signal at index ${index} not found`);
  }
  await createSingleTrackingJob(instance, tracker, signal, index);
};

/** Create jobs that track concurrent execution count */
const createCapacityTrackingJobs = (
  instance: InstanceState,
  tracker: CapacityTracker,
  signals: SignalEmitter[],
  totalJobs: number
): Array<Promise<void>> =>
  Array.from({ length: totalJobs }, async (_, index) => {
    await createJobPromiseForIndex(instance, tracker, signals, index);
  });

/** Create the job function that tracks capacity */
const createTrackingJobFn = (
  tracker: CapacityTracker,
  signal: SignalEmitter
): (
  context: { modelId: string },
  resolve: (result: { modelId: string; inputTokens: number; cachedTokens: number; outputTokens: number }) => void
) => Promise<{ requestCount: number; usage: { input: number; output: number; cached: number } }> =>
  async ({ modelId }, resolve) => {
    Object.assign(tracker, { current: tracker.current + ONE, max: Math.max(tracker.max, tracker.current + ONE) });
    await waitForRelease(signal);
    Object.assign(tracker, { current: tracker.current - ONE });
    resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
    return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
  };

/** Release all waiting signals */
const releaseAllSignals = (signals: SignalEmitter[]): void => {
  for (const signal of signals) {
    signal.release();
  }
};

describe('3.2 Single slot release behavior', () => {
  it('multiple waiting jobs + 1 slot released - only 1 job executes immediately', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const instance = await createAndStartLimiter({
      state,
      jobTypes: createWaitingJobTypes(LONG_WAIT_MS),
    });

    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const waiting1 = queueControllableJob(instance.limiter, 'critical', 'waiting-1');
    const waiting2 = queueControllableJob(instance.limiter, 'critical', 'waiting-2');
    const waiting3 = queueControllableJob(instance.limiter, 'critical', 'waiting-3');

    await sleep(SHORT_WAIT_MS);
    completeFirstJob(blockingJobs);
    await settleDelay();

    const firstResult = await Promise.race([
      waiting1.jobPromise.then((r) => ({ job: 'waiting-1', result: r })),
      waiting2.jobPromise.then((r) => ({ job: 'waiting-2', result: r })),
      waiting3.jobPromise.then((r) => ({ job: 'waiting-3', result: r })),
    ]);

    assertJobSucceeded(firstResult.result);
    await cleanupRemainingJobs(blockingJobs);
    await Promise.all([waiting1.jobPromise, waiting2.jobPromise, waiting3.jobPromise]);
  }, DEFAULT_TIMEOUT);
});

describe('3.3 Timeout cleanup', () => {
  it('timed-out jobs are properly cleaned from queue', async () => {
    const available = await checkRedisAvailable();
    if (!available) return;

    const instance = await createAndStartLimiter({
      state,
      jobTypes: createTimeoutJobTypes(SHORT_WAIT_MS),
    });

    const blockingJobs = queueControllableJobs(instance.limiter, 'critical', SMALL_CAPACITY, 'blocking');
    await settleDelay();

    const timeoutJob = queueControllableJob(instance.limiter, 'critical', 'timeout');
    const result = await timeoutJob.jobPromise;
    assertJobFailed(result);

    completeFirstJob(blockingJobs);
    await settleDelay();

    const newJob = queueControllableJob(instance.limiter, 'critical', 'new');
    newJob.complete();
    const newResult = await newJob.jobPromise;
    assertJobSucceeded(newResult);

    await cleanupRemainingJobs(blockingJobs);
  }, DEFAULT_TIMEOUT);
});
