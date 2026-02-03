/**
 * Basic fair distribution tests with real Redis backend.
 * Mirrors core fairDistribution.basic.test.ts but uses Redis.
 */
import { createRedisBackend } from '../../redisBackend.js';
import type { RedisBackendInstance } from '../../types.js';
import {
  assertCapacityInvariant,
  completeJobs,
  createAndStartLimiter,
  getInstanceStats,
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
const TEN = 10;
const TWENTY = 20;
const RADIX_BASE = 36;
const RANDOM_SLICE_START = 2;
const FORTY = 40;
const FIFTY = 50;
const EIGHTY = 80;
const HUNDRED = 100;

const DEFAULT_TIMEOUT = 60_000;

const state = createTestState();
const backends: RedisBackendInstance[] = [];

/** Create a test backend with unique prefix */
const DEFAULT_TOKENS_PER_MINUTE = 10000;
const DEFAULT_REQUESTS_PER_MINUTE = 1000;

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
  const prefix = `test-fair-basic-${Date.now()}-${Math.random().toString(RADIX_BASE).slice(RANDOM_SLICE_START)}:`;
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

describe('Redis fair distribution - single instance', () => {
  it(
    'single instance receives full capacity',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;

      const CAPACITY = HUNDRED;
      const backend = createBackend(CAPACITY);
      const limiter = await createAndStartLimiter(backend);

      const stats = await backend.getStats();
      expect(stats.totalInstances).toBe(ONE);
      expect(stats.totalAllocated).toBe(CAPACITY);
      assertCapacityInvariant(stats, CAPACITY);

      limiter.stop();
    },
    DEFAULT_TIMEOUT
  );

  it(
    'single instance can use all capacity',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;

      const CAPACITY = TEN;
      const backend = createBackend(CAPACITY);
      const limiter = await createAndStartLimiter(backend);

      const jobs = await startControllableJobs(limiter, CAPACITY);

      const statsAfterAcquire = await backend.getStats();
      expect(statsAfterAcquire.totalInFlight).toBe(CAPACITY);
      expect(statsAfterAcquire.totalAllocated).toBe(ZERO);
      assertCapacityInvariant(statsAfterAcquire, CAPACITY);

      await completeJobs(jobs);

      const statsAfterRelease = await backend.getStats();
      expect(statsAfterRelease.totalInFlight).toBe(ZERO);
      expect(statsAfterRelease.totalAllocated).toBe(CAPACITY);
      assertCapacityInvariant(statsAfterRelease, CAPACITY);

      limiter.stop();
    },
    DEFAULT_TIMEOUT
  );
});

describe('Redis fair distribution - two instances split', () => {
  it(
    'two instances split capacity 50/50',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = HUNDRED;
      const backend = createBackend(CAPACITY);
      const limiterA = await createAndStartLimiter(backend);
      const limiterB = await createAndStartLimiter(backend);
      const stats = await backend.getStats();
      expect(stats.totalInstances).toBe(TWO);
      expect(stats.totalAllocated).toBe(CAPACITY);
      const statsA = getInstanceStats(stats, limiterA.getInstanceId());
      const statsB = getInstanceStats(stats, limiterB.getInstanceId());
      expect(statsA?.allocation).toBe(FIFTY);
      expect(statsB?.allocation).toBe(FIFTY);
      assertCapacityInvariant(stats, CAPACITY);
      limiterA.stop();
      limiterB.stop();
    },
    DEFAULT_TIMEOUT
  );
});

describe('Redis fair distribution - late joiner', () => {
  it(
    'late joiner gets remaining capacity while busy instance drains',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = HUNDRED;
      const backend = createBackend(CAPACITY);
      const limiterA = await createAndStartLimiter(backend);
      const jobsA = await startControllableJobs(limiterA, EIGHTY);
      const statsBeforeB = await backend.getStats();
      const statsABeforeB = getInstanceStats(statsBeforeB, limiterA.getInstanceId());
      expect(statsABeforeB?.inFlight).toBe(EIGHTY);
      expect(statsABeforeB?.allocation).toBe(TWENTY);
      assertCapacityInvariant(statsBeforeB, CAPACITY);
      const limiterB = await createAndStartLimiter(backend);
      const statsAfterB = await backend.getStats();
      const statsA = getInstanceStats(statsAfterB, limiterA.getInstanceId());
      const statsB = getInstanceStats(statsAfterB, limiterB.getInstanceId());
      expect(statsA?.allocation).toBe(ZERO);
      expect(statsB?.allocation).toBe(TWENTY);
      assertCapacityInvariant(statsAfterB, CAPACITY);
      await completeJobs(jobsA.slice(ZERO, FORTY));
      const statsAfterDrain = await backend.getStats();
      const statsAAfter = getInstanceStats(statsAfterDrain, limiterA.getInstanceId());
      const statsBAfter = getInstanceStats(statsAfterDrain, limiterB.getInstanceId());
      expect(statsAAfter?.inFlight).toBe(FORTY);
      expect(statsAAfter?.allocation).toBe(TEN);
      expect(statsBAfter?.allocation).toBe(FIFTY);
      assertCapacityInvariant(statsAfterDrain, CAPACITY);
      await completeJobs(jobsA.slice(FORTY));
      limiterA.stop();
      limiterB.stop();
    },
    DEFAULT_TIMEOUT
  );
});
