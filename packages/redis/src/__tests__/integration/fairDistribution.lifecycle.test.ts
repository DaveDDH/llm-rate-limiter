/**
 * Fair distribution instance lifecycle tests with real Redis backend.
 * Mirrors core fairDistribution.lifecycle.test.ts but uses Redis.
 */
import type { LLMRateLimiterInstance } from '@llm-rate-limiter/core';

import { createRedisBackend } from '../../redisBackend.js';
import type { RedisBackendInstance } from '../../types.js';
import {
  assertCapacityInvariant,
  createAndStartLimiter,
  getInstanceStats,
  sleep,
  startControllableJobs,
} from './redisTestHelpers.js';
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
const THIRTY = 30;
const THIRTY_THREE = 33;
const RADIX_BASE = 36;
const RANDOM_SLICE_START = 2;
const SIXTY = 60;
const HUNDRED = 100;
const JOIN_PROBABILITY = 0.6;

const DEFAULT_TIMEOUT = 90_000;

const state = createTestState();
const backends: RedisBackendInstance[] = [];

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
  const prefix = `test-fair-life-${Date.now()}-${Math.random().toString(RADIX_BASE).slice(RANDOM_SLICE_START)}:`;
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

/** Handle a single iteration of the rapid join/leave test */
const handleRapidChurnIteration = async (
  backend: RedisBackendInstance,
  activeLimiters: LLMRateLimiterInstance[]
): Promise<void> => {
  const shouldJoin = Math.random() < JOIN_PROBABILITY || activeLimiters.length === ZERO;

  if (shouldJoin) {
    const limiter = await createAndStartLimiter(backend);
    activeLimiters.push(limiter);
    await startControllableJobs(limiter, THREE);
    return;
  }

  const idx = Math.floor(Math.random() * activeLimiters.length);
  const { [idx]: limiterToStop } = activeLimiters;
  if (limiterToStop !== undefined) {
    limiterToStop.stop();
    activeLimiters.splice(idx, ONE);
    await sleep(HUNDRED);
  }
};

/** Run rapid churn iterations sequentially */
const runRapidChurnIterations = async (
  backend: RedisBackendInstance,
  activeLimiters: LLMRateLimiterInstance[],
  iterations: number,
  capacity: number
): Promise<void> => {
  const indices = Array.from({ length: iterations }, (_, i) => i);
  await indices.reduce<Promise<void>>(async (prevPromise, _) => {
    await prevPromise;
    await handleRapidChurnIteration(backend, activeLimiters);
    const stats = await backend.getStats();
    assertCapacityInvariant(stats, capacity);
  }, Promise.resolve());
};

describe('Redis fair distribution - instance lifecycle churn', () => {
  it(
    'handles rapid instance join/leave without violating capacity',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = SIXTY;
      const backend = createBackend(CAPACITY);
      const activeLimiters: LLMRateLimiterInstance[] = [];
      await runRapidChurnIterations(backend, activeLimiters, THIRTY, CAPACITY);
      activeLimiters.forEach((limiter) => {
        limiter.stop();
      });
    },
    DEFAULT_TIMEOUT
  );
});

describe('Redis fair distribution - instance lifecycle rejoin', () => {
  it(
    'handles all instances leaving and rejoining',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = HUNDRED;
      const backend = createBackend(CAPACITY);
      const limiterA1 = await createAndStartLimiter(backend);
      const limiterB1 = await createAndStartLimiter(backend);
      const statsInitial = await backend.getStats();
      expect(statsInitial.totalInstances).toBe(TWO);
      assertCapacityInvariant(statsInitial, CAPACITY);
      limiterA1.stop();
      limiterB1.stop();
      await sleep(HUNDRED);
      const statsEmpty = await backend.getStats();
      expect(statsEmpty.totalInstances).toBe(ZERO);
      const limiterA2 = await createAndStartLimiter(backend);
      const limiterB2 = await createAndStartLimiter(backend);
      const limiterC2 = await createAndStartLimiter(backend);
      const statsRejoin = await backend.getStats();
      expect(statsRejoin.totalInstances).toBe(THREE);
      expect(getInstanceStats(statsRejoin, limiterA2.getInstanceId())?.allocation).toBe(THIRTY_THREE);
      assertCapacityInvariant(statsRejoin, CAPACITY);
      limiterA2.stop();
      limiterB2.stop();
      limiterC2.stop();
    },
    DEFAULT_TIMEOUT
  );
});
