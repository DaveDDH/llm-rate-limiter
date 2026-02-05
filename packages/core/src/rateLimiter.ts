/**
 * LLM Rate Limiter - supports memory, RPM, RPD, TPM, TPD, and concurrent request limits.
 * All limits are optional - only defined limits are enforced.
 *
 * Features:
 * - Pre-reserves estimated resources before job execution
 * - Tracks actual usage after job execution and refunds the difference
 * - Strict compile-time type safety for resourcesPerEvent requirements
 */
import type { InternalLimiterConfig, InternalLimiterInstance } from './types.js';
import { LLMRateLimiterInternal } from './utils/rateLimiterInternalClass.js';

export type {
  TokenUsage,
  InternalJobResult,
  MemoryLimitConfig,
  InternalLimiterConfig,
  InternalLimiterStats,
  InternalLimiterInstance,
  BaseResourcesPerEvent,
  JobWindowStarts,
  ReservationContext,
  OverageEvent,
  OverageResourceType,
  OverageFn,
} from './types.js';

/**
 * Create a new internal LLM Rate Limiter instance.
 * This is used internally by the multi-model rate limiter.
 *
 * Resource estimates (tokens, requests, memory) are defined at the job type level
 * via resourcesPerJob in the multi-model limiter configuration.
 */
export const createInternalLimiter = (config: InternalLimiterConfig): InternalLimiterInstance =>
  new LLMRateLimiterInternal(config);
