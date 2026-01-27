// Main factory function
export { createLLMRateLimiter } from './multiModelRateLimiter.js';

// Keep generic types from types.ts
export type { TokenUsage, MemoryLimitConfig } from './types.js';

// Public types from multiModelTypes.ts
export type {
  ArgsWithoutModelId,
  Availability,
  AvailabilityChangeReason,
  JobArgs,
  JobCallbackContext,
  JobRejectOptions,
  JobUsage,
  LLMJob,
  LLMJobResult,
  LLMRateLimiterConfig,
  LLMRateLimiterConfigBase,
  LLMRateLimiterInstance,
  LLMRateLimiterStats,
  ModelPricing,
  ModelRateLimitConfig,
  ModelsConfig,
  OnAvailableSlotsChange,
  QueueJobOptions,
  RelativeAvailabilityAdjustment,
  UsageEntry,
  UsageEntryWithCost,
  ValidatedLLMRateLimiterConfig,
} from './multiModelTypes.js';
