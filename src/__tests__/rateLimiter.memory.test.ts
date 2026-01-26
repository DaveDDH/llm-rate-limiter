import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../rateLimiter.js';

import type { LLMJobResult } from '../types.js';

const MOCK_INPUT_TOKENS = 100;
const MOCK_OUTPUT_TOKENS = 50;
const ZERO_CACHED_TOKENS = 0;
const DEFAULT_REQUEST_COUNT = 1;
const ESTIMATED_MEMORY_KB = 10240;
const FREE_MEMORY_RATIO = 0.8;
const LOW_RATIO = 0.1;
const HIGH_RATIO = 0.9;
const ZERO = 0;
const TWO = 2;
const DELAY_MS_SHORT = 10;
const DELAY_MS_MEDIUM = 50;
const DELAY_MS_LONG = 200;
const EXTRA_WAIT_MS = 20;

const createMockJobResult = (text: string): LLMJobResult => ({
  text,
  requestCount: DEFAULT_REQUEST_COUNT,
  usage: {
    input: MOCK_INPUT_TOKENS,
    output: MOCK_OUTPUT_TOKENS,
    cached: ZERO_CACHED_TOKENS,
  },
});

describe('LLMRateLimiter - memory minCapacity', () => {
  it('should respect minCapacity', () => {
    const MIN_CAPACITY = 50000;

    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      minCapacity: MIN_CAPACITY,
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });

    const stats = limiter.getStats();
    expect(stats.memory?.maxCapacityKB).toBeGreaterThanOrEqual(MIN_CAPACITY);

    limiter.stop();
  });
});

describe('LLMRateLimiter - memory maxCapacity', () => {
  it('should respect maxCapacity', () => {
    const MAX_CAPACITY = 100000;

    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: MAX_CAPACITY,
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });

    const stats = limiter.getStats();
    expect(stats.memory?.maxCapacityKB).toBeLessThanOrEqual(MAX_CAPACITY);

    limiter.stop();
  });
});

describe('LLMRateLimiter - memory freeMemoryRatio', () => {
  it('should use freeMemoryRatio', () => {
    const lowRatioLimiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: LOW_RATIO },
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });

    const highRatioLimiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: HIGH_RATIO },
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });

    const lowStats = lowRatioLimiter.getStats();
    const highStats = highRatioLimiter.getStats();

    expect(highStats.memory?.maxCapacityKB).toBeGreaterThan(lowStats.memory?.maxCapacityKB ?? ZERO);

    lowRatioLimiter.stop();
    highRatioLimiter.stop();
  });
});

describe('LLMRateLimiter - memory recalculation', () => {
  it('should recalculate memory capacity periodically', async () => {
    const RECALCULATION_INTERVAL_MS = 50;

    const limiter = createLLMRateLimiter({
      memory: { recalculationIntervalMs: RECALCULATION_INTERVAL_MS },
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });

    const initialStats = limiter.getStats();
    expect(initialStats.memory?.maxCapacityKB).toBeGreaterThan(ZERO);

    await setTimeoutAsync(RECALCULATION_INTERVAL_MS + EXTRA_WAIT_MS);

    const statsAfterRecalc = limiter.getStats();
    expect(statsAfterRecalc.memory?.maxCapacityKB).toBeGreaterThan(ZERO);

    limiter.stop();
  });
});

describe('LLMRateLimiter - memory acquire release', () => {
  it('should acquire and release memory KB during job execution', async () => {
    const SMALL_MAX_CAPACITY = ESTIMATED_MEMORY_KB * TWO;
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: SMALL_MAX_CAPACITY,
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });
    let memoryDuringJob = ZERO;
    const jobPromise = limiter.queueJob(async () => {
      const stats = limiter.getStats();
      memoryDuringJob = stats.memory?.activeKB ?? ZERO;
      await setTimeoutAsync(DELAY_MS_MEDIUM);
      return createMockJobResult('memory-job');
    });
    await setTimeoutAsync(DELAY_MS_SHORT);
    await jobPromise;
    expect(memoryDuringJob).toBe(ESTIMATED_MEMORY_KB);
    expect(limiter.getStats().memory?.activeKB).toBe(ZERO);
    limiter.stop();
  });
});

describe('LLMRateLimiter - memory capacity exhausted', () => {
  it('should return false in hasCapacity when memory is exhausted', async () => {
    const MAX_CAPACITY = ESTIMATED_MEMORY_KB;
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: MAX_CAPACITY,
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });
    expect(limiter.hasCapacity()).toBe(true);
    const jobPromise = limiter.queueJob(async () => {
      await setTimeoutAsync(DELAY_MS_LONG);
      return createMockJobResult('blocking-job');
    });
    await setTimeoutAsync(EXTRA_WAIT_MS);
    expect(limiter.hasCapacity()).toBe(false);
    await jobPromise;
    limiter.stop();
  });
});
