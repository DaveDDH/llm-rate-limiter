/**
 * Extreme load tests for Redis distributed backend.
 * These tests validate that the rate limiter NEVER exceeds capacity under any conditions.
 * Mirrors the spirit of core distributed.extremeLoad.test.ts but adapted for V2 backend.
 */
import { createLLMRateLimiter } from '@llm-rate-limiter/core';
import type { LLMRateLimiterInstance, ModelRateLimitConfig } from '@llm-rate-limiter/core';
import { setTimeout as sleep } from 'node:timers/promises';

import { createRedisBackend } from '../../redisBackend.js';
import type { RedisBackendInstance } from '../../types.js';
import { assertCapacityInvariant } from './redisTestHelpers.js';
import {
  checkRedisAvailable,
  cleanupTestKeys,
  createTestState,
  setupAfterAll,
  setupBeforeAll,
} from './testSetup.js';

const ZERO = 0;
const ONE = 1;
const THREE = 3;
const FIVE = 5;
const TEN = 10;
const TWENTY = 20;
const RADIX_BASE = 36;
const RANDOM_SLICE_START = 2;
const FIFTY = 50;
const HUNDRED = 100;
const TWO_HUNDRED = 200;
const SLOW_JOB_PROBABILITY = 0.2;
const FIVE_HUNDRED = 500;
const THOUSAND = 1000;

const EXTREME_TEST_TIMEOUT = 120_000;

const state = createTestState();
const backends: RedisBackendInstance[] = [];

/** Job tracker for load tests */
interface JobTracker {
  completed: number;
  failed: number;
  trackComplete: () => void;
  trackFailed: () => void;
}

const createJobTracker = (): JobTracker => {
  const tracker: JobTracker = {
    completed: ZERO,
    failed: ZERO,
    trackComplete: () => {
      tracker.completed += ONE;
    },
    trackFailed: () => {
      tracker.failed += ONE;
    },
  };
  return tracker;
};

/** Create model config */
const createModelConfig = (estimatedTokens: number): ModelRateLimitConfig => ({
  requestsPerMinute: THOUSAND,
  tokensPerMinute: THOUSAND * TEN,
  resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: estimatedTokens },
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

/** Create a test backend with unique prefix */
const createBackend = (capacity: number): RedisBackendInstance => {
  if (state.redis === undefined) {
    throw new Error('Redis not available');
  }
  const backend = createRedisBackend({
    redis: state.redis,
    totalCapacity: capacity,
    keyPrefix: state.testPrefix,
  });
  backends.push(backend);
  return backend;
};

/** Create and start a limiter */
const createAndStartLimiter = async (backend: RedisBackendInstance): Promise<LLMRateLimiterInstance> => {
  const limiter = createLLMRateLimiter({
    backend: backend.getBackendConfig(),
    models: { default: createModelConfig(TEN) },
  });
  await limiter.start();
  return limiter;
};

/** Create multiple connected limiters using reduce for sequential creation */
const createMultipleLimiters = async (
  backend: RedisBackendInstance,
  count: number
): Promise<LLMRateLimiterInstance[]> => {
  const indices = Array.from({ length: count }, (_, i) => i);
  return await indices.reduce<Promise<LLMRateLimiterInstance[]>>(async (accPromise, _) => {
    const acc = await accPromise;
    const limiter = await createAndStartLimiter(backend);
    return [...acc, limiter];
  }, Promise.resolve([]));
};

/** Random int helper */
const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + ONE)) + min;

/** Fire jobs simultaneously from all instances */
const fireSimultaneousJobs = async (
  limiters: LLMRateLimiterInstance[],
  jobsPerInstance: number,
  getDelay: () => number,
  tracker: JobTracker
): Promise<void> => {
  const allPromises: Array<Promise<void>> = [];
  for (let i = ZERO; i < limiters.length; i += ONE) {
    const { [i]: limiter } = limiters;
    if (limiter === undefined) continue;
    for (let j = ZERO; j < jobsPerInstance; j += ONE) {
      const delay = getDelay();
      const promise = limiter
        .queueJob({
          jobId: `i${i}-j${j}`,
          job: async ({ modelId }, resolve) => {
            await sleep(delay);
            resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: ZERO });
            return { requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } };
          },
        })
        .then(() => {
          tracker.trackComplete();
        })
        .catch(() => {
          tracker.trackFailed();
        });
      allPromises.push(promise);
    }
  }
  await Promise.all(allPromises);
};

/** Cleanup limiters */
const cleanupLimiters = (limiters: LLMRateLimiterInstance[]): void => {
  limiters.forEach((limiter) => {
    limiter.stop();
  });
};

/** Options for sustained pressure test */
interface SustainedPressureOptions {
  limiters: LLMRateLimiterInstance[];
  rounds: number;
  jobsPerInstance: number;
  backend: RedisBackendInstance;
  capacity: number;
  expectedTotal: number;
}

/** Run sustained pressure rounds sequentially */
const runSustainedPressureRounds = async (opts: SustainedPressureOptions): Promise<void> => {
  const { limiters, rounds, jobsPerInstance, backend, capacity, expectedTotal } = opts;
  const indices = Array.from({ length: rounds }, (_, i) => i);
  await indices.reduce<Promise<void>>(async (prevPromise, _) => {
    await prevPromise;
    const tracker = createJobTracker();
    await fireSimultaneousJobs(limiters, jobsPerInstance, () => randomInt(FIVE, TEN), tracker);
    const stats = await backend.getStats();
    assertCapacityInvariant(stats, capacity);
    expect(tracker.completed + tracker.failed).toBe(expectedTotal);
  }, Promise.resolve());
};

beforeAll(async () => {
  await setupBeforeAll(state);
});

afterAll(async () => {
  await Promise.all(
    backends.map(async (backend) => {
      await backend.stop();
    })
  );
  await setupAfterAll(state);
});

beforeEach(async () => {
  if (!state.redisAvailable || state.redis === undefined) return;
  const prefix = `test-extreme-${Date.now()}-${Math.random().toString(RADIX_BASE).slice(RANDOM_SLICE_START)}:`;
  state.testPrefix = prefix;
  await cleanupTestKeys(state.redis, prefix);
  backends.length = ZERO;
});

afterEach(async () => {
  const toStop = [...backends];
  backends.length = ZERO;
  await Promise.all(
    toStop.map(async (backend) => {
      await backend.stop();
    })
  );
  if (state.redis !== undefined) {
    await cleanupTestKeys(state.redis, state.testPrefix);
  }
});

describe('Redis extreme load - burst tests', () => {
  it(
    'NEVER exceeds capacity when 5 instances fire 50 jobs simultaneously',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const CAPACITY = FIFTY;
      const INST = FIVE;
      const JPI = FIFTY;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, INST);
      const tracker = createJobTracker();
      await fireSimultaneousJobs(limiters, JPI, () => randomInt(FIVE, TWENTY), tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, CAPACITY);
      expect(tracker.completed + tracker.failed).toBe(INST * JPI);
      expect(tracker.completed).toBeLessThanOrEqual(CAPACITY);
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
  it(
    'handles 500 jobs across 10 instances without exceeding capacity',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const CAPACITY = HUNDRED;
      const INST = TEN;
      const JPI = FIFTY;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, INST);
      const tracker = createJobTracker();
      await fireSimultaneousJobs(limiters, JPI, () => randomInt(TEN, FIFTY), tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, CAPACITY);
      expect(tracker.completed + tracker.failed).toBe(INST * JPI);
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
  it(
    'correctly handles race when capacity is limited',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const CAPACITY = TEN;
      const INST = TEN;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, INST);
      const tracker = createJobTracker();
      await fireSimultaneousJobs(limiters, ONE, () => randomInt(FIFTY, HUNDRED), tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, CAPACITY);
      expect(tracker.completed).toBeLessThanOrEqual(CAPACITY);
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('Redis extreme load - sustained tests', () => {
  it(
    'maintains capacity invariant under sustained concurrent pressure',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const CAPACITY = FIFTY;
      const INST = FIVE;
      const ROUNDS = THREE;
      const JPI = HUNDRED;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, INST);
      await runSustainedPressureRounds({
        limiters,
        rounds: ROUNDS,
        jobsPerInstance: JPI,
        backend,
        capacity: CAPACITY,
        expectedTotal: INST * JPI,
      });
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
  it(
    'never exceeds capacity with mix of fast and slow jobs',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const CAPACITY = TWENTY;
      const INST = FIVE;
      const JPI = FIFTY;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, INST);
      const tracker = createJobTracker();
      const getDelay = (): number =>
        Math.random() < SLOW_JOB_PROBABILITY ? randomInt(TWO_HUNDRED, FIVE_HUNDRED) : randomInt(FIVE, TWENTY);
      await fireSimultaneousJobs(limiters, JPI, getDelay, tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, CAPACITY);
      expect(tracker.completed + tracker.failed).toBe(INST * JPI);
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
  it(
    'ULTIMATE: 1000 jobs, 10 instances, variable durations',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const CAPACITY = FIFTY;
      const INST = TEN;
      const JPI = HUNDRED;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, INST);
      const tracker = createJobTracker();
      await fireSimultaneousJobs(limiters, JPI, () => randomInt(TEN, TWO_HUNDRED), tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, CAPACITY);
      expect(tracker.completed + tracker.failed).toBe(INST * JPI);
      expect(tracker.completed).toBeGreaterThan(ZERO);
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
});
