/**
 * Redis extreme load tests - burst and sustained pressure scenarios.
 * Tests capacity invariants under high concurrent load.
 */
import {
  BackendManager,
  cleanupLimiters,
  createJobTracker,
  createMultipleLimiters,
  fireJobsWithDelay,
  randomInt,
  runSustainedPressureRounds,
} from './loadTestHelpers.js';
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
const FIFTY = 50;
const HUNDRED = 100;
const TWO_HUNDRED = 200;
const FIVE_HUNDRED = 500;
const RADIX_BASE = 36;
const RANDOM_SLICE_START = 2;
const SLOW_JOB_PROBABILITY = 0.2;
const EXTREME_TEST_TIMEOUT = 120_000;

const state = createTestState();
const backendManager = new BackendManager(state);

beforeAll(async () => {
  await setupBeforeAll(state);
});

afterAll(async () => {
  await backendManager.stopAll();
  await setupAfterAll(state);
});

beforeEach(async () => {
  if (!state.redisAvailable || state.redis === undefined) return;
  state.testPrefix = `test-extreme-${Date.now()}-${Math.random().toString(RADIX_BASE).slice(RANDOM_SLICE_START)}:`;
  await cleanupTestKeys(state.redis, state.testPrefix);
  backendManager.clear();
});

afterEach(async () => {
  await backendManager.stopAll();
  if (state.redis !== undefined) {
    await cleanupTestKeys(state.redis, state.testPrefix);
  }
});

describe('Redis extreme load - burst 1', () => {
  it(
    'NEVER exceeds capacity when 5 instances fire 50 jobs simultaneously',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const backend = backendManager.createBackend(FIFTY);
      const limiters = await createMultipleLimiters(backend, FIVE);
      const tracker = createJobTracker();
      await fireJobsWithDelay(limiters, FIFTY, () => randomInt(FIVE, TWENTY), tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, FIFTY);
      expect(tracker.completed + tracker.failed).toBe(FIVE * FIFTY);
      expect(tracker.completed).toBeLessThanOrEqual(FIFTY);
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('Redis extreme load - burst 2', () => {
  it(
    'handles 500 jobs across 10 instances without exceeding capacity',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const backend = backendManager.createBackend(HUNDRED);
      const limiters = await createMultipleLimiters(backend, TEN);
      const tracker = createJobTracker();
      await fireJobsWithDelay(limiters, FIFTY, () => randomInt(TEN, FIFTY), tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, HUNDRED);
      expect(tracker.completed + tracker.failed).toBe(TEN * FIFTY);
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('Redis extreme load - burst 3', () => {
  it(
    'correctly handles race when capacity is limited',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const backend = backendManager.createBackend(TEN);
      const limiters = await createMultipleLimiters(backend, TEN);
      const tracker = createJobTracker();
      await fireJobsWithDelay(limiters, ONE, () => randomInt(FIFTY, HUNDRED), tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, TEN);
      expect(tracker.completed).toBeLessThanOrEqual(TEN);
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('Redis extreme load - sustained 1', () => {
  it(
    'maintains capacity invariant under sustained concurrent pressure',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const backend = backendManager.createBackend(FIFTY);
      const limiters = await createMultipleLimiters(backend, FIVE);
      await runSustainedPressureRounds({
        limiters,
        rounds: THREE,
        jobsPerInstance: HUNDRED,
        backend,
        capacity: FIFTY,
        expectedTotal: FIVE * HUNDRED,
      });
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('Redis extreme load - sustained 2', () => {
  it(
    'never exceeds capacity with mix of fast and slow jobs',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const backend = backendManager.createBackend(TWENTY);
      const limiters = await createMultipleLimiters(backend, FIVE);
      const tracker = createJobTracker();
      const getDelay = (): number =>
        Math.random() < SLOW_JOB_PROBABILITY ? randomInt(TWO_HUNDRED, FIVE_HUNDRED) : randomInt(FIVE, TWENTY);
      await fireJobsWithDelay(limiters, FIFTY, getDelay, tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, TWENTY);
      expect(tracker.completed + tracker.failed).toBe(FIVE * FIFTY);
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('Redis extreme load - sustained 3', () => {
  it(
    'ULTIMATE: 1000 jobs, 10 instances, variable durations',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const backend = backendManager.createBackend(FIFTY);
      const limiters = await createMultipleLimiters(backend, TEN);
      const tracker = createJobTracker();
      await fireJobsWithDelay(limiters, HUNDRED, () => randomInt(TEN, TWO_HUNDRED), tracker);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, FIFTY);
      expect(tracker.completed + tracker.failed).toBe(TEN * HUNDRED);
      expect(tracker.completed).toBeGreaterThan(ZERO);
      cleanupLimiters(limiters);
    },
    EXTREME_TEST_TIMEOUT
  );
});
