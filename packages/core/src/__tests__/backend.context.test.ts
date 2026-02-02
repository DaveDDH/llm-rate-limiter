/**
 * Tests for backend - acquire/release context functionality.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { BackendAcquireContext, BackendReleaseContext } from '../multiModelTypes.js';
import {
  HUNDRED,
  ONE,
  TEN,
  ZERO,
  createAcquireTrue,
  createAcquireTrueSimple,
  createDefaultConfig,
  createReleasePush,
  createSimpleJob,
} from './backend.helpers.js';

describe('backend - acquire/release context', () => {
  it('should call acquire and release with correct context on successful job', async () => {
    const acquireCalls: BackendAcquireContext[] = [];
    const releaseCalls: BackendReleaseContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireTrue(acquireCalls), release: createReleasePush(releaseCalls) },
      models: { default: createDefaultConfig() },
    });
    await limiter.queueJob({ jobId: 'test-job', job: createSimpleJob(TEN) });
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

describe('backend - release on job error', () => {
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
});

describe('backend - release error handling', () => {
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
    const result = await limiter.queueJob({ jobId: 'release-error', job: createSimpleJob(TEN) });
    expect(acquireCalled).toBe(true);
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});
