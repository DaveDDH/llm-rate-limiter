/**
 * Configuration presets for medium-high complexity E2E tests (18-22).
 * Memory constraint enforcement, model escalation basic/rate limits/timeout/tracking.
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

// Capacity constants
const TPM_10K = 10000;
const TPM_100K = 100000;
const TPM_10M = 10000000;
const RPM_1 = 1;
const RPM_100 = 100;
const CONCURRENT_1 = 1;
const CONCURRENT_50 = 50;
const TOKENS_10K = 10000;

// Memory constants
const MEMORY_50MB_KB = 51200;
const MEMORY_100MB_KB = 102400;
const MEMORY_10MB_KB = 10240;
const MEMORY_50MB_ESTIMATE_KB = 51200;
const MEMORY_5MB_KB = 5120;
const MEMORY_20MB_KB = 20480;
const FREE_MEMORY_RATIO = 1.0;

// maxWaitMS constants
const MAX_WAIT_ZERO = 0;
const MAX_WAIT_5S = 5000;
const MAX_WAIT_3S = 3000;
const MAX_WAIT_60S = 60000;

// Limit constants for 18.5
const RPM_10 = 10;
const CONCURRENT_8 = 8;

/**
 * 18.1/18.2: Memory constraint basic.
 * 1 instance: TPM=10M (not limiting), memory=50MB, estimated=10MB → 5 memory slots.
 */
export const mhMemoryConstrainConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_10M, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_10MB_KB,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
  },
  memory: { maxMemoryKB: MEMORY_50MB_KB, freeMemoryRatio: FREE_MEMORY_RATIO },
};

/**
 * 18.3: Memory + ratio interaction.
 * 1 instance: TPM=10M, memory=100MB, two flex types each estimated=10MB.
 */
export const mhMemoryRatioInteractConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_10M, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_10MB_KB,
      ratio: { initialValue: RATIO_HALF, flexible: true },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
    jobTypeB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_10MB_KB,
      ratio: { initialValue: RATIO_HALF, flexible: true },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
  },
  memory: { maxMemoryKB: MEMORY_100MB_KB, freeMemoryRatio: FREE_MEMORY_RATIO },
};

/**
 * 18.4: Different memory estimates per job type.
 * 1 instance: TPM=10M, memory=100MB, heavyJob=50MB, lightJob=5MB.
 */
export const mhMemoryDiffEstimatesConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_10M, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    heavyJob: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_50MB_ESTIMATE_KB,
      ratio: { initialValue: RATIO_HALF },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
    lightJob: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_5MB_KB,
      ratio: { initialValue: RATIO_HALF },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
  },
  memory: { maxMemoryKB: MEMORY_100MB_KB, freeMemoryRatio: FREE_MEMORY_RATIO },
};

/**
 * 18.5: All limit types applied simultaneously.
 * 1 instance: TPM=10M, RPM=10, concurrent=8, memory=100MB/20MB=5 (most restrictive).
 */
export const mhMemoryAllLimitsConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: TPM_10M,
      requestsPerMinute: RPM_10,
      maxConcurrentRequests: CONCURRENT_8,
      pricing: standardPricing,
    },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_20MB_KB,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
  },
  memory: { maxMemoryKB: MEMORY_100MB_KB, freeMemoryRatio: FREE_MEMORY_RATIO },
};

/**
 * 19.3/19.4/19.6: Three-model escalation, maxWaitMS=0 on all models.
 */
export const mhEscalationThreeModelConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_10K, pricing: standardPricing },
    'model-beta': { tokensPerMinute: TPM_10K, pricing: standardPricing },
    'model-gamma': { tokensPerMinute: TPM_10K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha', 'model-beta', 'model-gamma'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: {
        'model-alpha': MAX_WAIT_ZERO,
        'model-beta': MAX_WAIT_ZERO,
        'model-gamma': MAX_WAIT_ZERO,
      },
    },
  },
};

/**
 * 20.1: TPM exhaustion triggers escalation.
 * model-alpha: TPM=10K (1 slot), model-beta: TPM=100K.
 */
export const mhEscalationTpmConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_10K, pricing: standardPricing },
    'model-beta': { tokensPerMinute: TPM_100K, pricing: standardPricing },
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
 * 20.2: RPM exhaustion triggers escalation.
 * model-alpha: RPM=1, model-beta: RPM=100.
 */
export const mhEscalationRpmConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { requestsPerMinute: RPM_1, pricing: standardPricing },
    'model-beta': { requestsPerMinute: RPM_100, pricing: standardPricing },
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
 * 20.3: Concurrent limit triggers escalation.
 * model-alpha: concurrent=1, model-beta: concurrent=50.
 */
export const mhEscalationConcConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { maxConcurrentRequests: CONCURRENT_1, pricing: standardPricing },
    'model-beta': { maxConcurrentRequests: CONCURRENT_50, pricing: standardPricing },
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
 * 21.2/21.3: Multi-timeout escalation.
 * alpha(5s) → beta(3s) → gamma.
 */
export const mhEscalationMultiTimeoutConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_10K, pricing: standardPricing },
    'model-beta': { tokensPerMinute: TPM_10K, pricing: standardPricing },
    'model-gamma': { tokensPerMinute: TPM_10K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha', 'model-beta', 'model-gamma'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_5S, 'model-beta': MAX_WAIT_3S },
    },
  },
};
