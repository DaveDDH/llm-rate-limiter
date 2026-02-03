/**
 * Tests for the maxWaitMS feature.
 * Verifies timeout behavior when waiting for model capacity.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import {
  calculateDefaultMaxWaitMS,
  getMaxWaitMS,
  selectModelWithWait,
  waitForSpecificModelCapacity,
} from '../utils/jobExecutionHelpers.js';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const FIVE = 5;
const TEN = 10;
const FIFTY = 50;
const HUNDRED = 100;
const MS_100 = 100;
const MS_500 = 500;
const MS_1000 = 1000;
const MS_5000 = 5000;
const MS_65000 = 65000;

describe('maxWaitMS - calculateDefaultMaxWaitMS', () => {
  it('should return a value between 5000 and 65000ms', () => {
    const result = calculateDefaultMaxWaitMS();
    expect(result).toBeGreaterThanOrEqual(MS_5000);
    expect(result).toBeLessThanOrEqual(MS_65000);
  });

  it('should be based on seconds until next minute boundary', () => {
    // The default is (60 - currentSeconds + 5) * 1000
    // At second 0: (60 - 0 + 5) * 1000 = 65000
    // At second 55: (60 - 55 + 5) * 1000 = 10000
    // At second 59: (60 - 59 + 5) * 1000 = 6000
    const result = calculateDefaultMaxWaitMS();
    const now = new Date();
    const secondsToNextMinute = 60 - now.getSeconds();
    const expected = (secondsToNextMinute + FIVE) * MS_1000;
    // Allow small timing variance
    expect(Math.abs(result - expected)).toBeLessThan(MS_100);
  });
});

describe('maxWaitMS - getMaxWaitMS', () => {
  it('should return default when resourceEstimationsPerJob is undefined', () => {
    const result = getMaxWaitMS(undefined, 'anyJobType', 'anyModel');
    expect(result).toBeGreaterThanOrEqual(MS_5000);
    expect(result).toBeLessThanOrEqual(MS_65000);
  });

  it('should return default when job type not found', () => {
    const result = getMaxWaitMS({ otherJobType: {} }, 'myJobType', 'myModel');
    expect(result).toBeGreaterThanOrEqual(MS_5000);
  });

  it('should return default when maxWaitMS not specified for job type', () => {
    const result = getMaxWaitMS({ myJobType: { estimatedUsedTokens: HUNDRED } }, 'myJobType', 'myModel');
    expect(result).toBeGreaterThanOrEqual(MS_5000);
  });

  it('should return default when model not in maxWaitMS config', () => {
    const result = getMaxWaitMS(
      {
        myJobType: {
          estimatedUsedTokens: HUNDRED,
          maxWaitMS: { 'other-model': MS_1000 },
        },
      },
      'myJobType',
      'myModel'
    );
    expect(result).toBeGreaterThanOrEqual(MS_5000);
  });

  it('should return configured value when present', () => {
    const result = getMaxWaitMS(
      {
        myJobType: {
          estimatedUsedTokens: HUNDRED,
          maxWaitMS: { 'my-model': MS_1000 },
        },
      },
      'myJobType',
      'my-model'
    );
    expect(result).toBe(MS_1000);
  });

  it('should return 0 for fail-fast configuration', () => {
    const result = getMaxWaitMS(
      {
        lowPriority: {
          estimatedUsedTokens: HUNDRED,
          maxWaitMS: { 'my-model': ZERO },
        },
      },
      'lowPriority',
      'my-model'
    );
    expect(result).toBe(ZERO);
  });
});

describe('maxWaitMS - waitForSpecificModelCapacity', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return true immediately if capacity available', async () => {
    const hasCapacity = jest.fn(() => true);
    const promise = waitForSpecificModelCapacity(hasCapacity, MS_5000, MS_100);

    const result = await promise;
    expect(result).toBe(true);
    expect(hasCapacity).toHaveBeenCalledTimes(ONE);
  });

  it('should return false immediately with maxWaitMS=0 and no capacity', async () => {
    const hasCapacity = jest.fn(() => false);
    const promise = waitForSpecificModelCapacity(hasCapacity, ZERO, MS_100);

    const result = await promise;
    expect(result).toBe(false);
    expect(hasCapacity).toHaveBeenCalledTimes(ONE);
  });

  it('should return true with maxWaitMS=0 if capacity available', async () => {
    const hasCapacity = jest.fn(() => true);
    const promise = waitForSpecificModelCapacity(hasCapacity, ZERO, MS_100);

    const result = await promise;
    expect(result).toBe(true);
    expect(hasCapacity).toHaveBeenCalledTimes(ONE);
  });

  it('should poll and return true when capacity becomes available', async () => {
    let callCount = ZERO;
    const hasCapacity = jest.fn(() => {
      callCount += ONE;
      return callCount >= TWO + ONE; // True on third call
    });

    const promise = waitForSpecificModelCapacity(hasCapacity, MS_5000, MS_100);

    // First check happens immediately - returns false
    // Timer starts for next check
    await jest.advanceTimersByTimeAsync(MS_100);
    await jest.advanceTimersByTimeAsync(MS_100);

    const result = await promise;
    expect(result).toBe(true);
    expect(hasCapacity).toHaveBeenCalledTimes(TWO + ONE);
  });

  it('should timeout and return false after maxWaitMS', async () => {
    const hasCapacity = jest.fn(() => false);
    const maxWaitMS = MS_500;

    const promise = waitForSpecificModelCapacity(hasCapacity, maxWaitMS, MS_100);

    // Advance time past the timeout
    await jest.advanceTimersByTimeAsync(maxWaitMS + MS_100);

    const result = await promise;
    expect(result).toBe(false);
  });
});

describe('maxWaitMS - selectModelWithWait', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return first available model immediately', async () => {
    const promise = selectModelWithWait({
      escalationOrder: ['model-a', 'model-b'],
      triedModels: new Set<string>(),
      hasCapacityForModel: (m) => m === 'model-a',
      getMaxWaitMSForModel: () => MS_5000,
      pollIntervalMs: MS_100,
    });

    const result = await promise;
    expect(result.modelId).toBe('model-a');
    expect(result.allModelsExhausted).toBe(false);
  });

  it('should skip tried models and return next available', async () => {
    const promise = selectModelWithWait({
      escalationOrder: ['model-a', 'model-b'],
      triedModels: new Set(['model-a']),
      hasCapacityForModel: (m) => m === 'model-b',
      getMaxWaitMSForModel: () => MS_5000,
      pollIntervalMs: MS_100,
    });

    const result = await promise;
    expect(result.modelId).toBe('model-b');
    expect(result.allModelsExhausted).toBe(false);
  });

  it('should wait for model capacity up to maxWaitMS', async () => {
    let modelACallCount = ZERO;
    const promise = selectModelWithWait({
      escalationOrder: ['model-a', 'model-b'],
      triedModels: new Set<string>(),
      hasCapacityForModel: (m) => {
        if (m === 'model-a') {
          modelACallCount += ONE;
          return modelACallCount >= TWO + ONE; // Available on 3rd check
        }
        return false;
      },
      getMaxWaitMSForModel: () => MS_5000,
      pollIntervalMs: MS_100,
    });

    // Advance timers for polling
    await jest.advanceTimersByTimeAsync(MS_100 * TWO);

    const result = await promise;
    expect(result.modelId).toBe('model-a');
    expect(result.allModelsExhausted).toBe(false);
  });

  it('should fallback to next model after timeout', async () => {
    const promise = selectModelWithWait({
      escalationOrder: ['model-a', 'model-b'],
      triedModels: new Set<string>(),
      hasCapacityForModel: (m) => m === 'model-b', // Only model-b has capacity
      getMaxWaitMSForModel: () => MS_500, // Short timeout
      pollIntervalMs: MS_100,
    });

    // Advance past model-a timeout
    await jest.advanceTimersByTimeAsync(MS_500 + MS_100);

    const result = await promise;
    expect(result.modelId).toBe('model-b');
    expect(result.allModelsExhausted).toBe(false);
  });

  it('should fail fast with maxWaitMS=0', async () => {
    const promise = selectModelWithWait({
      escalationOrder: ['model-a', 'model-b'],
      triedModels: new Set<string>(),
      hasCapacityForModel: (m) => m === 'model-b', // Only model-b has capacity
      getMaxWaitMSForModel: (m) => (m === 'model-a' ? ZERO : MS_5000),
      pollIntervalMs: MS_100,
    });

    // model-a should fail fast, model-b should be selected immediately
    const result = await promise;
    expect(result.modelId).toBe('model-b');
  });

  it('should return allModelsExhausted when all models timeout', async () => {
    const promise = selectModelWithWait({
      escalationOrder: ['model-a', 'model-b'],
      triedModels: new Set<string>(),
      hasCapacityForModel: () => false, // No capacity anywhere
      getMaxWaitMSForModel: () => MS_100, // Very short timeout
      pollIntervalMs: FIFTY,
    });

    // Advance past both model timeouts
    await jest.advanceTimersByTimeAsync(MS_500);

    const result = await promise;
    expect(result.modelId).toBeNull();
    expect(result.allModelsExhausted).toBe(true);
  });

  it('should return allModelsExhausted when all models already tried', async () => {
    const promise = selectModelWithWait({
      escalationOrder: ['model-a', 'model-b'],
      triedModels: new Set(['model-a', 'model-b']),
      hasCapacityForModel: () => true,
      getMaxWaitMSForModel: () => MS_5000,
      pollIntervalMs: MS_100,
    });

    const result = await promise;
    expect(result.modelId).toBeNull();
    expect(result.allModelsExhausted).toBe(true);
  });
});

/** Default pricing for test models */
const DEFAULT_PRICING = { input: ZERO, cached: ZERO, output: ZERO };

describe('maxWaitMS - Integration with createLLMRateLimiter', () => {
  // Use unknown to allow different job type unions across tests
  let limiter: { stop: () => void } | undefined;

  afterEach(() => {
    limiter?.stop();
  });

  it('should accept maxWaitMS in resourceEstimationsPerJob config', () => {
    // This test verifies the types compile correctly
    const testLimiter = createLLMRateLimiter({
      models: {
        'gpt-4': { tokensPerMinute: HUNDRED * HUNDRED, requestsPerMinute: HUNDRED, pricing: DEFAULT_PRICING },
        'gpt-3.5': { tokensPerMinute: HUNDRED * HUNDRED, requestsPerMinute: HUNDRED, pricing: DEFAULT_PRICING },
      },
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: {
        critical: {
          estimatedUsedTokens: HUNDRED,
          // maxWaitMS not specified - uses dynamic default
        },
        lowPriority: {
          estimatedUsedTokens: FIFTY,
          maxWaitMS: {
            'gpt-4': ZERO, // Fail fast
            'gpt-3.5': MS_5000,
          },
        },
        standard: {
          estimatedUsedTokens: HUNDRED,
          maxWaitMS: {
            'gpt-4': MS_1000 * TEN * TEN, // 60 seconds
            // gpt-3.5 not specified - uses dynamic default
          },
        },
      },
    });
    limiter = testLimiter;

    expect(testLimiter).toBeDefined();
    expect(testLimiter.hasCapacity()).toBe(true);
  });

  it('should execute job successfully with maxWaitMS config', async () => {
    const testLimiter = createLLMRateLimiter({
      models: {
        'gpt-4': { tokensPerMinute: HUNDRED * HUNDRED, requestsPerMinute: TEN, pricing: DEFAULT_PRICING },
      },
      resourceEstimationsPerJob: {
        myJob: {
          estimatedUsedTokens: HUNDRED,
          maxWaitMS: { 'gpt-4': MS_5000 },
        },
      },
    });
    limiter = testLimiter;

    interface TestResult {
      [key: string]: unknown;
      data: string;
      usage: { input: number; output: number; cached: number };
      requestCount: number;
    }

    const result = await testLimiter.queueJob<TestResult>({
      jobId: 'test-1',
      jobType: 'myJob',
      job: (ctx, resolve) => {
        resolve({ modelId: ctx.modelId, inputTokens: FIFTY, cachedTokens: ZERO, outputTokens: FIFTY });
        return { data: 'success', usage: { input: FIFTY, output: FIFTY, cached: ZERO }, requestCount: ONE };
      },
    });

    expect(result.data).toBe('success');
    expect(result.modelUsed).toBe('gpt-4');
  });

  it('should throw when all models timeout with maxWaitMS=0 (fail fast)', async () => {
    // Create a limiter with 2 concurrent request slots for job type allocation
    // but limit throughput with tokensPerMinute to create model capacity contention
    // The first job will consume all tokens, forcing the second to fail fast
    const testLimiter = createLLMRateLimiter({
      models: {
        'gpt-4': {
          maxConcurrentRequests: TWO, // Allow 2 job type slots
          tokensPerMinute: HUNDRED, // But only 100 TPM
          pricing: DEFAULT_PRICING,
        },
      },
      resourceEstimationsPerJob: {
        lowPriority: {
          estimatedUsedTokens: HUNDRED, // Each job uses all 100 tokens
          maxWaitMS: { 'gpt-4': ZERO }, // Fail fast
          ratio: { initialValue: ONE },
        },
      },
    });
    limiter = testLimiter;

    interface TestResult {
      [key: string]: unknown;
      usage: { input: number; output: number; cached: number };
      requestCount: number;
    }

    // Use a barrier to ensure first job has acquired its model slot
    let firstJobStarted = false;
    const firstJobStartedPromise = new Promise<void>((resolve) => {
      const checkStarted = (): void => {
        if (firstJobStarted) {
          resolve();
        } else {
          setTimeout(checkStarted, TEN);
        }
      };
      checkStarted();
    });

    // First job takes all the TPM capacity (100 tokens)
    const firstJobPromise = testLimiter.queueJob<TestResult>({
      jobId: 'first-job',
      jobType: 'lowPriority',
      job: async (ctx, resolve) => {
        firstJobStarted = true;
        // Simulate a slow job
        await new Promise((r) => setTimeout(r, MS_500));
        resolve({ modelId: ctx.modelId, inputTokens: FIFTY, cachedTokens: ZERO, outputTokens: FIFTY });
        return { usage: { input: FIFTY, output: FIFTY, cached: ZERO }, requestCount: ONE };
      },
    });

    // Wait for first job to actually start executing (meaning it has consumed TPM)
    await firstJobStartedPromise;

    // Second job should fail fast (maxWaitMS=0) because no TPM capacity
    await expect(
      testLimiter.queueJob<TestResult>({
        jobId: 'second-job',
        jobType: 'lowPriority',
        job: (_ctx, resolve) => {
          resolve({ modelId: 'gpt-4', inputTokens: FIFTY, cachedTokens: ZERO, outputTokens: FIFTY });
          return { usage: { input: FIFTY, output: FIFTY, cached: ZERO }, requestCount: ONE };
        },
      })
    ).rejects.toThrow('All models exhausted: no capacity available within maxWaitMS');

    // Wait for first job to complete
    await firstJobPromise;
  });
});
