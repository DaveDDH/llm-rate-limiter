/**
 * Fair distribution integration tests for Redis distributed backend.
 */
import { createRedisBackend } from '../../redisBackend.js';
import {
  createTestBackend,
  createTestState,
  delay,
  EXPECTED_INSTANCES_ONE,
  EXPECTED_INSTANCES_TWO,
  HALF_CAPACITY,
  setupAfterAll,
  setupAfterEach,
  setupBeforeAll,
  setupBeforeEach,
  SHORT_DELAY_MS,
  TOTAL_CAPACITY,
} from './testSetup.js';

const state = createTestState();

beforeAll(async () => { await setupBeforeAll(state); });
afterAll(async () => { await setupAfterAll(state); });
beforeEach(async () => { await setupBeforeEach(state); });
afterEach(async () => { await setupAfterEach(state); });

describe('Redis Backend - Fair Distribution Between Instances', () => {
  it('should distribute slots fairly between two instances', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend1 = createTestBackend(state, createRedisBackend);
    const backend2 = createTestBackend(state, createRedisBackend);

    try {
      const config1 = backend1.getBackendConfig();
      const config2 = backend2.getBackendConfig();

      const alloc1 = await config1.register('instance-1');
      expect(alloc1.slots).toBe(TOTAL_CAPACITY);

      const alloc2 = await config2.register('instance-2');
      expect(alloc2.slots).toBe(HALF_CAPACITY);

      const stats = await backend1.getStats();
      expect(stats.totalInstances).toBe(EXPECTED_INSTANCES_TWO);
      expect(stats.totalAllocated).toBe(TOTAL_CAPACITY);
    } finally {
      await backend1.stop();
      await backend2.stop();
    }
  });
});

describe('Redis Backend - Slot Redistribution', () => {
  it('should redistribute slots when an instance unregisters', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend1 = createTestBackend(state, createRedisBackend);
    const backend2 = createTestBackend(state, createRedisBackend);

    try {
      const config1 = backend1.getBackendConfig();
      const config2 = backend2.getBackendConfig();

      await config1.register('instance-1');
      await config2.register('instance-2');
      await config2.unregister('instance-2');

      await delay(SHORT_DELAY_MS);

      const stats = await backend1.getStats();
      expect(stats.totalInstances).toBe(EXPECTED_INSTANCES_ONE);
      expect(stats.totalAllocated).toBe(TOTAL_CAPACITY);
    } finally {
      await backend1.stop();
      await backend2.stop();
    }
  });
});
