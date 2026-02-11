/**
 * Default configuration preset for E2E testing.
 */
import type { RateLimiterPreset } from './types.js';

// Provider-specific limits
const OPENAI_RPM = 500;
const OPENAI_TPM = 500000;
const OPENAI_PRICING_INPUT = 1.75;
const OPENAI_PRICING_CACHED = 0.175;
const OPENAI_PRICING_OUTPUT = 14;

const XAI_RPM = 480;
const XAI_TPM = 4000000;
const XAI_PRICING_INPUT = 0.2;
const XAI_PRICING_CACHED = 0.05;
const XAI_PRICING_OUTPUT = 0.5;

const DEEPINFRA_MAX_CONCURRENT = 200;
const DEEPINFRA_PRICING_INPUT = 0.03;
const DEEPINFRA_PRICING_CACHED = 0.03;
const DEEPINFRA_PRICING_OUTPUT = 0.14;

// Resource estimations
const DEFAULT_SUMMARY_TOKENS = 10000;
const DEFAULT_VACATION_TOKENS = 2000;
const DEFAULT_IMAGE_TOKENS = 5000;
const DEFAULT_BUDGET_TOKENS = 3000;
const DEFAULT_WEATHER_TOKENS = 1000;
const REQUESTS_SINGLE = 1;
const REQUESTS_TRIPLE = 3;
const REQUESTS_QUINTUPLE = 5;
const RATIO_THIRTY_PERCENT = 0.3;
const RATIO_FORTY_PERCENT = 0.4;

// Capacity Plus One test: openai TPM=140K → floor(140K/10K/1) = 14 slots (single instance)
const OPENAI_CPO_TPM = 140000;
const CPO_SUMMARY_TOKENS = 10000;
const CPO_REQUESTS_SINGLE = 1;
const CPO_RATIO_FULL = 1.0;

/**
 * Capacity Plus One config: single job type (summary) on openai with TPM=140K.
 * Single instance: floor(140K / 10K / 1) = 14 rate slots.
 * Other models preserved for escalation order but not used.
 */
export const capacityPlusOneConfig: RateLimiterPreset = {
  models: {
    'openai/gpt-5.2': {
      requestsPerMinute: OPENAI_RPM,
      tokensPerMinute: OPENAI_CPO_TPM,
      pricing: {
        input: OPENAI_PRICING_INPUT,
        cached: OPENAI_PRICING_CACHED,
        output: OPENAI_PRICING_OUTPUT,
      },
    },
    'xai/grok-4.1-fast': {
      requestsPerMinute: XAI_RPM,
      tokensPerMinute: XAI_TPM,
      pricing: {
        input: XAI_PRICING_INPUT,
        cached: XAI_PRICING_CACHED,
        output: XAI_PRICING_OUTPUT,
      },
    },
    'deepinfra/gpt-oss-20b': {
      maxConcurrentRequests: DEEPINFRA_MAX_CONCURRENT,
      pricing: {
        input: DEEPINFRA_PRICING_INPUT,
        cached: DEEPINFRA_PRICING_CACHED,
        output: DEEPINFRA_PRICING_OUTPUT,
      },
    },
  },
  escalationOrder: ['openai/gpt-5.2', 'xai/grok-4.1-fast', 'deepinfra/gpt-oss-20b'],
  resourceEstimations: {
    summary: {
      estimatedUsedTokens: CPO_SUMMARY_TOKENS,
      estimatedNumberOfRequests: CPO_REQUESTS_SINGLE,
      ratio: { initialValue: CPO_RATIO_FULL },
    },
  },
};

export const defaultConfig: RateLimiterPreset = {
  models: {
    'openai/gpt-5.2': {
      requestsPerMinute: OPENAI_RPM,
      tokensPerMinute: OPENAI_TPM,
      pricing: {
        input: OPENAI_PRICING_INPUT,
        cached: OPENAI_PRICING_CACHED,
        output: OPENAI_PRICING_OUTPUT,
      },
    },
    'xai/grok-4.1-fast': {
      requestsPerMinute: XAI_RPM,
      tokensPerMinute: XAI_TPM,
      pricing: {
        input: XAI_PRICING_INPUT,
        cached: XAI_PRICING_CACHED,
        output: XAI_PRICING_OUTPUT,
      },
    },
    'deepinfra/gpt-oss-20b': {
      maxConcurrentRequests: DEEPINFRA_MAX_CONCURRENT,
      pricing: {
        input: DEEPINFRA_PRICING_INPUT,
        cached: DEEPINFRA_PRICING_CACHED,
        output: DEEPINFRA_PRICING_OUTPUT,
      },
    },
  },
  escalationOrder: ['openai/gpt-5.2', 'xai/grok-4.1-fast', 'deepinfra/gpt-oss-20b'],
  resourceEstimations: {
    summary: {
      estimatedUsedTokens: DEFAULT_SUMMARY_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
      ratio: { initialValue: RATIO_THIRTY_PERCENT },
    },
    VacationPlanning: {
      estimatedUsedTokens: DEFAULT_VACATION_TOKENS,
      estimatedNumberOfRequests: REQUESTS_TRIPLE,
      ratio: { initialValue: RATIO_FORTY_PERCENT, flexible: false },
    },
    ImageCreation: {
      estimatedUsedTokens: DEFAULT_IMAGE_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
    },
    BudgetCalculation: {
      estimatedUsedTokens: DEFAULT_BUDGET_TOKENS,
      estimatedNumberOfRequests: REQUESTS_QUINTUPLE,
    },
    WeatherForecast: {
      estimatedUsedTokens: DEFAULT_WEATHER_TOKENS,
      estimatedNumberOfRequests: REQUESTS_SINGLE,
    },
  },
};
