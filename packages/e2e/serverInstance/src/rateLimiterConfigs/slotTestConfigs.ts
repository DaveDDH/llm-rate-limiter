/**
 * Slot calculation and ratio test configurations.
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

// Ratio constants
const RATIO_FULL = 1.0;
const RATIO_SIXTY_PERCENT = 0.6;
const RATIO_FORTY_PERCENT = 0.4;
const RATIO_THIRTY_PERCENT = 0.3;
const RATIO_THIRD = 0.33;

// Slot test constants
const SLOT_TEST_TPM = 100000;
const SLOT_TEST_TOKENS_A = 10000;
const SLOT_TEST_TOKENS_B = 5000;

// Fixed ratio constants
const FIXED_RATIO_TPM = 100000;
const FIXED_RATIO_TOKENS = 10000;

// Flexible ratio constants
const FLEX_TPM = 100000;
const FLEX_TOKENS = 10000;

// Scale constants
const SCALE_TPM = 100000;
const SCALE_TOKENS = 10000;

/**
 * Multi-Dimensional Slot Test Config.
 * Tests slot calculation with simple, verifiable numbers.
 */
export const slotCalculationConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: SLOT_TEST_TPM,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
    'model-beta': {
      tokensPerMinute: SLOT_TEST_TPM,
      pricing: {
        input: PRICING_INPUT_BUDGET,
        cached: PRICING_CACHED_BUDGET,
        output: PRICING_OUTPUT_BUDGET,
      },
    },
  },
  escalationOrder: ['model-alpha', 'model-beta'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: SLOT_TEST_TOKENS_A,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_SIXTY_PERCENT },
    },
    jobTypeB: {
      estimatedUsedTokens: SLOT_TEST_TOKENS_B,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FORTY_PERCENT },
    },
  },
};

/**
 * Fixed Ratio Isolation Test Config.
 * Tests that non-flexible ratios are not affected by load on other job types.
 */
export const fixedRatioConfig: RateLimiterPreset = {
  models: {
    'test-model': {
      tokensPerMinute: FIXED_RATIO_TPM,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
  },
  escalationOrder: ['test-model'],
  resourceEstimations: {
    fixedJobType: {
      estimatedUsedTokens: FIXED_RATIO_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FORTY_PERCENT, flexible: false },
    },
    flexibleJobTypeA: {
      estimatedUsedTokens: FIXED_RATIO_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_PERCENT, flexible: true },
    },
    flexibleJobTypeB: {
      estimatedUsedTokens: FIXED_RATIO_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_PERCENT, flexible: true },
    },
  },
};

/**
 * Flexible Ratio Adjustment Test Config.
 * Tests that flexible job types adjust ratios based on load.
 */
export const flexibleRatioConfig: RateLimiterPreset = {
  models: {
    'flex-model': {
      tokensPerMinute: FLEX_TPM,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
  },
  escalationOrder: ['flex-model'],
  resourceEstimations: {
    flexJobA: {
      estimatedUsedTokens: FLEX_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRD, flexible: true },
    },
    flexJobB: {
      estimatedUsedTokens: FLEX_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRD, flexible: true },
    },
    flexJobC: {
      estimatedUsedTokens: FLEX_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRD, flexible: true },
    },
  },
};

/**
 * Instance Scaling Test Config.
 * Simple config for testing instance join/leave behavior.
 */
export const instanceScalingConfig: RateLimiterPreset = {
  models: {
    'scale-model': {
      tokensPerMinute: SCALE_TPM,
      pricing: {
        input: PRICING_INPUT_STANDARD,
        cached: PRICING_CACHED_STANDARD,
        output: PRICING_OUTPUT_STANDARD,
      },
    },
  },
  escalationOrder: ['scale-model'],
  resourceEstimations: {
    scaleJob: {
      estimatedUsedTokens: SCALE_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};
