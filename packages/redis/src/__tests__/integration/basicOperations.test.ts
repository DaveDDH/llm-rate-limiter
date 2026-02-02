/**
 * Basic operations integration tests for Redis distributed backend.
 */
import { createRedisBackend } from '../../redisBackend.js';
import {
  EXPECTED_IN_FLIGHT_ONE,
  EXPECTED_IN_FLIGHT_ZERO,
  REQUESTS_PER_MINUTE,
  SHORT_DELAY_MS,
  SMALL_CAPACITY,
  TOKENS_PER_MINUTE,
  TOTAL_CAPACITY,
  acquireCtx,
  createTestBackend,
  createTestState,
  delay,
  releaseCtx,
  setupAfterAll,
  setupAfterEach,
  setupBeforeAll,
  setupBeforeEach,
} from './testSetup.js';

const state = createTestState();

beforeAll(async () => {
  await setupBeforeAll(state);
});
afterAll(async () => {
  await setupAfterAll(state);
});
beforeEach(async () => {
  await setupBeforeEach(state);
});
afterEach(async () => {
  await setupAfterEach(state);
});

describe('Redis Backend - Register', () => {
  it('should register an instance and get allocation', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, {
      tokensPerMinute: TOKENS_PER_MINUTE,
      requestsPerMinute: REQUESTS_PER_MINUTE,
    });

    try {
      const backendConfig = backend.getBackendConfig();
      const allocation = await backendConfig.register('instance-1');

      expect(allocation.slots).toBe(TOTAL_CAPACITY);
      expect(allocation.tokensPerMinute).toBe(TOKENS_PER_MINUTE);
      expect(allocation.requestsPerMinute).toBe(REQUESTS_PER_MINUTE);
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - Unregister', () => {
  it('should unregister an instance', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend);

    try {
      const backendConfig = backend.getBackendConfig();
      await backendConfig.register('instance-1');
      await backendConfig.unregister('instance-1');

      const stats = await backend.getStats();
      expect(stats.totalInstances).toBe(EXPECTED_IN_FLIGHT_ZERO);
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - Acquire and Release', () => {
  it('should acquire and release slots', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend);

    try {
      const backendConfig = backend.getBackendConfig();
      await backendConfig.register('instance-1');

      const acquired = await backendConfig.acquire(acquireCtx('instance-1'));
      expect(acquired).toBe(true);

      let stats = await backend.getStats();
      expect(stats.totalInFlight).toBe(EXPECTED_IN_FLIGHT_ONE);

      await backendConfig.release(releaseCtx('instance-1'));
      await delay(SHORT_DELAY_MS);

      stats = await backend.getStats();
      expect(stats.totalInFlight).toBe(EXPECTED_IN_FLIGHT_ZERO);
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - Capacity Limits', () => {
  it('should fail to acquire when no slots available', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, { capacity: SMALL_CAPACITY });

    try {
      const backendConfig = backend.getBackendConfig();
      await backendConfig.register('instance-1');

      expect(await backendConfig.acquire(acquireCtx('instance-1'))).toBe(true);
      expect(await backendConfig.acquire(acquireCtx('instance-1'))).toBe(true);
      expect(await backendConfig.acquire(acquireCtx('instance-1'))).toBe(false);
    } finally {
      await backend.stop();
    }
  });
});
