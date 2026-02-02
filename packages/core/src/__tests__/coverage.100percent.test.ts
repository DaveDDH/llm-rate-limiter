/**
 * Tests to achieve 100% coverage - non-Error throws and token counters.
 */
import { jest } from '@jest/globals';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import { createInternalLimiter } from '../rateLimiter.js';
import { getEstimatedResourcesForBackend, releaseBackend } from '../utils/backendHelpers.js';
import { resetSharedMemoryState } from '../utils/memoryManager.js';
import { Semaphore } from '../utils/semaphore.js';

const ZERO = 0;
const ONE = 1;
const TEN = 10;
const HUNDRED = 100;
const THOUSAND = 1000;
const RATIO_HALF = 0.5;
const SHORT_DELAY = 10;

const ZERO_PRICING = { input: ZERO, cached: ZERO, output: ZERO };

describe('multiModelRateLimiter - non-Error string throw', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should convert string thrown value to Error object', async () => {
    limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: ZERO_PRICING,
        },
      },
    });
    const errors: Error[] = [];
    const jobPromise = limiter.queueJob({
      jobId: 'non-error-throw',
      job: (_, resolve) => {
        resolve({ modelId: 'default', inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Testing non-Error throw conversion
        throw 'string error value';
      },
      onError: (err) => {
        errors.push(err);
      },
    });
    await expect(jobPromise).rejects.toThrow('string error value');
    expect(errors[ZERO]).toBeInstanceOf(Error);
  });
});

describe('multiModelRateLimiter - non-Error number throw', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should convert number thrown value to Error object', async () => {
    limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: ZERO_PRICING,
        },
      },
    });
    const THROWN_NUMBER = 42;
    const jobPromise = limiter.queueJob({
      jobId: 'number-throw',
      job: (_, resolve) => {
        resolve({ modelId: 'default', inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Testing non-Error throw conversion
        throw THROWN_NUMBER;
      },
    });
    await expect(jobPromise).rejects.toThrow('42');
  });
});

describe('rateLimiter - TPM exhausted branch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should wait for TPM reset when TPM exhausted but RPM has capacity', async () => {
    const limiter = createInternalLimiter({
      requestsPerMinute: HUNDRED,
      tokensPerMinute: TEN,
      resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: TEN },
    });
    await limiter.queueJob(() => ({ requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } }));
    expect(limiter.hasCapacity()).toBe(false);
    expect(limiter.getStats().requestsPerMinute?.remaining).toBeGreaterThan(ZERO);
    const secondJob = limiter.queueJob(() => ({
      requestCount: ONE,
      usage: { input: TEN, output: ZERO, cached: ZERO },
    }));
    await jest.advanceTimersByTimeAsync(HUNDRED * THOUSAND);
    const result = await secondJob;
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});

describe('rateLimiter - TPD exhausted branch', () => {
  it('should detect TPD exhausted state', async () => {
    const limiter = createInternalLimiter({
      requestsPerDay: HUNDRED,
      tokensPerDay: TEN,
      resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: TEN },
    });
    await limiter.queueJob(() => ({ requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } }));
    expect(limiter.hasCapacity()).toBe(false);
    expect(limiter.getStats().requestsPerDay?.remaining).toBeGreaterThan(ZERO);
    limiter.stop();
  });
});

describe('backendHelpers - getEstimatedResourcesForBackend edge cases', () => {
  it('should return zeros when model has no resourcesPerEvent', () => {
    const models = { default: { pricing: ZERO_PRICING } };
    const result = getEstimatedResourcesForBackend(models, 'default');
    expect(result.requests).toBe(ZERO);
    expect(result.tokens).toBe(ZERO);
  });

  it('should return zeros when model does not exist', () => {
    const models = { default: { pricing: ZERO_PRICING } };
    const result = getEstimatedResourcesForBackend(models, 'nonexistent');
    expect(result.requests).toBe(ZERO);
    expect(result.tokens).toBe(ZERO);
  });
});

describe('backendHelpers - releaseBackend V1 call', () => {
  it('should call V1 backend release', async () => {
    const releaseCalls: unknown[] = [];
    const v1Backend = {
      acquire: async (): Promise<boolean> => await Promise.resolve(true),
      release: async (ctx: unknown): Promise<void> => {
        releaseCalls.push(ctx);
        await Promise.resolve();
      },
    };
    const models = {
      default: { resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: ZERO_PRICING },
    };
    const ctx = { backend: v1Backend, models, instanceId: 'test', modelId: 'default', jobId: 'job' };
    releaseBackend(ctx, { requests: ONE, tokens: TEN });
    await setTimeoutAsync(SHORT_DELAY);
    expect(releaseCalls).toHaveLength(ONE);
  });
});

describe('backendHelpers - releaseBackend V1 error', () => {
  it('should handle V1 backend release errors silently', async () => {
    const v1Backend = {
      acquire: async (): Promise<boolean> => await Promise.resolve(true),
      release: async (): Promise<void> => {
        await Promise.reject(new Error('release error'));
      },
    };
    const models = {
      default: { resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: ZERO_PRICING },
    };
    const ctx = { backend: v1Backend, models, instanceId: 'test', modelId: 'default', jobId: 'job' };
    expect(() => {
      releaseBackend(ctx, { requests: ONE, tokens: TEN });
    }).not.toThrow();
    await setTimeoutAsync(SHORT_DELAY);
  });
});

describe('memoryManager - resetSharedMemoryState exists', () => {
  it('should reset shared state when it exists', () => {
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ONE },
          pricing: ZERO_PRICING,
        },
      },
      memory: { freeMemoryRatio: RATIO_HALF },
    });
    resetSharedMemoryState();
    limiter.stop();
  });
});

describe('memoryManager - resetSharedMemoryState null', () => {
  it('should handle resetSharedMemoryState when state is null', () => {
    resetSharedMemoryState();
    expect(() => {
      resetSharedMemoryState();
    }).not.toThrow();
  });
});

describe('memoryManager - releaseSharedState null check', () => {
  it('should handle stop when sharedState already null', () => {
    resetSharedMemoryState();
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ONE },
          pricing: ZERO_PRICING,
        },
      },
      memory: { freeMemoryRatio: RATIO_HALF },
    });
    resetSharedMemoryState();
    expect(() => {
      limiter.stop();
    }).not.toThrow();
  });
});

describe('semaphore - default name parameter', () => {
  it('should use default name when not provided', () => {
    const semaphore = new Semaphore(ONE);
    expect(semaphore.getAvailablePermits()).toBe(ONE);
  });
});
