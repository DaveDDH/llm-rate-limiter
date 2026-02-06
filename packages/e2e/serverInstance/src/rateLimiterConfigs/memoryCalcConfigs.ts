/**
 * Memory slot calculation test configurations.
 * Used by memorySlotCalculation.test.ts (tests 3.1-3.6).
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICING_INPUT = 1;
const PRICING_CACHED = 0.1;
const PRICING_OUTPUT = 2;

// Request counts
const REQUESTS_SINGLE = 1;

// Ratio constants
const RATIO_FULL = 1.0;
const RATIO_SEVENTY_PERCENT = 0.7;
const RATIO_HALF = 0.5;
const RATIO_THIRTY_PERCENT = 0.3;
const FREE_MEMORY_RATIO_FULL = 1.0;
const FREE_MEMORY_RATIO_80_PERCENT = 0.8;
const MIN_JOB_TYPE_CAPACITY_ZERO = 0;

// TPM constants
const HIGH_TPM = 10_000_000;
const MEDIUM_TPM = 1_000_000;
const LOW_TPM = 10_000;
const STANDARD_TPM = 100_000;

// Token constants
const LOW_TOKENS = 1000;
const STANDARD_TOKENS = 10_000;

// Memory constants (in KB)
const MEMORY_10MB_KB = 10_240;
const MEMORY_5MB_KB = 5_120;
const MEMORY_ZERO_KB = 0;

const standardPricing = {
  input: PRICING_INPUT,
  cached: PRICING_CACHED,
  output: PRICING_OUTPUT,
};

/**
 * Test 3.1: Memory Slots Calculated Exactly
 *
 * Instance memory: 100MB (102,400 KB)
 * jobTypeA: estimatedMemoryKB = 10,240 (10MB), ratio = 0.5
 * jobTypeB: estimatedMemoryKB = 5,120 (5MB), ratio = 0.5
 *
 * Expected: jobTypeA memory slots = 5, jobTypeB memory slots = 10
 */
export const memCalcBasicConfig: RateLimiterPreset = {
  models: {
    'mem-model': {
      tokensPerMinute: HIGH_TPM,
      pricing: standardPricing,
    },
  },
  escalationOrder: ['mem-model'],
  memory: { freeMemoryRatio: FREE_MEMORY_RATIO_FULL },
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: LOW_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_10MB_KB,
      ratio: { initialValue: RATIO_HALF },
    },
    jobTypeB: {
      estimatedUsedTokens: LOW_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_5MB_KB,
      ratio: { initialValue: RATIO_HALF },
    },
  },
};

/**
 * Test 3.2: Memory is Minimum Constraint
 *
 * model: TPM = 1,000,000
 * jobTypeA: estimatedTokens = 10,000, estimatedMemoryKB = 10,240 (10MB)
 * instanceCount = 2, Instance memory = 50MB
 *
 * Distributed slots = floor((1M / 10K) / 2) = 50
 * Memory slots = floor(50MB / 10MB) = 5
 * Final = min(50, 5) = 5 (memory limiting)
 */
export const memCalcMemoryWinsConfig: RateLimiterPreset = {
  models: {
    'mem-model': {
      tokensPerMinute: MEDIUM_TPM,
      pricing: standardPricing,
    },
  },
  escalationOrder: ['mem-model'],
  memory: { freeMemoryRatio: FREE_MEMORY_RATIO_FULL },
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: STANDARD_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_10MB_KB,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};

/**
 * Test 3.3: Distributed Wins When Lower
 *
 * model: TPM = 10,000
 * jobTypeA: estimatedTokens = 10,000, estimatedMemoryKB = 10,240 (10MB)
 * instanceCount = 2, Instance memory = 500MB
 *
 * Distributed slots = floor((10K / 10K) / 2) = 0
 * Memory slots = floor(500MB / 10MB) = 50
 * Final = min(0, 50) = 0 (distributed limiting)
 */
export const memCalcDistributedWinsConfig: RateLimiterPreset = {
  models: {
    'mem-model': {
      tokensPerMinute: LOW_TPM,
      pricing: standardPricing,
    },
  },
  escalationOrder: ['mem-model'],
  memory: { freeMemoryRatio: FREE_MEMORY_RATIO_FULL },
  ratioAdjustmentConfig: { minJobTypeCapacity: MIN_JOB_TYPE_CAPACITY_ZERO },
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: STANDARD_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_10MB_KB,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};

/**
 * Test 3.4: Ratios Distribute Memory Correctly
 *
 * Instance memory: 100MB
 * jobTypeA: estimatedMemoryKB = 10MB, ratio = 0.7
 * jobTypeB: estimatedMemoryKB = 10MB, ratio = 0.3
 *
 * jobTypeA memory allocation = 70MB → slots = 7
 * jobTypeB memory allocation = 30MB → slots = 3
 */
export const memCalcRatiosConfig: RateLimiterPreset = {
  models: {
    'mem-model': {
      tokensPerMinute: HIGH_TPM,
      pricing: standardPricing,
    },
  },
  escalationOrder: ['mem-model'],
  memory: { freeMemoryRatio: FREE_MEMORY_RATIO_FULL },
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: LOW_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_10MB_KB,
      ratio: { initialValue: RATIO_SEVENTY_PERCENT },
    },
    jobTypeB: {
      estimatedUsedTokens: LOW_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_10MB_KB,
      ratio: { initialValue: RATIO_THIRTY_PERCENT },
    },
  },
};

/**
 * Test 3.5: Zero Memory Estimate Disables Memory Limiting
 *
 * model: TPM = 100,000
 * jobTypeA: estimatedMemoryKB = 0, estimatedTokens = 10,000
 * instanceCount = 1, Distributed slots = 10
 *
 * Memory is not a limiting factor when estimatedMemoryKB = 0
 */
export const memCalcZeroMemoryConfig: RateLimiterPreset = {
  models: {
    'mem-model': {
      tokensPerMinute: STANDARD_TPM,
      pricing: standardPricing,
    },
  },
  escalationOrder: ['mem-model'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: STANDARD_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_ZERO_KB,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};

/**
 * Test 3.6: freeMemoryRatio Respected
 *
 * model: TPM = 10,000,000
 * memory.freeMemoryRatio = 0.8
 * jobTypeA: estimatedMemoryKB = 10,240 (10MB)
 * Instance free memory: 100MB
 *
 * Usable memory (80%) = 80MB
 * Memory-based slots = 8 (not 10)
 */
export const memCalcFreeRatioConfig: RateLimiterPreset = {
  models: {
    'mem-model': {
      tokensPerMinute: HIGH_TPM,
      pricing: standardPricing,
    },
  },
  escalationOrder: ['mem-model'],
  memory: { freeMemoryRatio: FREE_MEMORY_RATIO_80_PERCENT },
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: LOW_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_10MB_KB,
      ratio: { initialValue: RATIO_FULL },
    },
  },
};
