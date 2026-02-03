/**
 * Fair distribution algorithm verification tests with real Redis backend.
 * Mirrors core fairDistribution.algorithm.test.ts but uses Redis.
 */
import type { LLMRateLimiterInstance } from '@llm-rate-limiter/core';

import { createRedisBackend } from '../../redisBackend.js';
import type { RedisBackendInstance, RedisBackendStats } from '../../types.js';
import {
  assertCapacityInvariant,
  calculateTotalFromStats,
  completeJobs,
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
const TWO = 2;
const THREE = 3;
const EIGHT = 8;
const TEN = 10;
const ELEVEN = 11;
const TWENTY = 20;
const THIRTY = 30;
const RADIX_BASE = 36;
const RANDOM_SLICE_START = 2;
const FORTY_FIVE = 45;
const FIFTY = 50;
const SEVENTY = 70;
const EIGHTY = 80;
const NINETY = 90;
const HUNDRED = 100;

const DEFAULT_TIMEOUT = 60_000;

const state = createTestState();
const backends: RedisBackendInstance[] = [];

const DEFAULT_TOKENS_PER_MINUTE = 10000;
const DEFAULT_REQUESTS_PER_MINUTE = 1000;

/** Create a test backend with unique prefix */
const createBackend = (capacity: number): RedisBackendInstance => {
  if (state.redis === undefined) {
    throw new Error('Redis not available');
  }
  const backend = createRedisBackend({
    redis: state.redis,
    totalCapacity: capacity,
    tokensPerMinute: DEFAULT_TOKENS_PER_MINUTE,
    requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE,
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
  const prefix = `test-fair-algo-${Date.now()}-${Math.random().toString(RADIX_BASE).slice(RANDOM_SLICE_START)}:`;
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

describe('Redis fair distribution - three instances even split', () => {
  it(
    'three instances split capacity evenly',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = NINETY;
      const backend = createBackend(CAPACITY);
      const limiterA = await createAndStartLimiter(backend);
      const limiterB = await createAndStartLimiter(backend);
      const limiterC = await createAndStartLimiter(backend);
      const stats = await backend.getStats();
      expect(stats.totalInstances).toBe(THREE);
      const statsA = getInstanceStats(stats, limiterA.getInstanceId());
      const statsB = getInstanceStats(stats, limiterB.getInstanceId());
      const statsC = getInstanceStats(stats, limiterC.getInstanceId());
      expect(statsA?.allocation).toBe(THIRTY);
      expect(statsB?.allocation).toBe(THIRTY);
      expect(statsC?.allocation).toBe(THIRTY);
      assertCapacityInvariant(stats, CAPACITY);
      limiterA.stop();
      limiterB.stop();
      limiterC.stop();
    },
    DEFAULT_TIMEOUT
  );
});

describe('Redis fair distribution - instance leave reallocation', () => {
  it(
    'when instance leaves, others absorb its allocation',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = NINETY;
      const backend = createBackend(CAPACITY);
      const limiterA = await createAndStartLimiter(backend);
      const limiterB = await createAndStartLimiter(backend);
      const limiterC = await createAndStartLimiter(backend);
      const statsBefore = await backend.getStats();
      expect(getInstanceStats(statsBefore, limiterA.getInstanceId())?.allocation).toBe(THIRTY);
      limiterB.stop();
      await sleep(HUNDRED);
      const statsAfter = await backend.getStats();
      expect(statsAfter.totalInstances).toBe(TWO);
      const statsA = getInstanceStats(statsAfter, limiterA.getInstanceId());
      const statsC = getInstanceStats(statsAfter, limiterC.getInstanceId());
      expect(statsA?.allocation).toBe(FORTY_FIVE);
      expect(statsC?.allocation).toBe(FORTY_FIVE);
      assertCapacityInvariant(statsAfter, CAPACITY);
      limiterA.stop();
      limiterC.stop();
    },
    DEFAULT_TIMEOUT
  );
});

/** Helper to setup and verify allocation algorithm test */
interface AllocationTestSetup {
  backend: RedisBackendInstance;
  limiters: LLMRateLimiterInstance[];
  stats: RedisBackendStats;
}

const setupAllocationAlgorithmTest = async (backend: RedisBackendInstance): Promise<AllocationTestSetup> => {
  const limiterA = await createAndStartLimiter(backend);
  await startControllableJobs(limiterA, SEVENTY);
  const limiterB = await createAndStartLimiter(backend);
  await startControllableJobs(limiterB, TEN);
  const limiterC = await createAndStartLimiter(backend);
  const stats = await backend.getStats();
  return { backend, limiters: [limiterA, limiterB, limiterC], stats };
};

const verifyAllocationAlgorithm = (setup: AllocationTestSetup, capacity: number): void => {
  const { stats, limiters } = setup;
  const [limiterA, limiterB, limiterC] = limiters;
  if (limiterA === undefined || limiterB === undefined || limiterC === undefined) {
    throw new Error('Limiters not properly initialized');
  }

  const statsA = getInstanceStats(stats, limiterA.getInstanceId());
  const statsB = getInstanceStats(stats, limiterB.getInstanceId());
  const statsC = getInstanceStats(stats, limiterC.getInstanceId());

  expect(statsA?.allocation).toBe(ZERO);
  expect(statsB?.allocation).toBe(EIGHT);
  expect(statsC?.allocation).toBe(ELEVEN);

  const total = calculateTotalFromStats(stats.instances);
  expect(total).toBeLessThanOrEqual(capacity);
  assertCapacityInvariant(stats, capacity);
};

const cleanupLimiters = (limiters: LLMRateLimiterInstance[]): void => {
  limiters.forEach((limiter) => {
    limiter.stop();
  });
};

describe('Redis fair distribution - algorithm exact', () => {
  it(
    'allocations exactly match fair distribution algorithm',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;

      const CAPACITY = HUNDRED;
      const backend = createBackend(CAPACITY);
      const setup = await setupAllocationAlgorithmTest(backend);
      verifyAllocationAlgorithm(setup, CAPACITY);
      cleanupLimiters(setup.limiters);
    },
    DEFAULT_TIMEOUT
  );
});

describe('Redis fair distribution - saturation', () => {
  it(
    'handles uneven distribution when some instances are saturated',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;

      const CAPACITY = HUNDRED;
      const backend = createBackend(CAPACITY);
      const limiterA = await createAndStartLimiter(backend);
      const jobsA = await startControllableJobs(limiterA, EIGHTY);
      await sleep(FIFTY);

      const statsBefore = await backend.getStats();
      const statsABefore = getInstanceStats(statsBefore, limiterA.getInstanceId());
      expect(statsABefore?.inFlight).toBe(EIGHTY);
      expect(statsABefore?.allocation).toBe(TWENTY);

      const limiterB = await createAndStartLimiter(backend);
      const statsAfter = await backend.getStats();
      const statsA = getInstanceStats(statsAfter, limiterA.getInstanceId());
      const statsB = getInstanceStats(statsAfter, limiterB.getInstanceId());

      expect(statsA?.inFlight).toBe(EIGHTY);
      expect(statsA?.allocation).toBe(ZERO);
      expect(statsB?.inFlight).toBe(ZERO);
      expect(statsB?.allocation).toBe(TWENTY);
      assertCapacityInvariant(statsAfter, CAPACITY);

      await completeJobs(jobsA);
      limiterA.stop();
      limiterB.stop();
    },
    DEFAULT_TIMEOUT
  );
});
