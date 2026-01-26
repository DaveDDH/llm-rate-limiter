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
  TEN,
  THREE,
  TPD_LIMIT,
  TPM_LIMIT,
  TWO,
  ZERO,
  CONCURRENCY_LIMIT,
  HUNDRED,
  TEN_THOUSAND,
  HUNDRED_THOUSAND,
} from './limiterCombinations.helpers.js';

import type { LLMJobResult } from './limiterCombinations.helpers.js';

describe('EdgeCase - memory and concurrency exhausted', () => {
  it('should report no capacity when both are exhausted', async () => {
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: MEMORY_MAX_CAPACITY_KB,
      maxConcurrentRequests: CONCURRENCY_LIMIT,
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });
    const jobPromise = limiter.queueJob(async () => {
      await setTimeoutAsync(LONG_JOB_DELAY_MS);
      return createMockJobResult('slow-job');
    });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getStats();
    expect(stats.memory?.availableKB).toBe(ZERO);
    expect(stats.concurrency?.available).toBe(ZERO);
    await jobPromise;
    limiter.stop();
  });
});

describe('EdgeCase - rpm and rpd exhausted', () => {
  it('should report no capacity when both are exhausted', async () => {
    const limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      requestsPerDay: RPD_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
    });
    await limiter.queueJob(() => createMockJobResult('exhaust-job'));
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getStats();
    expect(stats.requestsPerMinute?.remaining).toBe(ZERO);
    expect(stats.requestsPerDay?.remaining).toBe(ZERO);
    limiter.stop();
  });
});

describe('EdgeCase - tpm and tpd exhausted', () => {
  it('should report no capacity when both are exhausted', async () => {
    const limiter = createLLMRateLimiter({
      tokensPerMinute: TPM_LIMIT,
      tokensPerDay: TPD_LIMIT,
      resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
    });
    await limiter.queueJob(() => createMockJobResult('exhaust-job'));
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getStats();
    expect(stats.tokensPerMinute?.remaining).toBe(ZERO);
    expect(stats.tokensPerDay?.remaining).toBe(ZERO);
    limiter.stop();
  });
});

describe('EdgeCase - all time-based limiters exhausted', () => {
  it('should report no capacity when all are exhausted', async () => {
    const limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT, requestsPerDay: RPD_LIMIT,
      tokensPerMinute: TPM_LIMIT, tokensPerDay: TPD_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT, estimatedUsedTokens: MOCK_TOTAL_TOKENS },
    });
    await limiter.queueJob(() => createMockJobResult('exhaust-job'));
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getStats();
    expect(stats.requestsPerMinute?.remaining).toBe(ZERO);
    expect(stats.requestsPerDay?.remaining).toBe(ZERO);
    expect(stats.tokensPerMinute?.remaining).toBe(ZERO);
    expect(stats.tokensPerDay?.remaining).toBe(ZERO);
    limiter.stop();
  });
});

const createFailingJob = async (): Promise<LLMJobResult> => await Promise.reject(new Error('Intentional failure'));

describe('EdgeCase - release memory on error', () => {
  it('should release memory and concurrency on job failure', async () => {
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: MEMORY_MAX_CAPACITY_KB,
      maxConcurrentRequests: CONCURRENCY_LIMIT,
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });
    await expect(limiter.queueJob(createFailingJob)).rejects.toThrow('Intentional failure');
    expect(limiter.hasCapacity()).toBe(true);
    const stats = limiter.getStats();
    expect(stats.memory?.availableKB).toBe(MEMORY_MAX_CAPACITY_KB);
    expect(stats.concurrency?.available).toBe(ONE);
    limiter.stop();
  });
});

describe('EdgeCase - request counters on error', () => {
  it('should still increment request counters even on job failure', async () => {
    const limiter = createLLMRateLimiter({
      requestsPerMinute: TEN,
      requestsPerDay: HUNDRED,
      resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
    });
    await expect(limiter.queueJob(createFailingJob)).rejects.toThrow('Intentional failure');
    const stats = limiter.getStats();
    expect(stats.requestsPerMinute?.current).toBe(ONE);
    expect(stats.requestsPerDay?.current).toBe(ONE);
    limiter.stop();
  });
});

describe('EdgeCase - token counters on error', () => {
  it('should still reserve tokens even on job failure', async () => {
    const limiter = createLLMRateLimiter({
      tokensPerMinute: TEN_THOUSAND,
      tokensPerDay: HUNDRED_THOUSAND,
      resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
    });
    await expect(limiter.queueJob(createFailingJob)).rejects.toThrow('Intentional failure');
    const stats = limiter.getStats();
    expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
    expect(stats.tokensPerDay?.current).toBe(MOCK_TOTAL_TOKENS);
    limiter.stop();
  });
});

describe('EdgeCase - memory + rpm combination', () => {
  it('should handle memory + rpm combination correctly', async () => {
    const MEMORY_CAPACITY = ESTIMATED_MEMORY_KB * TWO;
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: MEMORY_CAPACITY,
      requestsPerMinute: THREE,
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB, estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
    });
    const job1 = limiter.queueJob(async () => { await setTimeoutAsync(LONG_JOB_DELAY_MS); return createMockJobResult('slow-1'); });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.getStats().memory?.activeKB).toBe(ESTIMATED_MEMORY_KB);
    const job2 = limiter.queueJob(async () => { await setTimeoutAsync(LONG_JOB_DELAY_MS); return createMockJobResult('slow-2'); });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.getStats().memory?.availableKB).toBe(ZERO);
    expect(limiter.hasCapacity()).toBe(false);
    await Promise.all([job1, job2]);
    limiter.stop();
  });
});

describe('EdgeCase - concurrency + tpm combination', () => {
  it('should handle concurrency + tpm combination correctly', async () => {
    const limiter = createLLMRateLimiter({
      maxConcurrentRequests: TWO,
      tokensPerMinute: MOCK_TOTAL_TOKENS * THREE,
      resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    await limiter.queueJob(() => createMockJobResult('job-2'));
    const stats = limiter.getStats();
    expect(stats.concurrency?.available).toBe(TWO);
    expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS * TWO);
    limiter.stop();
  });
});

describe('EdgeCase - concurrent jobs with all limiters', () => {
  it('should handle multiple concurrent jobs with all limiters', async () => {
    const FIVE = 5;
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO }, maxCapacity: ESTIMATED_MEMORY_KB * TEN,
      maxConcurrentRequests: THREE, requestsPerMinute: TEN, requestsPerDay: HUNDRED,
      tokensPerMinute: MOCK_TOTAL_TOKENS * TEN, tokensPerDay: MOCK_TOTAL_TOKENS * HUNDRED,
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB, estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT, estimatedUsedTokens: MOCK_TOTAL_TOKENS },
    });
    const jobs: Array<Promise<LLMJobResult>> = [];
    for (let i = ZERO; i < FIVE; i += ONE) { jobs.push(limiter.queueJob(() => createMockJobResult(`job-${String(i)}`))); }
    const results = await Promise.all(jobs);
    expect(results).toHaveLength(FIVE);
    expect(limiter.getStats().requestsPerMinute?.current).toBe(FIVE);
    limiter.stop();
  });

  it('should correctly limit concurrency with time limiters', async () => {
    const MAX_CONCURRENT = 2;
    const SIX = 6;
    const SHORT_DELAY = 30;
    const limiter = createLLMRateLimiter({
      maxConcurrentRequests: MAX_CONCURRENT, requestsPerMinute: HUNDRED, tokensPerMinute: MOCK_TOTAL_TOKENS * HUNDRED,
      resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT, estimatedUsedTokens: MOCK_TOTAL_TOKENS },
    });
    let concurrentCount = ZERO;
    let maxConcurrent = ZERO;
    const job = async (): Promise<LLMJobResult> => {
      concurrentCount += ONE; maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await setTimeoutAsync(SHORT_DELAY);
      concurrentCount -= ONE;
      return createMockJobResult('concurrent-job');
    };
    const jobs: Array<Promise<LLMJobResult>> = [];
    for (let i = ZERO; i < SIX; i += ONE) { jobs.push(limiter.queueJob(job)); }
    await Promise.all(jobs);
    expect(maxConcurrent).toBe(MAX_CONCURRENT);
    limiter.stop();
  });
});
