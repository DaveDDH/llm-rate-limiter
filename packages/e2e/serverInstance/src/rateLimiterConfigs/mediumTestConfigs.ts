/**
 * Configuration presets for medium complexity E2E tests (9-16).
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
const RATIO_SIXTY_PERCENT = 0.6;
const RATIO_FORTY_PERCENT = 0.4;
const RATIO_THIRTY_FIVE_PERCENT = 0.35;
const RATIO_THIRTY_PERCENT = 0.3;

// Capacity constants
const TPM_10K = 10000;
const TPM_10M = 10000000;
const TOKENS_10K = 10000;
const MAX_CONCURRENT_5 = 5;
const MAX_CONCURRENT_10 = 10;

// Memory constants
const MEMORY_MAX_KB = 102400;
const MEMORY_ESTIMATED_KB = 51200;
const FREE_MEMORY_RATIO = 1.0;

// maxWaitMS constants
const MAX_WAIT_ZERO = 0;
const MAX_WAIT_2S = 2000;
const MAX_WAIT_5S = 5000;
const MAX_WAIT_10S = 10000;
const MAX_WAIT_30S = 30000;
const MAX_WAIT_60S = 60000;
const MAX_WAIT_1S = 1000;
const MAX_CONCURRENT_1 = 1;

const standardPricing = { input: PRICING_INPUT, cached: PRICING_CACHED, output: PRICING_OUTPUT };

/**
 * maxWaitMS=0 two-model escalation. model-primary + model-secondary.
 * 1 instance: floor(10K/10K/1) = 1 slot per model.
 */
export const mediumMaxWaitTwoModelConfig: RateLimiterPreset = {
  models: {
    'model-primary': {
      tokensPerMinute: TPM_10K,
      maxConcurrentRequests: MAX_CONCURRENT_1,
      pricing: standardPricing,
    },
    'model-secondary': { maxConcurrentRequests: MAX_CONCURRENT_10, pricing: standardPricing },
  },
  escalationOrder: ['model-primary', 'model-secondary'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-primary': MAX_WAIT_ZERO },
    },
  },
};

/**
 * maxWaitMS=0 single-model (no fallback).
 * 1 instance: floor(10K/10K/1) = 1 slot.
 */
export const mediumMaxWaitSingleModelConfig: RateLimiterPreset = {
  models: {
    'model-only': {
      tokensPerMinute: TPM_10K,
      maxConcurrentRequests: MAX_CONCURRENT_1,
      pricing: standardPricing,
    },
  },
  escalationOrder: ['model-only'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-only': MAX_WAIT_ZERO },
    },
  },
};

/**
 * Explicit maxWaitMS=5000 for model-alpha, escalation to model-beta.
 * model-alpha: 1 slot (bottleneck), model-beta: 10 concurrent (fallback).
 */
export const mediumMaxWaitExplicitConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: TPM_10K,
      maxConcurrentRequests: MAX_CONCURRENT_1,
      pricing: standardPricing,
    },
    'model-beta': { maxConcurrentRequests: MAX_CONCURRENT_10, pricing: standardPricing },
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

/**
 * maxWaitMS=2000 timeout with escalation to model-beta.
 * 1 instance: floor(10K/10K/1) = 1 slot per model.
 */
export const mediumMaxWaitTimeoutConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: TPM_10K,
      maxConcurrentRequests: MAX_CONCURRENT_1,
      pricing: standardPricing,
    },
    'model-beta': { maxConcurrentRequests: MAX_CONCURRENT_10, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha', 'model-beta'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_2S },
    },
  },
};

/**
 * maxWaitMS=30000 single model, job completes during wait.
 * 1 instance: floor(10K/10K/1) = 1 slot.
 */
export const mediumMaxWaitReleaseConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { maxConcurrentRequests: MAX_CONCURRENT_1, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_30S },
    },
  },
};

/**
 * Concurrent-based queue behavior: maxConcurrent=5, maxWaitMS=60s.
 * 1 instance: 5 concurrent slots.
 */
export const mediumQueueConcurrentConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { maxConcurrentRequests: MAX_CONCURRENT_5, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-alpha': MAX_WAIT_60S },
    },
  },
};

/**
 * Error + memory test: TPM=10M (no rate limit bottleneck), memory=100MB.
 * 1 instance: estimatedMemoryKB=51200 (50MB) → 2 memory slots.
 */
export const mediumErrorMemoryConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { tokensPerMinute: TPM_10M, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      estimatedUsedMemoryKB: MEMORY_ESTIMATED_KB,
      ratio: { initialValue: RATIO_FULL },
    },
  },
  memory: { maxMemoryKB: MEMORY_MAX_KB, freeMemoryRatio: FREE_MEMORY_RATIO },
};

/**
 * Fixed ratio protection: 2 types (fixed 0.4 + flexible 0.6).
 * 1 instance: floor(100K/10K/1)=10 total. fixed=4, flex=6.
 */
export const mediumFixedProtectionTwoTypeConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { maxConcurrentRequests: MAX_CONCURRENT_10, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    fixedType: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FORTY_PERCENT, flexible: false },
    },
    flexType: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_SIXTY_PERCENT, flexible: true },
    },
  },
};

/**
 * Fixed ratio protection: 3 types (fixed 0.3 + flexA 0.35 + flexB 0.35).
 * 1 instance: floor(100K/10K/1)=10 total. fixed=3, flexA=3, flexB=3.
 */
export const mediumFixedProtectionThreeTypeConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { maxConcurrentRequests: MAX_CONCURRENT_10, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    fixedType: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_PERCENT, flexible: false },
    },
    flexJobA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_FIVE_PERCENT, flexible: true },
    },
    flexJobB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_FIVE_PERCENT, flexible: true },
    },
  },
};

/**
 * Fixed ratio protection: multiple fixed types.
 * 1 instance: floor(100K/10K/1)=10 total. fixedA=3, fixedB=3, flexC=4.
 */
export const mediumFixedProtectionMultiFixedConfig: RateLimiterPreset = {
  models: {
    'model-alpha': { maxConcurrentRequests: MAX_CONCURRENT_10, pricing: standardPricing },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    fixedA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_PERCENT, flexible: false },
    },
    fixedB: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_PERCENT, flexible: false },
    },
    flexC: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FORTY_PERCENT, flexible: true },
    },
  },
};

/**
 * Per-model maxWaitMS: model-fast(1s), model-slow(10s), model-fallback.
 * 1 instance: floor(10K/10K/1) = 1 slot per model.
 */
export const mediumMaxWaitPerModelConfig: RateLimiterPreset = {
  models: {
    'model-fast': {
      tokensPerMinute: TPM_10K,
      maxConcurrentRequests: MAX_CONCURRENT_1,
      pricing: standardPricing,
    },
    'model-slow': {
      tokensPerMinute: TPM_10K,
      maxConcurrentRequests: MAX_CONCURRENT_1,
      pricing: standardPricing,
    },
    'model-fallback': { maxConcurrentRequests: MAX_CONCURRENT_10, pricing: standardPricing },
  },
  escalationOrder: ['model-fast', 'model-slow', 'model-fallback'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: TOKENS_10K,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_FULL },
      maxWaitMS: { 'model-fast': MAX_WAIT_1S, 'model-slow': MAX_WAIT_10S },
    },
  },
};
