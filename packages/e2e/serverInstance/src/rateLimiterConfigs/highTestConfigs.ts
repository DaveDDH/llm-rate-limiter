/**
 * Configuration presets for high complexity E2E tests (24-27, 34).
 * Two-layer, multi-model, multi-resource, time windows.
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
const REQUESTS_FIVE = 5;

// Ratio constants
const RATIO_FULL = 1.0;
const RATIO_HALF = 0.5;
const RATIO_SIXTY = 0.6;
const RATIO_FORTY = 0.4;

// Capacity constants
const TPM_50K = 50000;
const TPM_100K = 100000;
const TPM_1M = 1000000;
const RPM_50 = 50;
const RPM_100 = 100;
const RPM_500 = 500;
const CONCURRENT_10 = 10;
const CONCURRENT_20 = 20;
const TOKENS_10K = 10000;
const TOKENS_1K = 1000;
const TPD_1M = 1000000;
const TPD_10M = 10000000;
const RPD_1K = 1000;
const RPD_10K = 10000;

// maxWaitMS
const MAX_WAIT_ZERO = 0;
const MAX_WAIT_60S = 60000;

/**
 * 26: Multi-resource adjustment.
 * model-alpha: TPM=100K, RPM=500, TPD=1M, RPD=10K.
 */
export const highMultiResourceConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: TPM_100K,
      requestsPerMinute: RPM_500,
      tokensPerDay: TPD_1M,
      requestsPerDay: RPD_10K,
      pricing: standardPricing,
    },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_FIVE,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};

/**
 * 25: Multi-model independence.
 * model-alpha: TPM=100K, model-beta: TPM=50K, model-gamma: concurrent=20.
 */
export const highMultiModelConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_100K, pricing: standardPricing },
    'model-beta': { tokensPerMinute: TPM_50K, pricing: standardPricing },
    'model-gamma': { maxConcurrentRequests: CONCURRENT_20, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha', 'model-beta', 'model-gamma'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_SIXTY },
      maxWaitMS: { 'model-alpha': MAX_WAIT_ZERO },
    },
    jobTypeB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FORTY },
      maxWaitMS: { 'model-alpha': MAX_WAIT_ZERO },
    },
  },
};

/**
 * 24.1: Two-layer check with equal ratios.
 * model-alpha: concurrent=10, ratios 0.5/0.5 → 5 slots each.
 */
export const highTwoLayerEqualConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { maxConcurrentRequests: CONCURRENT_10, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
    jobTypeB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
  },
};

/**
 * 24.2: Two-layer acquire/release (concurrent-based for clear slot tracking).
 * model-alpha: concurrent=10, ratios 0.6/0.4.
 */
export const highTwoLayerConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { maxConcurrentRequests: CONCURRENT_10, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_SIXTY },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
    jobTypeB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FORTY },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
  },
};

/**
 * 34: RPM+TPM tracking.
 * model-alpha: TPM=1M, RPM=100, TPD=10M, RPD=1K.
 */
export const highTpmRpmTrackingConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: TPM_1M,
      requestsPerMinute: RPM_100,
      tokensPerDay: TPD_10M,
      requestsPerDay: RPD_1K,
      pricing: standardPricing,
    },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_1K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};

/**
 * 34: RPM tracking separate from TPM.
 * model-alpha: TPM=100K, RPM=50, estimatedRequests=2.
 */
export const highRpmTrackingConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: TPM_100K,
      requestsPerMinute: RPM_50,
      pricing: standardPricing,
    },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_TWO,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};

/**
 * 27: Time window handling (single instance, TPM-based).
 */
export const highTimeWindowConfig: RateLimiterPreset = {
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
