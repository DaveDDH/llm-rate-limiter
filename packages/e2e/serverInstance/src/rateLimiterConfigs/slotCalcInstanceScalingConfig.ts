/**
 * Slot calculation config for single job type instance count scaling tests (1.1/1.7/1.8).
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICING_INPUT_STANDARD = 1;
const PRICING_CACHED_STANDARD = 0.1;
const PRICING_OUTPUT_STANDARD = 2;

// Capacity constants
const SLOT_CALC_TPM_100K = 100000;
const SLOT_CALC_RPM_HIGH = 1000;
const SLOT_CALC_TOKENS_10K = 10000;

// Ratio constant
const RATIO_FULL = 1.0;

// Request count
const REQUESTS_SINGLE = 1;

/** Single job type TPM config for instance count scaling tests (1.1/1.7/1.8) */
export const slotCalcTpmSingleConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: SLOT_CALC_TPM_100K,
      requestsPerMinute: SLOT_CALC_RPM_HIGH,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};
