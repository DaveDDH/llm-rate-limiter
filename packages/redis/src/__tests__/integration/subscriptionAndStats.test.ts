/**
 * Subscription and stats integration tests for Redis distributed backend.
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';

import { createRedisBackend } from '../../redisBackend.js';
import {
  EXPECTED_INSTANCES_ONE,
  EXPECTED_IN_FLIGHT_TWO,
  FIRST_INDEX,
  LONG_DELAY_MS,
  MEDIUM_DELAY_MS,
  MIN_ALLOCATIONS_COUNT,
  REDIS_PORT,
  REQUESTS_PER_MINUTE,
  TOKENS_PER_MINUTE,
  TOTAL_CAPACITY,
  acquireCtx,
  createTestBackend,
  createTestState,
  delay,
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

/** Allocation update handler that collects allocations */
const createAllocationCollector = (): {
  allocations: AllocationInfo[];
  handler: (alloc: AllocationInfo) => void;
} => {
  const allocations: AllocationInfo[] = [];
  const handler = (alloc: AllocationInfo): void => {
    allocations.push(alloc);
  };
  return { allocations, handler };
};

describe('Redis Backend - Subscription', () => {
  it('should receive allocation updates via subscription', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend1 = createTestBackend(state, createRedisBackend);
    const backend2 = createTestBackend(state, createRedisBackend);

    try {
      const config1 = backend1.getBackendConfig();
      const config2 = backend2.getBackendConfig();

      await config1.register('instance-1');

      const collector = createAllocationCollector();
      const unsubscribe = config1.subscribe('instance-1', collector.handler);

      await delay(MEDIUM_DELAY_MS);
      await config2.register('instance-2');
      await delay(LONG_DELAY_MS);

      expect(collector.allocations.length).toBeGreaterThanOrEqual(MIN_ALLOCATIONS_COUNT);

      unsubscribe();
    } finally {
      await backend1.stop();
      await backend2.stop();
    }
  });
});

describe('Redis Backend - Stats', () => {
  it('should return correct stats', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, {
      tokensPerMinute: TOKENS_PER_MINUTE,
      requestsPerMinute: REQUESTS_PER_MINUTE,
    });

    try {
      const backendConfig = backend.getBackendConfig();

      await backendConfig.register('instance-1');
      await backendConfig.acquire(acquireCtx('instance-1'));
      await backendConfig.acquire(acquireCtx('instance-1'));

      const stats = await backend.getStats();

      expect(stats.totalInstances).toBe(EXPECTED_INSTANCES_ONE);
      expect(stats.totalInFlight).toBe(EXPECTED_IN_FLIGHT_TWO);
      expect(stats.totalAllocated).toBeLessThanOrEqual(TOTAL_CAPACITY);
      expect(stats.instances).toHaveLength(EXPECTED_INSTANCES_ONE);

      const firstInstance = stats.instances.at(FIRST_INDEX);
      expect(firstInstance?.id).toBe('instance-1');
      expect(firstInstance?.inFlight).toBe(EXPECTED_IN_FLIGHT_TWO);
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - Connection Options', () => {
  it('should work with connection options instead of client', async () => {
    if (!state.redisAvailable) return;

    const backend = createRedisBackend({
      redis: { host: 'localhost', port: REDIS_PORT },
      totalCapacity: TOTAL_CAPACITY,
      keyPrefix: state.testPrefix,
    });

    try {
      const backendConfig = backend.getBackendConfig();
      const allocation = await backendConfig.register('instance-1');

      expect(allocation.slots).toBe(TOTAL_CAPACITY);
    } finally {
      await backend.stop();
    }
  });
});
