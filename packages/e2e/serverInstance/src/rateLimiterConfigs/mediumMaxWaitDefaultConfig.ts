/**
 * Configuration preset for medium complexity maxWaitMS default test (14.1).
 * Two models, no explicit maxWaitMS - uses default calculation.
 * Default maxWaitMS = (60 - secondsInMinute + 5) * 1000
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICING_INPUT = 1;
const PRICING_CACHED = 0.1;
const PRICING_OUTPUT = 2;

const standardPricing = { input: PRICING_INPUT, cached: PRICING_CACHED, output: PRICING_OUTPUT };

// Capacity constants
const TPM_10K = 10000;
const TOKENS_10K = 10000;
const REQUESTS_SINGLE = 1;
const RATIO_FULL = 1.0;
const MAX_CONCURRENT_ONE = 1;

/**
 * 14.1: Default maxWaitMS (no explicit maxWaitMS).
 * model-alpha + model-beta, each TPM=10K, maxConcurrent=1.
 * 1 instance: 1 slot per model (capped by concurrency).
 * No maxWaitMS configured - uses default calculation.
 * maxConcurrent ensures capacity stays blocked across minute boundaries.
 */
export const mediumMaxWaitDefaultConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: TPM_10K,
      maxConcurrentRequests: MAX_CONCURRENT_ONE,
      pricing: standardPricing,
    },
    'model-beta': {
      tokensPerMinute: TPM_10K,
      maxConcurrentRequests: MAX_CONCURRENT_ONE,
      pricing: standardPricing,
    },
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
