/**
 * Slot calculation configs for ratio testing, day-based limits, and memory.
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICING_INPUT_STANDARD = 1;
const PRICING_CACHED_STANDARD = 0.1;
const PRICING_OUTPUT_STANDARD = 2;

// Request counts
const REQUESTS_SINGLE = 1;
const REQUESTS_QUINTUPLE = 5;

// Ratio constants
const RATIO_SEVENTY_PERCENT = 0.7;
const RATIO_SIXTY_PERCENT = 0.6;
const RATIO_HALF = 0.5;
const RATIO_FORTY_PERCENT = 0.4;
const RATIO_THIRTY_PERCENT = 0.3;
const RATIO_TWENTY_PERCENT = 0.2;
const RATIO_TEN_PERCENT = 0.1;

// Slot calculation constants
const SLOT_CALC_TPM_100K = 100000;
const SLOT_CALC_TOKENS_10K = 10000;
const SLOT_CALC_TOKENS_5K = 5000;
const SLOT_CALC_TOKENS_1K = 1000;
const SLOT_CALC_TPD_1M = 1000000;
const SLOT_CALC_RPD_10K = 10000;

// Memory test constants
const MEMORY_TEST_TPM = 10000000;
const MEMORY_TEST_HEAVY_KB = 10240;
const MEMORY_TEST_LIGHT_KB = 1024;

/** Various ratios config (3 job types) */
export const slotCalcRatiosConfig: RateLimiterPreset = {
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
      ratio: { initialValue: RATIO_HALF },
    },
    jobTypeB: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_PERCENT },
    },
    jobTypeC: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_TWENTY_PERCENT },
    },
  },
};

/** TPD-only config (Tokens Per Day) */
export const slotCalcTpdConfig: RateLimiterPreset = {
  models: {
    'model-tpd': {
      tokensPerDay: SLOT_CALC_TPD_1M,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
  },
  escalationOrder: ['model-tpd'],
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

/** RPD-only config (Requests Per Day) */
export const slotCalcRpdConfig: RateLimiterPreset = {
  models: {
    'model-rpd': {
      requestsPerDay: SLOT_CALC_RPD_10K,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
  },
  escalationOrder: ['model-rpd'],
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

/** Uneven ratios config (4 job types: 0.7, 0.1, 0.1, 0.1) */
export const slotCalcUnevenRatiosConfig: RateLimiterPreset = {
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
      ratio: { initialValue: RATIO_SEVENTY_PERCENT },
    },
    jobTypeB: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_TEN_PERCENT },
    },
    jobTypeC: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_TEN_PERCENT },
    },
    jobTypeD: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_TEN_PERCENT },
    },
  },
};

/** Memory-based slot calculation config */
export const slotCalcMemoryConfig: RateLimiterPreset = {
  models: {
    'test-model': {
      tokensPerMinute: MEMORY_TEST_TPM,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
  },
  escalationOrder: ['test-model'],
  resourceEstimations: {
    heavyMemoryJob: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_1K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_TEST_HEAVY_KB,
      ratio: { initialValue: RATIO_HALF },
    },
    lightMemoryJob: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_1K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_TEST_LIGHT_KB,
      ratio: { initialValue: RATIO_HALF },
    },
  },
};

// Daily limits constants
const SLOT_CALC_TPD_EPSILON = 1000000;
const SLOT_CALC_RPD_EPSILON = 10000;

/** Combined TPD + RPD config (Daily limits test) */
export const slotCalcTpdRpdConfig: RateLimiterPreset = {
  models: {
    'model-epsilon': {
      tokensPerDay: SLOT_CALC_TPD_EPSILON,
      requestsPerDay: SLOT_CALC_RPD_EPSILON,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
  },
  escalationOrder: ['model-epsilon'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_SIXTY_PERCENT },
    },
    jobTypeB: {
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FORTY_PERCENT },
    },
  },
};

// Zero slots config constants
const SLOT_CALC_ZERO_TPM = 15000;

/** Zero Slots After Floor Division config (4 instances, low TPM) */
export const slotCalcZeroSlotsConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: SLOT_CALC_ZERO_TPM,
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
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FORTY_PERCENT },
    },
  },
};

// RPM limiting constants
const SLOT_CALC_RPM_LIMITING_RPM = 6;

/** RPM as Limiting Factor Over TPM config */
export const slotCalcRpmLimitingConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: SLOT_CALC_TPM_100K,
      requestsPerMinute: SLOT_CALC_RPM_LIMITING_RPM,
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
      estimatedUsedTokens: SLOT_CALC_TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FORTY_PERCENT },
    },
  },
};
