import {
  createLLMRateLimiter,
  createMockJobResult,
  DEFAULT_REQUEST_COUNT,
  ESTIMATED_MEMORY_KB,
  FREE_MEMORY_RATIO,
  JOB_DELAY_MS,
  LONG_JOB_DELAY_MS,
  MEMORY_MAX_CAPACITY_KB,
  NINE,
  ONE,
  SEMAPHORE_ACQUIRE_WAIT_MS,
  setTimeoutAsync,
  SHORT_JOB_DELAY_MS,
  TIMEOUT_MS,
  TOLERANCE_MS,
  TWO,
  ZERO,
} from './limiterCombinations.helpers.js';

import type { LLMRateLimiterInstance } from './limiterCombinations.helpers.js';

describe('Blocking - concurrency actually blocks jobs', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should queue jobs beyond concurrency limit and execute them in order', async () => {
    const MAX_CONCURRENT = 2;
    limiter = createLLMRateLimiter({ maxConcurrentRequests: MAX_CONCURRENT });
    const startTimes: Record<string, number> = {};
    const endTimes: Record<string, number> = {};
    const start = Date.now();
    const createTrackedJob = (id: string, delayMs: number) => async () => {
      startTimes[id] = Date.now();
      await setTimeoutAsync(delayMs);
      endTimes[id] = Date.now();
      return createMockJobResult(id);
    };
    const promises = [
      limiter.queueJob(createTrackedJob('A', JOB_DELAY_MS)),
      limiter.queueJob(createTrackedJob('B', JOB_DELAY_MS)),
      limiter.queueJob(createTrackedJob('C', SHORT_JOB_DELAY_MS)),
      limiter.queueJob(createTrackedJob('D', SHORT_JOB_DELAY_MS)),
    ];
    await Promise.all(promises);
    const totalTime = Date.now() - start;
    const firstTwoEnded = Math.min(endTimes.A ?? start, endTimes.B ?? start);
    const lastTwoStarted = Math.min(startTimes.C ?? start, startTimes.D ?? start);
    expect(lastTwoStarted).toBeGreaterThanOrEqual(firstTwoEnded - TOLERANCE_MS);
    const EXPECTED_MIN_TIME = JOB_DELAY_MS + SHORT_JOB_DELAY_MS - TOLERANCE_MS;
    expect(totalTime).toBeGreaterThanOrEqual(EXPECTED_MIN_TIME);
  });
});

describe('Blocking - memory actually blocks jobs', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should queue jobs when memory slots are exhausted', async () => {
    limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: MEMORY_MAX_CAPACITY_KB,
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });
    const SLOW_JOB_DELAY_MS = 200;
    const jobOrder: string[] = [];
    const slowJobPromise = limiter.queueJob(async () => {
      jobOrder.push('slow-start');
      await setTimeoutAsync(SLOW_JOB_DELAY_MS);
      jobOrder.push('slow-end');
      return createMockJobResult('slow');
    });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.hasCapacity()).toBe(false);
    const fastJobPromise = limiter.queueJob(() => {
      jobOrder.push('fast-start');
      jobOrder.push('fast-end');
      return createMockJobResult('fast');
    });
    await Promise.all([slowJobPromise, fastJobPromise]);
    const slowEndIndex = jobOrder.indexOf('slow-end');
    const fastStartIndex = jobOrder.indexOf('fast-start');
    expect(fastStartIndex).toBeGreaterThan(slowEndIndex);
  });
});

describe('Blocking - rpm actually blocks jobs', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should block jobs when RPM limit is exhausted', async () => {
    const RPM_LIMIT = 2;
    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    await limiter.queueJob(() => createMockJobResult('job-2'));
    expect(limiter.hasCapacity()).toBe(false);
    const timeoutPromise = setTimeoutAsync(TIMEOUT_MS).then(() => 'timeout' as const);
    const jobPromise = limiter.queueJob(() => createMockJobResult('job-3')).then(() => 'completed' as const);
    const result = await Promise.race([jobPromise, timeoutPromise]);
    expect(result).toBe('timeout');
  });
});

describe('Blocking - tpm behavior', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should reserve tokens before job execution and block when limit would be exceeded', async () => {
    const ESTIMATED_TOKENS = 50;
    const TPM_LIMIT = ESTIMATED_TOKENS * TWO;
    limiter = createLLMRateLimiter({
      tokensPerMinute: TPM_LIMIT,
      resourcesPerEvent: { estimatedUsedTokens: ESTIMATED_TOKENS },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    let stats = limiter.getStats();
    expect(stats.tokensPerMinute?.current).toBe(ESTIMATED_TOKENS);
    expect(limiter.hasCapacity()).toBe(true);
    await limiter.queueJob(() => createMockJobResult('job-2'));
    stats = limiter.getStats();
    expect(stats.tokensPerMinute?.current).toBe(TPM_LIMIT);
    expect(limiter.hasCapacity()).toBe(false);
    const timeoutPromise = setTimeoutAsync(TIMEOUT_MS).then(() => 'timeout' as const);
    const jobPromise = limiter.queueJob(() => createMockJobResult('blocked-job')).then(() => 'completed' as const);
    const result = await Promise.race([jobPromise, timeoutPromise]);
    expect(result).toBe('timeout');
  });

  it('should never exceed token limit', async () => {
    const ESTIMATED_TOKENS = 100;
    const TPM_LIMIT = ESTIMATED_TOKENS;
    limiter = createLLMRateLimiter({
      tokensPerMinute: TPM_LIMIT,
      resourcesPerEvent: { estimatedUsedTokens: ESTIMATED_TOKENS },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    const stats = limiter.getStats();
    expect(stats.tokensPerMinute?.current).toBeLessThanOrEqual(TPM_LIMIT);
    expect(stats.tokensPerMinute?.current).toBe(ESTIMATED_TOKENS);
  });
});

describe('Blocking - combined limiters block correctly', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should block when any limiter is exhausted', async () => {
    const TEN = 10;
    limiter = createLLMRateLimiter({
      maxConcurrentRequests: ONE,
      requestsPerMinute: TEN,
      resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
    });
    const slowJobPromise = limiter.queueJob(async () => {
      await setTimeoutAsync(LONG_JOB_DELAY_MS);
      return createMockJobResult('slow');
    });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getStats();
    expect(stats.concurrency?.available).toBe(ZERO);
    expect(stats.requestsPerMinute?.remaining).toBe(NINE);
    await slowJobPromise;
  });
});
