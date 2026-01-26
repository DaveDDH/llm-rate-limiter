import {
  createLLMRateLimiter,
  createMockJobResult,
  DEFAULT_REQUEST_COUNT,
  ESTIMATED_MEMORY_KB,
  FREE_MEMORY_RATIO,
  LONG_JOB_DELAY_MS,
  MEMORY_MAX_CAPACITY_KB,
  MOCK_TOTAL_TOKENS,
  ONE,
  RPD_LIMIT,
  RPM_LIMIT,
  SEMAPHORE_ACQUIRE_WAIT_MS,
  setTimeoutAsync,
  TPD_LIMIT,
  TPM_LIMIT,
  ZERO,
  CONCURRENCY_LIMIT,
} from './limiterCombinations.helpers.js';

import type { LLMRateLimiterInstance } from './limiterCombinations.helpers.js';

describe('Individual Limiter - memory', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should block when memory limit is exhausted', async () => {
    limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: MEMORY_MAX_CAPACITY_KB,
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });
    expect(limiter.hasCapacity()).toBe(true);
    const jobPromise = limiter.queueJob(async () => {
      await setTimeoutAsync(LONG_JOB_DELAY_MS);
      return createMockJobResult('slow-job');
    });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    const stats = limiter.getStats();
    expect(stats.memory?.activeKB).toBe(ESTIMATED_MEMORY_KB);
    expect(stats.memory?.availableKB).toBe(ZERO);
    expect(limiter.hasCapacity()).toBe(false);
    await jobPromise;
  });

  it('should restore capacity after job completes', async () => {
    limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: MEMORY_MAX_CAPACITY_KB,
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.hasCapacity()).toBe(true);
    const stats = limiter.getStats();
    expect(stats.memory?.availableKB).toBe(MEMORY_MAX_CAPACITY_KB);
    expect(stats.memory?.activeKB).toBe(ZERO);
  });
});

describe('Individual Limiter - concurrency', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should block when concurrency limit is exhausted', async () => {
    limiter = createLLMRateLimiter({ maxConcurrentRequests: CONCURRENCY_LIMIT });
    expect(limiter.hasCapacity()).toBe(true);
    const jobPromise = limiter.queueJob(async () => {
      await setTimeoutAsync(LONG_JOB_DELAY_MS);
      return createMockJobResult('slow-job');
    });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    const stats = limiter.getStats();
    expect(stats.concurrency?.active).toBe(ONE);
    expect(stats.concurrency?.available).toBe(ZERO);
    expect(limiter.hasCapacity()).toBe(false);
    await jobPromise;
  });

  it('should restore capacity after job completes', async () => {
    limiter = createLLMRateLimiter({ maxConcurrentRequests: CONCURRENCY_LIMIT });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.hasCapacity()).toBe(true);
    const stats = limiter.getStats();
    expect(stats.concurrency?.available).toBe(ONE);
    expect(stats.concurrency?.active).toBe(ZERO);
  });
});

describe('Individual Limiter - rpm', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should block when RPM limit is exhausted', async () => {
    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
    });
    expect(limiter.hasCapacity()).toBe(true);
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getStats();
    expect(stats.requestsPerMinute?.remaining).toBe(ZERO);
    expect(stats.requestsPerMinute?.current).toBe(ONE);
  });
});

describe('Individual Limiter - rpd', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should block when RPD limit is exhausted', async () => {
    limiter = createLLMRateLimiter({
      requestsPerDay: RPD_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
    });
    expect(limiter.hasCapacity()).toBe(true);
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getStats();
    expect(stats.requestsPerDay?.remaining).toBe(ZERO);
    expect(stats.requestsPerDay?.current).toBe(ONE);
  });
});

describe('Individual Limiter - tpm', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should block when TPM limit is exhausted', async () => {
    limiter = createLLMRateLimiter({
      tokensPerMinute: TPM_LIMIT,
      resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
    });
    expect(limiter.hasCapacity()).toBe(true);
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getStats();
    expect(stats.tokensPerMinute?.remaining).toBe(ZERO);
    expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
  });
});

describe('Individual Limiter - tpd', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should block when TPD limit is exhausted', async () => {
    limiter = createLLMRateLimiter({
      tokensPerDay: TPD_LIMIT,
      resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
    });
    expect(limiter.hasCapacity()).toBe(true);
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getStats();
    expect(stats.tokensPerDay?.remaining).toBe(ZERO);
    expect(stats.tokensPerDay?.current).toBe(MOCK_TOTAL_TOKENS);
  });
});
