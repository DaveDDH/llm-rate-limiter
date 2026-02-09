/**
 * Configuration presets for high complexity distributed E2E tests (29-35).
 * Distributed global usage, cross-instance propagation, pub/sub, time windows.
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICING_INPUT = 1;
const PRICING_CACHED = 0.1;
const PRICING_OUTPUT = 2;

const standardPricing = { input: PRICING_INPUT, cached: PRICING_CACHED, output: PRICING_OUTPUT };

// Request counts
const REQUESTS_SINGLE = 1;
const REQUESTS_TWO = 2;

// Ratio constants
const RATIO_FULL = 1.0;

// Capacity constants
const TPM_20K = 20000;
const TPM_50K = 50000;
const TPM_90K = 90000;
const TPM_100K = 100000;
const TPM_120K = 120000;
const RPM_500 = 500;
const TOKENS_10K = 10000;

// maxWaitMS
const MAX_WAIT_30S = 30000;

/**
 * 29/30/31/32: Distributed global usage tracking.
 * model-alpha: TPM=100K, single job type.
 */
export const highDistributedBasicConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_100K, pricing: standardPricing },
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
 * 30.3: Three-instance distributed (TPM=90K for clean division).
 */
export const highDistributedThreeConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_90K, pricing: standardPricing },
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
 * 30.5: Three-instance mixed usage (TPM=120K).
 */
export const highDistributedMixedConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_120K, pricing: standardPricing },
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
 * 33: Distributed time windows.
 * model-alpha: TPM=50K.
 */
export const highDistributedTimeWindowConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_50K, pricing: standardPricing },
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
 * 35: Multi-model tracking in distributed mode.
 */
export const highDistributedMultiModelConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_100K, pricing: standardPricing },
    'model-beta': { tokensPerMinute: TPM_50K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha', 'model-beta'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};

/**
 * 31: Distributed pub/sub with TPM+RPM.
 */
export const highDistributedPubSubConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: TPM_100K,
      requestsPerMinute: RPM_500,
      pricing: standardPricing,
    },
    'model-beta': { tokensPerMinute: TPM_50K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha', 'model-beta'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_TWO,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};

/**
 * 29.5/29.6: Distributed with maxWaitMS for queue tests.
 */
export const highDistributedWaitConfig: RateLimiterPreset = {
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
