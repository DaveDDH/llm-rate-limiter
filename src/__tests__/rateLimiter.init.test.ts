import { createLLMRateLimiter } from '../rateLimiter.js';

import type { LLMRateLimiterConfig, LLMRateLimiterInstance } from '../types.js';

const ESTIMATED_MEMORY_KB = 10240;
const MOCK_INPUT_TOKENS = 100;
const MOCK_OUTPUT_TOKENS = 50;
const MOCK_TOTAL_TOKENS = MOCK_INPUT_TOKENS + MOCK_OUTPUT_TOKENS;
const DEFAULT_REQUEST_COUNT = 1;
const FREE_MEMORY_RATIO = 0.8;
const ZERO = 0;

describe('LLMRateLimiter - init no config', () => {
  it('should create limiter with no config', () => {
    const limiter = createLLMRateLimiter({});
    expect(limiter).toBeDefined();
    expect(limiter.hasCapacity()).toBe(true);
    limiter.stop();
  });
});

describe('LLMRateLimiter - init memory config', () => {
  it('should create limiter with memory config', () => {
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });
    expect(limiter).toBeDefined();
    const stats = limiter.getStats();
    expect(stats.memory).toBeDefined();
    expect(stats.memory?.maxCapacityKB).toBeGreaterThan(ZERO);
    limiter.stop();
  });
});

describe('LLMRateLimiter - init RPM config', () => {
  it('should create limiter with RPM config', () => {
    const RPM_LIMIT = 60;
    const ESTIMATED_REQUESTS = 1;
    const limiter = createLLMRateLimiter({
      requestsPerMinute: RPM_LIMIT,
      resourcesPerEvent: { estimatedNumberOfRequests: ESTIMATED_REQUESTS },
    });
    const stats = limiter.getStats();
    expect(stats.requestsPerMinute).toBeDefined();
    expect(stats.requestsPerMinute?.limit).toBe(RPM_LIMIT);
    limiter.stop();
  });
});

describe('LLMRateLimiter - init concurrency config', () => {
  it('should create limiter with concurrency config', () => {
    const MAX_CONCURRENT = 5;
    const limiter = createLLMRateLimiter({ maxConcurrentRequests: MAX_CONCURRENT });
    const stats = limiter.getStats();
    expect(stats.concurrency).toBeDefined();
    expect(stats.concurrency?.limit).toBe(MAX_CONCURRENT);
    limiter.stop();
  });
});

describe('LLMRateLimiter - initialization full config', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;

  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should create limiter with all configs', () => {
    const RPM_LIMIT = 60;
    const RPD_LIMIT = 1000;
    const TPM_LIMIT = 100000;
    const TPD_LIMIT = 1000000;
    const MAX_CONCURRENT = 5;

    limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      requestsPerMinute: RPM_LIMIT,
      requestsPerDay: RPD_LIMIT,
      tokensPerMinute: TPM_LIMIT,
      tokensPerDay: TPD_LIMIT,
      maxConcurrentRequests: MAX_CONCURRENT,
      resourcesPerEvent: {
        estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
        estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
        estimatedUsedTokens: MOCK_TOTAL_TOKENS,
      },
    });

    const stats = limiter.getStats();
    expect(stats.memory).toBeDefined();
    expect(stats.concurrency).toBeDefined();
    expect(stats.requestsPerMinute).toBeDefined();
    expect(stats.requestsPerDay).toBeDefined();
    expect(stats.tokensPerMinute).toBeDefined();
    expect(stats.tokensPerDay).toBeDefined();
  });
});

describe('LLMRateLimiter - initialization validation', () => {
  it('should throw error if tokensPerMinute is set without estimatedUsedTokens', () => {
    const TPM_LIMIT = 10000;
    const invalidConfig: LLMRateLimiterConfig = { tokensPerMinute: TPM_LIMIT };
    expect(() => {
      createLLMRateLimiter(invalidConfig);
    }).toThrow('estimatedUsedTokens is required');
  });

  it('should throw error if tokensPerDay is set without estimatedUsedTokens', () => {
    const TPD_LIMIT = 100000;
    const invalidConfig: LLMRateLimiterConfig = { tokensPerDay: TPD_LIMIT };
    expect(() => {
      createLLMRateLimiter(invalidConfig);
    }).toThrow('estimatedUsedTokens is required');
  });

  it('should throw error if requestsPerMinute is set without estimatedNumberOfRequests', () => {
    const RPM_LIMIT = 60;
    const invalidConfig: LLMRateLimiterConfig = { requestsPerMinute: RPM_LIMIT };
    expect(() => {
      createLLMRateLimiter(invalidConfig);
    }).toThrow('estimatedNumberOfRequests is required');
  });

  it('should throw error if memory is set without estimatedUsedMemoryKB', () => {
    const invalidConfig: LLMRateLimiterConfig = { memory: { freeMemoryRatio: FREE_MEMORY_RATIO } };
    expect(() => {
      createLLMRateLimiter(invalidConfig);
    }).toThrow('estimatedUsedMemoryKB is required');
  });
});

describe('LLMRateLimiter - initialization logging', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;

  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should call onLog when initialized', () => {
    const logMessages: string[] = [];
    limiter = createLLMRateLimiter({
      onLog: (message) => { logMessages.push(message); },
    });

    expect(logMessages.some((msg) => msg.includes('Initialized'))).toBe(true);
  });

  it('should use custom label in logs', () => {
    const CUSTOM_LABEL = 'CustomRateLimiter';
    const logMessages: string[] = [];
    limiter = createLLMRateLimiter({
      label: CUSTOM_LABEL,
      onLog: (message) => { logMessages.push(message); },
    });

    expect(logMessages.some((msg) => msg.includes(CUSTOM_LABEL))).toBe(true);
  });
});

describe('LLMRateLimiter - stop', () => {
  it('should log stopped message', () => {
    const logMessages: string[] = [];
    const limiter = createLLMRateLimiter({
      onLog: (message) => { logMessages.push(message); },
    });

    limiter.stop();

    expect(logMessages.some((msg) => msg.includes('Stopped'))).toBe(true);
  });

  it('should stop memory recalculation interval', () => {
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
    });

    limiter.stop();
    limiter.stop();
  });
});
