/**
 * Tests for backend - misc and edge case scenarios.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { BackendAcquireContext } from '../multiModelTypes.js';
import {
  HUNDRED,
  ONE,
  TEN,
  ZERO,
  createAcquireConditional,
  createAcquireFalse,
  createAcquireTrue,
  createDefaultConfig,
  createReleaseSimple,
  createRequestOnlyConfig,
  createSimpleJob,
  createTokenOnlyConfig,
  createTwoModelConfig,
} from './backend.helpers.js';

describe('backend - no backend configured', () => {
  it('should work without backend', async () => {
    const limiter = createLLMRateLimiter({ models: { default: createDefaultConfig() } });
    const result = await limiter.queueJob({ jobId: 'no-backend', job: createSimpleJob(TEN) });
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});

describe('backend - model with partial resource estimates', () => {
  it('should use zero for missing token estimates', async () => {
    const acquireCalls: BackendAcquireContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireTrue(acquireCalls), release: createReleaseSimple() },
      models: { default: createRequestOnlyConfig(TEN) },
    });
    await limiter.queueJob({ jobId: 'no-token-estimates', job: createSimpleJob(TEN) });
    expect(acquireCalls[ZERO]?.estimated).toEqual({ requests: ONE, tokens: ZERO });
    limiter.stop();
  });

  it('should use zero for missing request estimates', async () => {
    const acquireCalls: BackendAcquireContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireTrue(acquireCalls), release: createReleaseSimple() },
      models: { default: createTokenOnlyConfig(HUNDRED, TEN) },
    });
    await limiter.queueJob({ jobId: 'no-request-estimates', job: createSimpleJob(TEN) });
    expect(acquireCalls[ZERO]?.estimated).toEqual({ requests: ZERO, tokens: TEN });
    limiter.stop();
  });
});

describe('backend - without memory manager (all rejected)', () => {
  it('should handle backend rejection without memory manager', async () => {
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireFalse(), release: createReleaseSimple() },
      models: { default: createTokenOnlyConfig(HUNDRED, TEN) },
    });
    const jobPromise = limiter.queueJob({ jobId: 'no-memory', job: createSimpleJob(ZERO) });
    await expect(jobPromise).rejects.toThrow('All models rejected by backend');
    limiter.stop();
  });
});

describe('backend - without memory manager (fallback)', () => {
  it('should handle backend rejection and fallback without memory manager', async () => {
    const acquireCalls: string[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireConditional(acquireCalls, 'modelA'), release: createReleaseSimple() },
      models: createTwoModelConfig(HUNDRED, TEN),
      order: ['modelA', 'modelB'],
    });
    const result = await limiter.queueJob({ jobId: 'fallback-no-memory', job: createSimpleJob(TEN) });
    expect(acquireCalls).toEqual(['modelA', 'modelB']);
    expect(result.modelUsed).toBe('modelB');
    limiter.stop();
  });
});
