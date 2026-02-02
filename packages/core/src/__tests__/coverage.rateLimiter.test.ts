/**
 * Coverage tests for rateLimiter module.
 */
import { jest } from '@jest/globals';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createInternalLimiter } from '../rateLimiter.js';
import {
  DELAY_SHORT,
  FIFTY,
  HUNDRED,
  ONE,
  RATIO_HALF,
  RATIO_LOW,
  RATIO_TENTH,
  TEN,
  THOUSAND,
  ZERO,
} from './coverage.helpers.js';

describe('rateLimiter - memory initialization', () => {
  it('should initialize memory limiter with min/max clamping and check capacity', async () => {
    const limiter = createInternalLimiter({
      memory: { freeMemoryRatio: RATIO_TENTH, recalculationIntervalMs: FIFTY },
      minCapacity: HUNDRED,
      maxCapacity: HUNDRED * TEN,
      resourcesPerEvent: { estimatedUsedMemoryKB: TEN },
    });
    expect(limiter.getStats().memory?.maxCapacityKB).toBeGreaterThanOrEqual(HUNDRED);
    await setTimeoutAsync(FIFTY + TEN);
    limiter.stop();
    const limiter2 = createInternalLimiter({
      memory: { freeMemoryRatio: RATIO_LOW },
      maxCapacity: ONE,
      resourcesPerEvent: { estimatedUsedMemoryKB: HUNDRED },
    });
    expect(limiter2.hasCapacity()).toBe(false);
    limiter2.stop();
  });
});

describe('rateLimiter - memory acquire/release', () => {
  it('should acquire and release memory during job execution', async () => {
    const limiter = createInternalLimiter({
      memory: { freeMemoryRatio: RATIO_HALF },
      maxCapacity: HUNDRED * TEN,
      resourcesPerEvent: { estimatedUsedMemoryKB: TEN },
    });
    const result = await limiter.queueJob(async () => {
      await setTimeoutAsync(DELAY_SHORT);
      return { requestCount: ONE, usage: { input: FIFTY, output: TEN, cached: ZERO } };
    });
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });

  it('should stop memory recalculation interval on stop()', () => {
    const limiter = createInternalLimiter({
      memory: { freeMemoryRatio: RATIO_HALF, recalculationIntervalMs: TEN },
      resourcesPerEvent: { estimatedUsedMemoryKB: ONE },
    });
    limiter.stop();
    limiter.stop();
  });
});

describe('rateLimiter - refunds and capacity', () => {
  it('should refund request and token differences', async () => {
    const limiter1 = createInternalLimiter({
      requestsPerMinute: TEN,
      resourcesPerEvent: { estimatedNumberOfRequests: TEN },
    });
    await limiter1.queueJob(() => ({
      requestCount: ONE,
      usage: { input: ZERO, output: ZERO, cached: ZERO },
    }));
    expect(limiter1.getStats().requestsPerMinute?.current).toBe(ONE);
    limiter1.stop();
    const limiter2 = createInternalLimiter({
      tokensPerMinute: THOUSAND,
      resourcesPerEvent: { estimatedUsedTokens: HUNDRED },
    });
    await limiter2.queueJob(() => ({ requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } }));
    expect(limiter2.getStats().tokensPerMinute?.current).toBeLessThan(HUNDRED);
    limiter2.stop();
  });

  it('should exhaust capacity', async () => {
    const limiter = createInternalLimiter({
      requestsPerMinute: ONE,
      resourcesPerEvent: { estimatedNumberOfRequests: ONE },
    });
    await limiter.queueJob(() => ({ requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } }));
    expect(limiter.hasCapacity()).toBe(false);
    limiter.stop();
  });
});

describe('rateLimiter - capacity waiting with fake timers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should wait for capacity when exhausted and queue second job', async () => {
    const limiter = createInternalLimiter({
      requestsPerMinute: ONE,
      resourcesPerEvent: { estimatedNumberOfRequests: ONE },
    });
    await limiter.queueJob(() => ({ requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } }));
    const secondJob = limiter.queueJob(() => ({
      requestCount: ONE,
      usage: { input: ZERO, output: ZERO, cached: ZERO },
    }));
    jest.advanceTimersByTime(HUNDRED);
    await jest.advanceTimersByTimeAsync(HUNDRED * HUNDRED * TEN);
    const result = await secondJob;
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});

describe('rateLimiter - stats with all limiters', () => {
  it('should get stats with all configured limiters', () => {
    const limiter = createInternalLimiter({
      requestsPerMinute: HUNDRED,
      requestsPerDay: HUNDRED * TEN,
      tokensPerMinute: HUNDRED * TEN,
      tokensPerDay: HUNDRED * HUNDRED,
      maxConcurrentRequests: TEN,
      memory: { freeMemoryRatio: RATIO_HALF },
      resourcesPerEvent: {
        estimatedNumberOfRequests: ONE,
        estimatedUsedTokens: TEN,
        estimatedUsedMemoryKB: ONE,
      },
    });
    const stats = limiter.getStats();
    expect(stats.requestsPerMinute).toBeDefined();
    expect(stats.requestsPerDay).toBeDefined();
    expect(stats.tokensPerMinute).toBeDefined();
    expect(stats.tokensPerDay).toBeDefined();
    expect(stats.concurrency).toBeDefined();
    expect(stats.memory).toBeDefined();
    limiter.stop();
  });
});
