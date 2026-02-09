/**
 * Configuration presets for highest complexity E2E tests (37-47).
 * Distributed advanced scenarios, edge cases, priority, high concurrency.
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICING_INPUT = 1;
const PRICING_CACHED = 0.1;
const PRICING_OUTPUT = 2;

const standardPricing = { input: PRICING_INPUT, cached: PRICING_CACHED, output: PRICING_OUTPUT };

// Request counts
const REQUESTS_SINGLE = 1;

// Ratio constants
const RATIO_FULL = 1.0;
const RATIO_HALF = 0.5;
const RATIO_NINETY = 0.9;
const RATIO_TEN = 0.1;

// Capacity constants
const TPM_10K = 10000;
const TPM_20K = 20000;
const TPM_50K = 50000;
const TPM_100K = 100000;
const TPM_1M = 1000000;
const TPM_15K = 15000;
const CONCURRENT_100 = 100;
const TOKENS_10K = 10000;
const TOKENS_1K = 1000;

// Memory constants
const MEMORY_100MB_KB = 102400;
const MEMORY_10MB_KB = 10240;
const FREE_MEMORY_RATIO = 1.0;

// maxWaitMS
const MAX_WAIT_ZERO = 0;
const MAX_WAIT_30S = 30000;
const MAX_WAIT_60S = 60000;

/**
 * 38: Distributed memory independence.
 * TPM=1M (not limiting), memory=100MB, estimated=10MB.
 */
export const highestMemoryDistributedConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_1M, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_10MB_KB,
      ratio: { initialValue: RATIO_FULL },
    },
  },
  memory: { maxMemoryKB: MEMORY_100MB_KB, freeMemoryRatio: FREE_MEMORY_RATIO },
};

/**
 * 39: Distributed acquire/release.
 * TPM=20K, 2 instances → 1 slot each.
 */
export const highestDistributedAcquireConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_20K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};

/**
 * 39.2: Acquire/release atomicity under concurrency.
 * concurrent=100, 1 instance.
 */
export const highestAcquireAtomicityConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { maxConcurrentRequests: CONCURRENT_100, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
  },
};

/**
 * 40: Distributed wait queue.
 * TPM=20K, maxWaitMS=30s, 2 instances → 1 slot each.
 */
export const highestDistributedWaitQueueConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_20K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_30S },
    },
  },
};

/**
 * 41: Distributed escalation.
 * model-alpha: TPM=50K, model-beta: TPM=500K (large).
 */
export const highestDistributedEscalationConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_50K, pricing: standardPricing },
    'model-beta': { tokensPerMinute: TPM_1M, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha', 'model-beta'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_ZERO },
    },
  },
};

/**
 * 45: Job priority.
 * model-alpha: TPM=10K (1 slot), model-beta: TPM=100K.
 * lowPriority: maxWaitMS=0, critical: maxWaitMS=60s.
 */
export const highestJobPriorityConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_10K, pricing: standardPricing },
    'model-beta': { tokensPerMinute: TPM_100K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha', 'model-beta'],
  resourceEstimations: {
    lowPriority: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF },
      maxWaitMS: { 'model-alpha': MAX_WAIT_ZERO },
    },
    critical: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
  },
};

/**
 * 46: High concurrency.
 * model-alpha: TPM=100K, tokens=1K per job → 100 jobs/min.
 */
export const highestHighConcurrencyConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_100K, pricing: standardPricing },
    'model-beta': { tokensPerMinute: TPM_1M, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha', 'model-beta'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_1K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_ZERO },
    },
  },
};

/**
 * 47.2: Floor rounding edge case.
 * TPM=20K, jobTypeA ratio=0.1, jobTypeB ratio=0.9.
 */
export const highestEdgeFloorConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_20K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_TEN },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
    jobTypeB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_NINETY },
    },
  },
};

/**
 * 47: Edge case - zero slots after division.
 * TPM=15K, tokens=10K, 4 instances → 0 slots each.
 */
export const highestEdgeZeroSlotsConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_15K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};

/**
 * 47.7: Only fixed job types (no adjustment possible).
 */
export const highestEdgeAllFixedConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_100K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    fixedA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF, flexible: false },
    },
    fixedB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF, flexible: false },
    },
  },
};

/**
 * 47.8: Single flexible job type (no self-transfer).
 */
export const highestEdgeSingleFlexConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_100K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    flexibleOnly: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL, flexible: true },
    },
  },
};
