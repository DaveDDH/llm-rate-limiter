/**
 * Tests for backend - fallback and rejection behavior.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import {
  HALF,
  ONE,
  TEN,
  ZERO,
  createAcquireConditional,
  createAcquireFalse,
  createConfigWithMemory,
  createDefaultConfig,
  createReleaseSimple,
} from './backend.helpers.js';

describe('backend - acquire returns false (fallback)', () => {
  it('should try next model when acquire returns false', async () => {
    const acquireCalls: string[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireConditional(acquireCalls, 'modelA'), release: createReleaseSimple() },
      models: { modelA: createDefaultConfig(), modelB: createDefaultConfig() },
      order: ['modelA', 'modelB'],
    });
    const result = await limiter.queueJob({
      jobId: 'fallback-job',
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(acquireCalls).toEqual(['modelA', 'modelB']);
    expect(result.modelUsed).toBe('modelB');
    limiter.stop();
  });

  it('should try next model and release memory when acquire returns false with memory config', async () => {
    const acquireCalls: string[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireConditional(acquireCalls, 'modelA'), release: createReleaseSimple() },
      models: { modelA: createConfigWithMemory(), modelB: createConfigWithMemory() },
      order: ['modelA', 'modelB'],
      memory: { freeMemoryRatio: HALF },
    });
    const result = await limiter.queueJob({
      jobId: 'fallback-with-memory',
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(acquireCalls).toEqual(['modelA', 'modelB']);
    expect(result.modelUsed).toBe('modelB');
    limiter.stop();
  });
});

describe('backend - acquire returns false (rejection)', () => {
  it('should throw when all models rejected by backend', async () => {
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireFalse(), release: createReleaseSimple() },
      models: { default: createDefaultConfig() },
    });
    const jobPromise = limiter.queueJob({
      jobId: 'all-rejected',
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
      },
    });
    await expect(jobPromise).rejects.toThrow('All models rejected by backend');
    limiter.stop();
  });

  it('should throw when all models rejected by backend (multiple models)', async () => {
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireFalse(), release: createReleaseSimple() },
      models: { modelA: createDefaultConfig(), modelB: createDefaultConfig() },
      order: ['modelA', 'modelB'],
    });
    const jobPromise = limiter.queueJob({
      jobId: 'all-rejected-multi',
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
      },
    });
    await expect(jobPromise).rejects.toThrow('All models rejected by backend');
    limiter.stop();
  });
});
