/**
 * Configuration preset for medium complexity refund tests.
 * Partial request count refund (Test 9.3).
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICING_INPUT = 1;
const PRICING_CACHED = 0.1;
const PRICING_OUTPUT = 2;

const standardPricing = { input: PRICING_INPUT, cached: PRICING_CACHED, output: PRICING_OUTPUT };

// Capacity constants
const TPM_100K = 100000;
const RPM_1000 = 1000;
const TOKENS_10K = 10000;
const REQUESTS_FIVE = 5;
const RATIO_FULL = 1.0;

/**
 * 9.3: Partial request count refund.
 * TPM=100K, RPM=1000, estimatedRequests=5.
 * Send actualRequestCount=2 → RPM refunds from 5 to 2.
 */
export const mediumRefundPartialRequestConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: TPM_100K,
      requestsPerMinute: RPM_1000,
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
