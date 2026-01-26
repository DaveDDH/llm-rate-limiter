import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../rateLimiter.js';

import type { LLMJobResult, LLMRateLimiterInstance } from '../types.js';

const MOCK_INPUT_TOKENS = 100;
const MOCK_OUTPUT_TOKENS = 50;
const MOCK_TOTAL_TOKENS = MOCK_INPUT_TOKENS + MOCK_OUTPUT_TOKENS;
const ZERO_CACHED_TOKENS = 0;
const DEFAULT_REQUEST_COUNT = 1;
const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const DELAY_MS_SHORT = 10;
const DELAY_MS_MEDIUM = 50;

const createMockJobResult = (text: string, requestCount = DEFAULT_REQUEST_COUNT): LLMJobResult => ({
  text,
  requestCount,
  usage: { input: MOCK_INPUT_TOKENS, output: MOCK_OUTPUT_TOKENS, cached: ZERO_CACHED_TOKENS },
});

describe('LLMRateLimiter - queueJob basic', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;

  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should execute job and return result', async () => {
    limiter = createLLMRateLimiter({});
    const result = await limiter.queueJob(() => createMockJobResult('test-result'));
    expect(result.text).toBe('test-result');
    expect(result.usage.input).toBe(MOCK_INPUT_TOKENS);
    expect(result.usage.output).toBe(MOCK_OUTPUT_TOKENS);
  });

  it('should execute async job', async () => {
    limiter = createLLMRateLimiter({});
    const result = await limiter.queueJob(async () => {
      await setTimeoutAsync(DELAY_MS_SHORT);
      return createMockJobResult('async-result');
    });
    expect(result.text).toBe('async-result');
  });
});

describe('LLMRateLimiter - queueJob tracking', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;

  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should track request count in RPM counter', async () => {
    const RPM_LIMIT = 60;
    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: ONE },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    await limiter.queueJob(() => createMockJobResult('job-2'));
    expect(limiter.getStats().requestsPerMinute?.current).toBe(TWO);
  });

  it('should track token usage in TPM counter', async () => {
    const TPM_LIMIT = 100000;
    limiter = createLLMRateLimiter({
      tokensPerMinute: TPM_LIMIT,
      resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.getStats().tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
  });
});

describe('LLMRateLimiter - queueJob refund basic', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;

  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should refund difference between estimated and actual tokens', async () => {
    const TPM_LIMIT = 100000;
    const ESTIMATED_TOKENS = 200;
    limiter = createLLMRateLimiter({
      tokensPerMinute: TPM_LIMIT,
      resourcesPerEvent: { estimatedUsedTokens: ESTIMATED_TOKENS },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.getStats().tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
  });

  it('should refund difference between estimated and actual requests', async () => {
    const RPM_LIMIT = 60;
    const ESTIMATED_REQUESTS = 5;
    const ACTUAL_REQUESTS = 3;
    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: ESTIMATED_REQUESTS },
    });
    await limiter.queueJob(() => createMockJobResult('job-1', ACTUAL_REQUESTS));
    expect(limiter.getStats().requestsPerMinute?.current).toBe(ACTUAL_REQUESTS);
  });
});

describe('LLMRateLimiter - queueJob no refund', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;

  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should not refund when actual tokens equals estimated', async () => {
    const TPM_LIMIT = 100000;
    limiter = createLLMRateLimiter({
      tokensPerMinute: TPM_LIMIT,
      resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.getStats().tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
  });

  it('should not refund when actual requests equals estimated', async () => {
    const RPM_LIMIT = 60;
    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
    });
    await limiter.queueJob(() => createMockJobResult('job-1', DEFAULT_REQUEST_COUNT));
    expect(limiter.getStats().requestsPerMinute?.current).toBe(DEFAULT_REQUEST_COUNT);
  });

  it('should not refund when actual exceeds estimated', async () => {
    const TPM_LIMIT = 100000;
    const LOW_ESTIMATE = 50;
    limiter = createLLMRateLimiter({
      tokensPerMinute: TPM_LIMIT,
      resourcesPerEvent: { estimatedUsedTokens: LOW_ESTIMATE },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.getStats().tokensPerMinute?.current).toBe(LOW_ESTIMATE);
  });
});

describe('LLMRateLimiter - queueJob refund single counter', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;

  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should refund requests with only RPM configured (no RPD)', async () => {
    const RPM_LIMIT = 60;
    const ESTIMATED_REQUESTS = 5;
    const ACTUAL_REQUESTS = 2;
    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: ESTIMATED_REQUESTS },
    });
    await limiter.queueJob(() => createMockJobResult('job-1', ACTUAL_REQUESTS));
    expect(limiter.getStats().requestsPerMinute?.current).toBe(ACTUAL_REQUESTS);
    expect(limiter.getStats().requestsPerDay).toBeUndefined();
  });

  it('should refund tokens with only TPM configured (no TPD)', async () => {
    const TPM_LIMIT = 100000;
    const ESTIMATED_TOKENS = 300;
    limiter = createLLMRateLimiter({
      tokensPerMinute: TPM_LIMIT,
      resourcesPerEvent: { estimatedUsedTokens: ESTIMATED_TOKENS },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.getStats().tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
    expect(limiter.getStats().tokensPerDay).toBeUndefined();
  });
});

describe('LLMRateLimiter - queueJob refund dual counters', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;

  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should refund requests with both RPM and RPD configured', async () => {
    const RPM_LIMIT = 60;
    const RPD_LIMIT = 1000;
    const ESTIMATED_REQUESTS = 5;
    const ACTUAL_REQUESTS = 2;
    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      requestsPerDay: RPD_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: ESTIMATED_REQUESTS },
    });
    await limiter.queueJob(() => createMockJobResult('job-1', ACTUAL_REQUESTS));
    expect(limiter.getStats().requestsPerMinute?.current).toBe(ACTUAL_REQUESTS);
    expect(limiter.getStats().requestsPerDay?.current).toBe(ACTUAL_REQUESTS);
  });

  it('should refund tokens with both TPM and TPD configured', async () => {
    const TPM_LIMIT = 100000;
    const TPD_LIMIT = 1000000;
    const ESTIMATED_TOKENS = 300;
    limiter = createLLMRateLimiter({
      tokensPerMinute: TPM_LIMIT,
      tokensPerDay: TPD_LIMIT,
      resourcesPerEvent: { estimatedUsedTokens: ESTIMATED_TOKENS },
    });
    await limiter.queueJob(() => createMockJobResult('job-1'));
    expect(limiter.getStats().tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
    expect(limiter.getStats().tokensPerDay?.current).toBe(MOCK_TOTAL_TOKENS);
  });
});

describe('LLMRateLimiter - concurrency limit', () => {
  it('should respect concurrency limit', async () => {
    const MAX_CONCURRENT = 2;
    const JOB_COUNT = 5;
    const limiter = createLLMRateLimiter({ maxConcurrentRequests: MAX_CONCURRENT });
    let concurrentCount = ZERO;
    let maxConcurrent = ZERO;
    const createJob = async (): Promise<LLMJobResult> => {
      concurrentCount += ONE;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await setTimeoutAsync(DELAY_MS_MEDIUM);
      concurrentCount -= ONE;
      return createMockJobResult('concurrent-job');
    };
    const jobPromises: Array<Promise<LLMJobResult>> = [];
    for (let i = ZERO; i < JOB_COUNT; i += ONE) { jobPromises.push(limiter.queueJob(createJob)); }
    await Promise.all(jobPromises);
    expect(maxConcurrent).toBe(MAX_CONCURRENT);
    limiter.stop();
  });
});

describe('LLMRateLimiter - job errors', () => {
  it('should handle job errors and release resources', async () => {
    const MAX_CONCURRENT = 2;
    const limiter = createLLMRateLimiter({ maxConcurrentRequests: MAX_CONCURRENT });
    const failingJob = async (): Promise<LLMJobResult> => await Promise.reject(new Error('Job failed'));
    await expect(limiter.queueJob(failingJob)).rejects.toThrow('Job failed');
    expect(limiter.getStats().concurrency?.active).toBe(ZERO);
    expect(limiter.getStats().concurrency?.available).toBe(MAX_CONCURRENT);
    limiter.stop();
  });
});

describe('LLMRateLimiter - parallel execution', () => {
  it('should execute jobs in parallel up to concurrency limit', async () => {
    const MAX_CONCURRENT = 3;
    const JOB_COUNT = 6;
    const limiter = createLLMRateLimiter({ maxConcurrentRequests: MAX_CONCURRENT });
    const startTime = Date.now();
    const createJob = async (): Promise<LLMJobResult> => {
      await setTimeoutAsync(DELAY_MS_MEDIUM);
      return createMockJobResult('parallel-job');
    };
    const jobPromises: Array<Promise<LLMJobResult>> = [];
    for (let i = ZERO; i < JOB_COUNT; i += ONE) { jobPromises.push(limiter.queueJob(createJob)); }
    await Promise.all(jobPromises);
    const totalTime = Date.now() - startTime;
    const EXPECTED_MIN_TIME = DELAY_MS_MEDIUM * TWO;
    const EXPECTED_MAX_TIME = DELAY_MS_MEDIUM * JOB_COUNT;
    expect(totalTime).toBeGreaterThanOrEqual(EXPECTED_MIN_TIME - DELAY_MS_SHORT);
    expect(totalTime).toBeLessThan(EXPECTED_MAX_TIME);
    limiter.stop();
  });
});

describe('LLMRateLimiter - queueJob time counters', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;

  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should track multiple time counters correctly', async () => {
    const RPM_LIMIT = 10;
    const RPD_LIMIT = 100;
    const TPM_LIMIT = 10000;
    const TPD_LIMIT = 100000;

    limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      requestsPerDay: RPD_LIMIT,
      tokensPerMinute: TPM_LIMIT,
      tokensPerDay: TPD_LIMIT,
      resourcesPerEvent: {
        estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
        estimatedUsedTokens: MOCK_TOTAL_TOKENS,
      },
    });

    const JOB_COUNT = THREE;
    const jobs: Array<Promise<LLMJobResult>> = [];
    for (let i = ZERO; i < JOB_COUNT; i += ONE) {
      jobs.push(limiter.queueJob(() => createMockJobResult(`job-${String(i)}`)));
    }
    await Promise.all(jobs);
    const stats = limiter.getStats();
    expect(stats.requestsPerMinute?.current).toBe(JOB_COUNT);
    expect(stats.requestsPerDay?.current).toBe(JOB_COUNT);
    const expectedTokens = JOB_COUNT * MOCK_TOTAL_TOKENS;
    expect(stats.tokensPerMinute?.current).toBe(expectedTokens);
    expect(stats.tokensPerDay?.current).toBe(expectedTokens);
  });
});
