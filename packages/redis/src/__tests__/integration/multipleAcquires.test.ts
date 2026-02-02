/**
 * Multiple acquires and releases integration tests for Redis distributed backend.
 */
import { createRedisBackend } from '../../redisBackend.js';
import {
  SHORT_DELAY_MS,
  SMALL_CAPACITY_FIVE,
  SMALL_CAPACITY_TEN,
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

/** Helper to acquire a slot and return result */
const acquireSlot = async (backendConfig: {
  acquire: (ctx: ReturnType<typeof acquireCtx>) => Promise<boolean>;
}): Promise<boolean> => {
  const result = await backendConfig.acquire(acquireCtx('instance-1'));
  return result;
};

describe('Redis Backend - Concurrent Acquires', () => {
  it('should handle multiple concurrent acquires', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, { capacity: SMALL_CAPACITY_TEN });

    try {
      const backendConfig = backend.getBackendConfig();
      await backendConfig.register('instance-1');

      const acquirePromises = Array.from({ length: SMALL_CAPACITY_TEN }, async () => {
        const result = await acquireSlot(backendConfig);
        return result;
      });

      const results = await Promise.all(acquirePromises);
      const { length: successCount } = results.filter(Boolean);

      expect(successCount).toBe(SMALL_CAPACITY_TEN);

      const extraAcquire = await backendConfig.acquire(acquireCtx('instance-1'));
      expect(extraAcquire).toBe(false);
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - Slot Restoration', () => {
  it('should restore slots after release', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, { capacity: SMALL_CAPACITY_FIVE });

    try {
      const backendConfig = backend.getBackendConfig();
      await backendConfig.register('instance-1');

      await backendConfig.acquire(acquireCtx('instance-1'));
      await backendConfig.acquire(acquireCtx('instance-1'));
      await backendConfig.acquire(acquireCtx('instance-1'));
      await backendConfig.acquire(acquireCtx('instance-1'));
      await backendConfig.acquire(acquireCtx('instance-1'));

      expect(await backendConfig.acquire(acquireCtx('instance-1'))).toBe(false);

      await backendConfig.release(releaseCtx('instance-1'));
      await delay(SHORT_DELAY_MS);

      expect(await backendConfig.acquire(acquireCtx('instance-1'))).toBe(true);
    } finally {
      await backend.stop();
    }
  });
});
