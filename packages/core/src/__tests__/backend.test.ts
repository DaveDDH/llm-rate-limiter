/**
 * Tests for backend (distributed rate limiting) functionality.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type {
  Availability,
  AvailabilityChangeReason,
  BackendAcquireContext,
  BackendReleaseContext,
  ModelRateLimitConfig,
} from '../multiModelTypes.js';

const ZERO = 0;
const ONE = 1;
const TEN = 10;
const HUNDRED = 100;
const HALF = 0.5;

const createDefaultConfig = (): ModelRateLimitConfig => ({
  requestsPerMinute: TEN,
  resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: HUNDRED },
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});
const createConfigWithMemory = (): ModelRateLimitConfig => ({
  requestsPerMinute: TEN,
  resourcesPerEvent: {
    estimatedNumberOfRequests: ONE,
    estimatedUsedTokens: HUNDRED,
    estimatedUsedMemoryKB: ONE,
  },
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

const createAcquireTrue =
  (calls: BackendAcquireContext[]): ((ctx: BackendAcquireContext) => Promise<boolean>) =>
  async (ctx): Promise<boolean> => {
    calls.push(ctx);
    return await Promise.resolve(true);
  };

const createReleasePush =
  (calls: BackendReleaseContext[]): ((ctx: BackendReleaseContext) => Promise<void>) =>
  async (ctx): Promise<void> => {
    calls.push(ctx);
    await Promise.resolve();
  };

const createAcquireTrueSimple =
  (): ((ctx: BackendAcquireContext) => Promise<boolean>) => async (): Promise<boolean> =>
    await Promise.resolve(true);

const createReleaseSimple =
  (): ((ctx: BackendReleaseContext) => Promise<void>) => async (): Promise<void> => {
    await Promise.resolve();
  };

const createAcquireFalse =
  (): ((ctx: BackendAcquireContext) => Promise<boolean>) => async (): Promise<boolean> =>
    await Promise.resolve(false);

const createAcquireConditional =
  (calls: string[], rejectModel: string): ((ctx: BackendAcquireContext) => Promise<boolean>) =>
  async (ctx): Promise<boolean> => {
    calls.push(ctx.modelId);
    return await Promise.resolve(ctx.modelId !== rejectModel);
  };

describe('backend - acquire/release context', () => {
  it('should call acquire and release with correct context on successful job', async () => {
    const acquireCalls: BackendAcquireContext[] = [];
    const releaseCalls: BackendReleaseContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireTrue(acquireCalls), release: createReleasePush(releaseCalls) },
      models: { default: createDefaultConfig() },
    });
    await limiter.queueJob({
      jobId: 'test-job',
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(acquireCalls).toHaveLength(ONE);
    expect(acquireCalls[ZERO]?.modelId).toBe('default');
    expect(acquireCalls[ZERO]?.jobId).toBe('test-job');
    expect(acquireCalls[ZERO]?.estimated).toEqual({ requests: ONE, tokens: HUNDRED });
    expect(releaseCalls).toHaveLength(ONE);
    expect(releaseCalls[ZERO]?.modelId).toBe('default');
    expect(releaseCalls[ZERO]?.actual).toEqual({ requests: ONE, tokens: TEN + TEN });
    limiter.stop();
  });
});

describe('backend - release on error', () => {
  it('should call release with zero actual on job error', async () => {
    const releaseCalls: BackendReleaseContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireTrueSimple(), release: createReleasePush(releaseCalls) },
      models: { default: createDefaultConfig() },
    });
    const jobPromise = limiter.queueJob({
      jobId: 'error-job',
      job: (_, resolve) => {
        resolve({ modelId: 'default', inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        throw new Error('Job failed');
      },
    });
    await expect(jobPromise).rejects.toThrow('Job failed');
    expect(releaseCalls).toHaveLength(ONE);
    expect(releaseCalls[ZERO]?.actual).toEqual({ requests: ZERO, tokens: ZERO });
    limiter.stop();
  });

  it('should silently catch release errors', async () => {
    let acquireCalled = false;
    const acquireWithFlag = async (): Promise<boolean> => {
      acquireCalled = true;
      return await Promise.resolve(true);
    };
    const releaseWithError = async (): Promise<void> => {
      await Promise.reject(new Error('Release failed'));
    };
    const limiter = createLLMRateLimiter({
      backend: { acquire: acquireWithFlag, release: releaseWithError },
      models: { default: createDefaultConfig() },
    });
    const result = await limiter.queueJob({
      jobId: 'release-error',
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(acquireCalled).toBe(true);
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});

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

describe('backend - no backend configured', () => {
  it('should work without backend', async () => {
    const limiter = createLLMRateLimiter({ models: { default: createDefaultConfig() } });
    const result = await limiter.queueJob({
      jobId: 'no-backend',
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});

describe('backend - setDistributedAvailability', () => {
  it('should emit onAvailableSlotsChange with distributed reason', () => {
    const calls: Array<{ availability: Availability; reason: AvailabilityChangeReason }> = [];
    const limiter = createLLMRateLimiter({
      models: { default: createDefaultConfig() },
      onAvailableSlotsChange: (availability, reason) => {
        calls.push({ availability, reason });
      },
    });
    limiter.setDistributedAvailability({ slots: TEN, tokensPerMinute: HUNDRED });
    const distCall = calls.find((c) => c.reason === 'distributed');
    expect(distCall).toBeDefined();
    expect(distCall?.availability.slots).toBe(TEN);
    expect(distCall?.availability.tokensPerMinute).toBe(HUNDRED);
    expect(distCall?.availability.concurrentRequests).toBeNull();
    expect(distCall?.availability.memoryKB).toBeNull();
    limiter.stop();
  });

  it('should return early when no onAvailableSlotsChange callback', () => {
    const limiter = createLLMRateLimiter({ models: { default: createDefaultConfig() } });
    expect(() => {
      limiter.setDistributedAvailability({ slots: TEN });
    }).not.toThrow();
    limiter.stop();
  });

  it('should handle optional fields in DistributedAvailability', () => {
    const calls: Availability[] = [];
    const limiter = createLLMRateLimiter({
      models: { default: createDefaultConfig() },
      onAvailableSlotsChange: (availability, reason) => {
        if (reason === 'distributed') {
          calls.push(availability);
        }
      },
    });
    limiter.setDistributedAvailability({ slots: TEN });
    expect(calls[ZERO]?.tokensPerMinute).toBeNull();
    expect(calls[ZERO]?.tokensPerDay).toBeNull();
    expect(calls[ZERO]?.requestsPerMinute).toBeNull();
    expect(calls[ZERO]?.requestsPerDay).toBeNull();
    limiter.stop();
  });
});

describe('backend - delegation with backend', () => {
  it('should call release on delegation', async () => {
    const releaseCalls: BackendReleaseContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireTrueSimple(), release: createReleasePush(releaseCalls) },
      models: { modelA: createDefaultConfig(), modelB: createDefaultConfig() },
      order: ['modelA', 'modelB'],
    });
    let attempt = ZERO;
    const result = await limiter.queueJob({
      jobId: 'delegation-job',
      job: ({ modelId }, resolve, reject) => {
        attempt += ONE;
        if (attempt === ONE) {
          reject({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO }, { delegate: true });
          return { requestCount: ZERO, usage: { input: ZERO, output: ZERO, cached: ZERO } };
        }
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(result.modelUsed).toBe('modelB');
    expect(releaseCalls.length).toBeGreaterThanOrEqual(ONE);
    limiter.stop();
  });
});

describe('backend - model with partial resource estimates', () => {
  it('should use zero for missing token estimates', async () => {
    const acquireCalls: BackendAcquireContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireTrue(acquireCalls), release: createReleaseSimple() },
      models: {
        default: {
          requestsPerMinute: TEN,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: { input: ZERO, cached: ZERO, output: ZERO },
        },
      },
    });
    await limiter.queueJob({
      jobId: 'no-token-estimates',
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(acquireCalls[ZERO]?.estimated).toEqual({ requests: ONE, tokens: ZERO });
    limiter.stop();
  });

  it('should use zero for missing request estimates', async () => {
    const acquireCalls: BackendAcquireContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireTrue(acquireCalls), release: createReleaseSimple() },
      models: {
        default: {
          tokensPerMinute: HUNDRED,
          resourcesPerEvent: { estimatedUsedTokens: TEN },
          pricing: { input: ZERO, cached: ZERO, output: ZERO },
        },
      },
    });
    await limiter.queueJob({
      jobId: 'no-request-estimates',
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(acquireCalls[ZERO]?.estimated).toEqual({ requests: ZERO, tokens: TEN });
    limiter.stop();
  });
});

describe('backend - without memory manager', () => {
  it('should handle backend rejection without memory manager (all rejected)', async () => {
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireFalse(), release: createReleaseSimple() },
      models: {
        default: {
          tokensPerMinute: HUNDRED,
          resourcesPerEvent: { estimatedUsedTokens: TEN },
          pricing: { input: ZERO, cached: ZERO, output: ZERO },
        },
      },
    });
    const jobPromise = limiter.queueJob({
      jobId: 'no-memory',
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
      },
    });
    await expect(jobPromise).rejects.toThrow('All models rejected by backend');
    limiter.stop();
  });

  it('should handle backend rejection and fallback without memory manager', async () => {
    const acquireCalls: string[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireConditional(acquireCalls, 'modelA'), release: createReleaseSimple() },
      models: {
        modelA: {
          tokensPerMinute: HUNDRED,
          resourcesPerEvent: { estimatedUsedTokens: TEN },
          pricing: { input: ZERO, cached: ZERO, output: ZERO },
        },
        modelB: {
          tokensPerMinute: HUNDRED,
          resourcesPerEvent: { estimatedUsedTokens: TEN },
          pricing: { input: ZERO, cached: ZERO, output: ZERO },
        },
      },
      order: ['modelA', 'modelB'],
    });
    const result = await limiter.queueJob({
      jobId: 'fallback-no-memory',
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
