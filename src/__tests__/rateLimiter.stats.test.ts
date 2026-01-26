import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../rateLimiter.js';

import type { LLMJobResult, LLMRateLimiterInstance } from '../types.js';

const MOCK_INPUT_TOKENS = 100;
const MOCK_OUTPUT_TOKENS = 50;
const MOCK_TOTAL_TOKENS = MOCK_INPUT_TOKENS + MOCK_OUTPUT_TOKENS;
const ZERO_CACHED_TOKENS = 0;
const DEFAULT_REQUEST_COUNT = 1;
const ESTIMATED_MEMORY_KB = 10240;
const FREE_MEMORY_RATIO = 0.8;
const ZERO = 0;
const ONE = 1;
const DELAY_MS_SHORT = 10;
const DELAY_MS_LONG = 1000;

const createMockJobResult = (text: string): LLMJobResult => ({
  text,
  requestCount: DEFAULT_REQUEST_COUNT,
  usage: {
    input: MOCK_INPUT_TOKENS,
    output: MOCK_OUTPUT_TOKENS,
    cached: ZERO_CACHED_TOKENS,
  },
});

describe('LLMRateLimiter - hasCapacity', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;

  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should return true when all limits have capacity', () => {
    const RPM_LIMIT = 60;
    const MAX_CONCURRENT = 5;
    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      maxConcurrentRequests: MAX_CONCURRENT,
      resourcesPerEvent: { estimatedNumberOfRequests: ONE },
    });

    expect(limiter.hasCapacity()).toBe(true);
  });

  it('should return false when RPM limit reached', async () => {
    const RPM_LIMIT = 2;
    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: ONE },
    });

    await limiter.queueJob(() => createMockJobResult('job-1'));
    await limiter.queueJob(() => createMockJobResult('job-2'));

    expect(limiter.hasCapacity()).toBe(false);
  });

  it('should return false when concurrency limit reached', async () => {
    const MAX_CONCURRENT = 1;
    limiter = createLLMRateLimiter({
      maxConcurrentRequests: MAX_CONCURRENT,
    });

    const jobPromise = limiter.queueJob(async () => {
      await setTimeoutAsync(DELAY_MS_LONG);
      return createMockJobResult('slow-job');
    });

    await setTimeoutAsync(DELAY_MS_SHORT);

    expect(limiter.hasCapacity()).toBe(false);

    await jobPromise;
  });
});

describe('LLMRateLimiter - getStats empty', () => {
  it('should return empty stats for no config', () => {
    const limiter = createLLMRateLimiter({});

    const stats = limiter.getStats();
    expect(stats.memory).toBeUndefined();
    expect(stats.concurrency).toBeUndefined();
    expect(stats.requestsPerMinute).toBeUndefined();
    expect(stats.requestsPerDay).toBeUndefined();
    expect(stats.tokensPerMinute).toBeUndefined();
    expect(stats.tokensPerDay).toBeUndefined();

    limiter.stop();
  });
});

describe('LLMRateLimiter - getStats memory', () => {
  it('should return correct memory stats', () => {
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });

    const stats = limiter.getStats();
    expect(stats.memory?.activeKB).toBe(ZERO);
    expect(stats.memory?.maxCapacityKB).toBeGreaterThan(ZERO);
    expect(stats.memory?.availableKB).toBe(stats.memory?.maxCapacityKB);
    expect(stats.memory?.systemAvailableKB).toBeGreaterThan(ZERO);

    limiter.stop();
  });
});

describe('LLMRateLimiter - getStats concurrency', () => {
  it('should return correct concurrency stats', () => {
    const MAX_CONCURRENT = 5;
    const limiter = createLLMRateLimiter({
      maxConcurrentRequests: MAX_CONCURRENT,
    });

    const stats = limiter.getStats();
    expect(stats.concurrency?.active).toBe(ZERO);
    expect(stats.concurrency?.limit).toBe(MAX_CONCURRENT);
    expect(stats.concurrency?.available).toBe(MAX_CONCURRENT);
    expect(stats.concurrency?.waiting).toBe(ZERO);

    limiter.stop();
  });
});

describe('LLMRateLimiter - getStats time-based', () => {
  it('should return correct time-based stats', () => {
    const RPM_LIMIT = 60;
    const RPD_LIMIT = 1000;
    const TPM_LIMIT = 100000;
    const TPD_LIMIT = 1000000;

    const limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      requestsPerDay: RPD_LIMIT,
      tokensPerMinute: TPM_LIMIT,
      tokensPerDay: TPD_LIMIT,
      resourcesPerEvent: {
        estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
        estimatedUsedTokens: MOCK_TOTAL_TOKENS,
      },
    });

    const stats = limiter.getStats();

    expect(stats.requestsPerMinute?.limit).toBe(RPM_LIMIT);
    expect(stats.requestsPerMinute?.current).toBe(ZERO);
    expect(stats.requestsPerMinute?.remaining).toBe(RPM_LIMIT);

    expect(stats.requestsPerDay?.limit).toBe(RPD_LIMIT);
    expect(stats.tokensPerMinute?.limit).toBe(TPM_LIMIT);
    expect(stats.tokensPerDay?.limit).toBe(TPD_LIMIT);

    limiter.stop();
  });
});

describe('LLMRateLimiter - rate limiting waiting', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;

  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should wait when RPM limit reached', async () => {
    const RPM_LIMIT = 2;

    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: ONE },
    });

    await limiter.queueJob(() => createMockJobResult('job-1'));
    await limiter.queueJob(() => createMockJobResult('job-2'));

    expect(limiter.hasCapacity()).toBe(false);
  });

  it('should verify waiting behavior via stats', async () => {
    const RPM_LIMIT = 2;

    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: ONE },
    });

    await limiter.queueJob(() => createMockJobResult('job-1'));
    await limiter.queueJob(() => createMockJobResult('job-2'));

    expect(limiter.hasCapacity()).toBe(false);

    const stats = limiter.getStats();
    expect(stats.requestsPerMinute?.current).toBe(RPM_LIMIT);
    expect(stats.requestsPerMinute?.remaining).toBe(ZERO);
    expect(stats.requestsPerMinute?.resetsInMs).toBeGreaterThan(ZERO);
  });
});
