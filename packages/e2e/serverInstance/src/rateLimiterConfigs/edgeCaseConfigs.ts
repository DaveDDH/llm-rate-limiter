/**
 * Configuration presets for edge case E2E tests (Test 47).
 * Floor rounding, zero slots, memory constraints, fixed/flexible types.
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICING_INPUT = 1;
const PRICING_CACHED = 0.1;
const PRICING_OUTPUT = 2;

const standardPricing = { input: PRICING_INPUT, cached: PRICING_CACHED, output: PRICING_OUTPUT };

// Request counts
const REQUESTS_SINGLE = 1;

// Ratio constants
const RATIO_FULL = 1.0;
const RATIO_HALF = 0.5;
const RATIO_NINETY = 0.9;
const RATIO_TEN = 0.1;

// Capacity constants
const TPM_15K = 15000;
const TPM_20K = 20000;
const TPM_100K = 100000;
const TPM_1M = 1000000;
const TOKENS_10K = 10000;

// Memory constants (KB)
const MEMORY_5MB_KB = 5120;
const MEMORY_10MB_KB = 10240;
const MEMORY_100MB_KB = 102400;
const MEMORY_200MB_KB = 204800;
const FREE_MEMORY_RATIO = 1.0;

// maxWaitMS
const MAX_WAIT_60S = 60000;

/**
 * 47.2: Floor rounding edge case.
 * TPM=20K, jobTypeA ratio=0.1, jobTypeB ratio=0.9.
 */
export const highestEdgeFloorConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_20K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_TEN },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
    jobTypeB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_NINETY },
    },
  },
};

/**
 * 47.1: Edge case - zero slots after division.
 * TPM=15K, tokens=10K, 4 instances -> 0 slots each.
 */
export const highestEdgeZeroSlotsConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_15K, pricing: standardPricing },
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
 * 47.3: Zero memory slots.
 * maxMemoryKB=5MB (5120KB), estimatedUsedMemoryKB=10MB (10240KB).
 * Memory slots = floor(5120 / 10240) = 0.
 * TPM=1M so distributed slots are not the bottleneck.
 */
export const highestEdgeZeroMemoryConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_1M, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_10MB_KB,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
  },
  memory: { maxMemoryKB: MEMORY_5MB_KB, freeMemoryRatio: FREE_MEMORY_RATIO },
};

/**
 * 47.4: Very large memory estimate.
 * maxMemoryKB=100MB (102400KB), estimatedUsedMemoryKB=200MB (204800KB).
 * Memory slots = floor(102400 / 204800) = 0.
 * TPM=1M so distributed slots are not the bottleneck.
 */
export const highestEdgeLargeMemoryConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_1M, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_200MB_KB,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
  },
  memory: { maxMemoryKB: MEMORY_100MB_KB, freeMemoryRatio: FREE_MEMORY_RATIO },
};

/**
 * 47.7: Only fixed job types (no adjustment possible).
 */
export const highestEdgeAllFixedConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_100K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    fixedA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF, flexible: false },
    },
    fixedB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_HALF, flexible: false },
    },
  },
};

/**
 * 47.8: Single flexible job type (no self-transfer).
 */
export const highestEdgeSingleFlexConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_100K, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    flexibleOnly: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL, flexible: true },
    },
  },
};
