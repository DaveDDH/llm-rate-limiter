/**
 * Slot calculation configs for various limit types (TPM, RPM, concurrent, mixed).
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICING_INPUT_STANDARD = 1;
const PRICING_CACHED_STANDARD = 0.1;
const PRICING_OUTPUT_STANDARD = 2;
const PRICING_INPUT_BUDGET = 0.5;
const PRICING_CACHED_BUDGET = 0.05;
const PRICING_OUTPUT_BUDGET = 1;

// Request counts
const REQUESTS_SINGLE = 1;
const REQUESTS_QUINTUPLE = 5;

// Ratio constants
const RATIO_SEVENTY_PERCENT = 0.7;
const RATIO_SIXTY_PERCENT = 0.6;
const RATIO_HALF = 0.5;
const RATIO_FORTY_PERCENT = 0.4;
const RATIO_THIRTY_PERCENT = 0.3;

// Slot calculation constants
const SLOT_CALC_TPM_100K = 100000;
const SLOT_CALC_RPM_500 = 500;
const SLOT_CALC_CONCURRENT_100 = 100;
const SLOT_CALC_CONCURRENT_50 = 50;
const SLOT_CALC_RPM_50 = 50;
const SLOT_CALC_TOKENS_10K = 10000;
const SLOT_CALC_TOKENS_5K = 5000;
const SLOT_CALC_TOKENS_1K = 1000;

/** TPM-only config */
export const slotCalcTpmConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: SLOT_CALC_TPM_100K,
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
      ratio: { initialValue: RATIO_SIXTY_PERCENT },
    },
    jobTypeB: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_5K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FORTY_PERCENT },
    },
  },
};

/** RPM-only config */
export const slotCalcRpmConfig: RateLimiterPreset = {
  models: {
    'model-beta': {
      requestsPerMinute: SLOT_CALC_RPM_500,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
  },
  escalationOrder: ['model-beta'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_1K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_SIXTY_PERCENT },
    },
    jobTypeB: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_1K,
      estimatedNumberOfRequests: REQUESTS_QUINTUPLE,
      ratio: { initialValue: RATIO_FORTY_PERCENT },
    },
  },
};

/** Concurrent-only config */
export const slotCalcConcurrentConfig: RateLimiterPreset = {
  models: {
    'model-gamma': {
      maxConcurrentRequests: SLOT_CALC_CONCURRENT_100,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
  },
  escalationOrder: ['model-gamma'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_1K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_SEVENTY_PERCENT },
    },
    jobTypeB: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_1K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_PERCENT },
    },
  },
};

/** Mixed limits config (TPM + RPM) - tests limiting factor */
export const slotCalcTpmRpmConfig: RateLimiterPreset = {
  models: {
    'model-delta': {
      tokensPerMinute: SLOT_CALC_TPM_100K,
      requestsPerMinute: SLOT_CALC_RPM_50,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
  },
  escalationOrder: ['model-delta'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF },
    },
    jobTypeB: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF },
    },
  },
};

/** Multi-model config with different limit types */
export const slotCalcMultiModelConfig: RateLimiterPreset = {
  models: {
    'model-tpm': {
      tokensPerMinute: SLOT_CALC_TPM_100K,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
    'model-concurrent': {
      maxConcurrentRequests: SLOT_CALC_CONCURRENT_50,
      pricing: {
        input: PRICING_INPUT_BUDGET,
        cached: PRICING_CACHED_BUDGET,
        output: PRICING_OUTPUT_BUDGET,
      },
    },
  },
  escalationOrder: ['model-tpm', 'model-concurrent'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF },
    },
    jobTypeB: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF },
    },
  },
};
