/**
 * Additional medium-high complexity escalation configs.
 * Split from mediumHighConfigs.ts for line-limit compliance.
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICING_INPUT = 1;
const PRICING_CACHED = 0.1;
const PRICING_OUTPUT = 2;

const standardPricing = { input: PRICING_INPUT, cached: PRICING_CACHED, output: PRICING_OUTPUT };

// Capacity constants
const CONCURRENT_1 = 1;
const CONCURRENT_50 = 50;
const TOKENS_10K = 10000;
const REQUESTS_SINGLE = 1;
const RATIO_FULL = 1.0;
const MAX_WAIT_5S = 5000;

/**
 * 21.4: Concurrent escalation with 5s wait.
 * model-alpha: concurrent=1, maxWaitMS=5s. model-beta: concurrent=50.
 */
export const mhEscalationConcWait5sConfig: RateLimiterPreset = {
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
      maxWaitMS: { 'model-alpha': MAX_WAIT_5S },
    },
  },
};
