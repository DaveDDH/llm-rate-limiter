/**
 * Realistic load tests for Redis distributed backend.
 * Simulates real-world conditions with network latency and slow LLM jobs.
 * Mirrors core distributed.realisticLoad.test.ts but uses real Redis.
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
const TWO = 2;
const THREE = 3;
const FIVE = 5;
const TEN = 10;
const TWENTY = 20;
const THIRTY = 30;
const RADIX_BASE = 36;
const RANDOM_SLICE_START = 2;
const FIFTY = 50;
const HUNDRED = 100;
const TWO_HUNDRED = 200;
const THREE_HUNDRED = 300;
const SLOW_JOB_PROBABILITY = 0.3;
const FIVE_HUNDRED = 500;
const THOUSAND = 1000;

const REALISTIC_TEST_TIMEOUT = 180_000;

const state = createTestState();
const backends: RedisBackendInstance[] = [];

/** Test tracker for latency stats */
interface TestTracker {
  completed: number;
  failed: number;
  jobDurations: number[];
  trackComplete: () => void;
  trackFailed: () => void;
  trackJobDuration: (ms: number) => void;
}

const createTestTracker = (): TestTracker => {
  const tracker: TestTracker = {
    completed: ZERO,
    failed: ZERO,
    jobDurations: [],
    trackComplete: () => {
      tracker.completed += ONE;
    },
    trackFailed: () => {
      tracker.failed += ONE;
    },
    trackJobDuration: (ms) => {
      tracker.jobDurations.push(ms);
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

/** Random int helper */
const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + ONE)) + min;

/** Calculate average of numbers */
const calculateAverage = (arr: number[]): number => {
  if (arr.length === ZERO) return ZERO;
  let sum = ZERO;
  for (const val of arr) {
    sum += val;
  }
  return Math.round(sum / arr.length);
};

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

/** Job config for slow jobs */
interface SlowJobConfig {
  minDurationMs: number;
  maxDurationMs: number;
}

/** Fire slow jobs to simulate LLM calls */
const fireSlowJobs = async (
  limiters: LLMRateLimiterInstance[],
  jobsPerInstance: number,
  jobConfig: SlowJobConfig,
  tracker: TestTracker
): Promise<void> => {
  const allPromises: Array<Promise<void>> = [];
  for (let i = ZERO; i < limiters.length; i += ONE) {
    const { [i]: limiter } = limiters;
    if (limiter === undefined) continue;
    for (let j = ZERO; j < jobsPerInstance; j += ONE) {
      const promise = limiter
        .queueJob({
          jobId: `i${i}-j${j}`,
          job: async ({ modelId }, resolve) => {
            const duration = randomInt(jobConfig.minDurationMs, jobConfig.maxDurationMs);
            tracker.trackJobDuration(duration);
            await sleep(duration);
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
  const prefix = `test-realistic-${Date.now()}-${Math.random().toString(RADIX_BASE).slice(RANDOM_SLICE_START)}:`;
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

describe('Redis realistic load - basic latency', () => {
  it(
    'maintains capacity with 50-200ms jobs simulating fast LLM calls',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = TWENTY;
      const INST = THREE;
      const JPI = THIRTY;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, INST);
      const tracker = createTestTracker();
      await fireSlowJobs(limiters, JPI, { minDurationMs: FIFTY, maxDurationMs: TWO_HUNDRED }, tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, CAPACITY);
      expect(tracker.completed + tracker.failed).toBe(INST * JPI);
      expect(tracker.jobDurations.length).toBeGreaterThan(ZERO);
      cleanupLimiters(limiters);
    },
    REALISTIC_TEST_TIMEOUT
  );

  it(
    'maintains correctness with very slow jobs (500-1000ms)',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = TEN;
      const INST = TWO;
      const JPI = FIVE;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, INST);
      const tracker = createTestTracker();
      await fireSlowJobs(limiters, JPI, { minDurationMs: FIVE_HUNDRED, maxDurationMs: THOUSAND }, tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, CAPACITY);
      expect(tracker.completed + tracker.failed).toBe(INST * JPI);
      expect(calculateAverage(tracker.jobDurations)).toBeGreaterThanOrEqual(FIVE_HUNDRED);
      cleanupLimiters(limiters);
    },
    REALISTIC_TEST_TIMEOUT
  );
});

/** Queue mixed jobs for all limiters */
const queueMixedJobs = (
  limiters: LLMRateLimiterInstance[],
  jobsPerInstance: number,
  tracker: TestTracker
): Array<Promise<void>> => {
  const allPromises: Array<Promise<void>> = [];
  for (let i = ZERO; i < limiters.length; i += ONE) {
    const { [i]: limiter } = limiters;
    if (limiter === undefined) continue;
    for (let j = ZERO; j < jobsPerInstance; j += ONE) {
      const isSlow = Math.random() < SLOW_JOB_PROBABILITY;
      const minMs = isSlow ? TWO_HUNDRED : TEN;
      const maxMs = isSlow ? FIVE_HUNDRED : FIFTY;
      const promise = limiter
        .queueJob({
          jobId: `i${i}-j${j}`,
          job: async ({ modelId }, resolve) => {
            const duration = randomInt(minMs, maxMs);
            tracker.trackJobDuration(duration);
            await sleep(duration);
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
  return allPromises;
};

describe('Redis realistic load - mixed jobs', () => {
  it(
    'handles mixed fast and slow jobs',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = TWENTY;
      const INST = THREE;
      const JPI = TWENTY;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, INST);
      const tracker = createTestTracker();
      const allPromises = queueMixedJobs(limiters, JPI, tracker);
      await Promise.all(allPromises);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, CAPACITY);
      expect(tracker.completed + tracker.failed).toBe(INST * JPI);
      cleanupLimiters(limiters);
    },
    REALISTIC_TEST_TIMEOUT
  );
});

describe('Redis realistic load - sustained pressure', () => {
  it(
    'maintains capacity under sustained slow job pressure',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = THIRTY;
      const INST = FIVE;
      const JPI = FIFTY;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, INST);
      const tracker = createTestTracker();
      await fireSlowJobs(limiters, JPI, { minDurationMs: HUNDRED, maxDurationMs: THREE_HUNDRED }, tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, CAPACITY);
      expect(tracker.completed + tracker.failed).toBe(INST * JPI);
      expect(tracker.completed).toBeGreaterThan(ZERO);
      cleanupLimiters(limiters);
    },
    REALISTIC_TEST_TIMEOUT
  );

  it(
    'tracks job duration statistics accurately',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = TEN;
      const INST = TWO;
      const JPI = TEN;
      const MIN_DURATION = HUNDRED;
      const MAX_DURATION = TWO_HUNDRED;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, INST);
      const tracker = createTestTracker();
      await fireSlowJobs(
        limiters,
        JPI,
        { minDurationMs: MIN_DURATION, maxDurationMs: MAX_DURATION },
        tracker
      );
      const avgDuration = calculateAverage(tracker.jobDurations);
      expect(avgDuration).toBeGreaterThanOrEqual(MIN_DURATION);
      expect(avgDuration).toBeLessThanOrEqual(MAX_DURATION);
      cleanupLimiters(limiters);
    },
    REALISTIC_TEST_TIMEOUT
  );
});
