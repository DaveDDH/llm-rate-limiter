/**
 * Configuration presets for local ratio distribution tests (2.1–2.6).
 *
 * All configs use single-instance deployment so totalSlots = floor(TPM / avgTokens / 1).
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICING_INPUT_STANDARD = 1;
const PRICING_CACHED_STANDARD = 0.1;
const PRICING_OUTPUT_STANDARD = 2;

// Request count
const REQUESTS_SINGLE = 1;

// Token constants
const TPM_100K = 100000;
const TOKENS_10K = 10000;
const TOKENS_1K = 1000;

// Ratio constants for two-type config (test 2.1)
const RATIO_SIXTY_PERCENT = 0.6;
const RATIO_FORTY_PERCENT = 0.4;

// Ratio constants for three-type config (test 2.2)
const RATIO_HALF = 0.5;
const RATIO_THIRTY_PERCENT = 0.3;
const RATIO_TWENTY_PERCENT = 0.2;

// Ratio constants for equal-three config (test 2.3)
const RATIO_THIRTY_THREE_PERCENT = 0.33;
const RATIO_THIRTY_FOUR_PERCENT = 0.34;

// Ratio constants for zero-alloc config (test 2.6)
const RATIO_NINETY_NINE_PERCENT = 0.99;
const RATIO_ONE_PERCENT = 0.01;
const MIN_JOB_TYPE_CAPACITY_ZERO = 0;

const STANDARD_PRICING = {
  input: PRICING_INPUT_STANDARD,
  cached: PRICING_CACHED_STANDARD,
  output: PRICING_OUTPUT_STANDARD,
};

const MODEL_ALPHA_TPM = {
  'model-alpha': {
    tokensPerMinute: TPM_100K,
    pricing: STANDARD_PRICING,
  },
};

/**
 * Test 2.1: Two job types with exact ratio split.
 * totalSlots = floor(100K / 10K / 1) = 10
 * jobTypeA: floor(10 * 0.6) = 6, jobTypeB: floor(10 * 0.4) = 4
 */
export const localRatioTwoTypesConfig: RateLimiterPreset = {
  models: MODEL_ALPHA_TPM,
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_SIXTY_PERCENT },
    },
    jobTypeB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FORTY_PERCENT },
    },
  },
};

/**
 * Test 2.2: Three job types that sum to totalSlots.
 * totalSlots = floor(100K / 1K / 1) = 100
 * jobTypeA: floor(100 * 0.5) = 50
 * jobTypeB: floor(100 * 0.3) = 30
 * jobTypeC: floor(100 * 0.2) = 20
 */
export const localRatioThreeTypesConfig: RateLimiterPreset = {
  models: MODEL_ALPHA_TPM,
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_1K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF },
    },
    jobTypeB: {
      estimatedUsedTokens: TOKENS_1K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_PERCENT },
    },
    jobTypeC: {
      estimatedUsedTokens: TOKENS_1K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_TWENTY_PERCENT },
    },
  },
};

/**
 * Test 2.3: Floor division with remainders.
 * totalSlots = floor(100K / 10K / 1) = 10
 * jobTypeA: floor(10 * 0.33) = 3
 * jobTypeB: floor(10 * 0.33) = 3
 * jobTypeC: floor(10 * 0.34) = 3
 */
export const localRatioEqualThreeConfig: RateLimiterPreset = {
  models: MODEL_ALPHA_TPM,
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_THREE_PERCENT },
    },
    jobTypeB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_THREE_PERCENT },
    },
    jobTypeC: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_FOUR_PERCENT },
    },
  },
};

/**
 * Test 2.6: Zero allocation with minJobTypeCapacity = 0.
 * totalSlots = floor(100K / 10K / 1) = 10
 * jobTypeA: floor(10 * 0.99) = 9, jobTypeB: floor(10 * 0.01) = 0
 * With minJobTypeCapacity=0, jobTypeB stays at 0 allocated slots.
 */
export const localRatioZeroAllocConfig: RateLimiterPreset = {
  models: MODEL_ALPHA_TPM,
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_NINETY_NINE_PERCENT },
    },
    jobTypeB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_ONE_PERCENT },
    },
  },
  ratioAdjustmentConfig: {
    minJobTypeCapacity: MIN_JOB_TYPE_CAPACITY_ZERO,
  },
};
