/**
 * Type definitions for availability tracking and change callbacks.
 *
 * These types support monitoring rate limiter capacity and resource availability
 * across all configured limits (tokens, requests, memory, concurrency).
 */

// =============================================================================
// Availability Types
// =============================================================================

/** Literal type for zero (used in RelativeAvailabilityAdjustment) */
// eslint incorrectly flags this as magic number but it's a type literal definition
type ZeroLiteral = (readonly [])['length'];

/** Current availability across all limiters */
export interface Availability {
  /** Number of jobs that can be executed (minimum across all limiters) */
  slots: number;
  /** Available tokens per minute (remaining), null if not configured */
  tokensPerMinute: number | null;
  /** Available tokens per day (remaining), null if not configured */
  tokensPerDay: number | null;
  /** Available requests per minute (remaining), null if not configured */
  requestsPerMinute: number | null;
  /** Available requests per day (remaining), null if not configured */
  requestsPerDay: number | null;
  /** Available concurrent request slots, null if not configured */
  concurrentRequests: number | null;
  /** Available memory in KB, null if not configured */
  memoryKB: number | null;
}

/** Reason for availability change (in priority order: first applicable wins) */
export type AvailabilityChangeReason =
  | 'adjustment' // Job used different resources than reserved
  | 'tokensMinute' // TPM changed (reservation, refund, or window reset)
  | 'tokensDay' // TPD changed
  | 'requestsMinute' // RPM changed
  | 'requestsDay' // RPD changed
  | 'concurrentRequests' // Concurrency changed
  | 'memory' // Memory changed
  | 'distributed'; // Distributed backend availability update

/** Relative adjustment values (actual - reserved). Only provided when reason is 'adjustment'. */
export interface RelativeAvailabilityAdjustment {
  /** Token difference (actual - reserved). Negative = fewer used than reserved */
  tokensPerMinute: number;
  /** Token difference (actual - reserved). Negative = fewer used than reserved */
  tokensPerDay: number;
  /** Request difference (actual - reserved). Negative = fewer used than reserved */
  requestsPerMinute: number;
  /** Request difference (actual - reserved). Negative = fewer used than reserved */
  requestsPerDay: number;
  /** Always 0 for adjustment (memory is not adjusted post-job) */
  memoryKB: ZeroLiteral;
  /** Always 0 for adjustment (concurrency is not adjusted post-job) */
  concurrentRequests: ZeroLiteral;
}

/** Callback triggered when available slots change */
export type OnAvailableSlotsChange = (
  availability: Availability,
  reason: AvailabilityChangeReason,
  modelId: string,
  adjustment?: RelativeAvailabilityAdjustment
) => void;

/** Availability from distributed backend (memory and concurrency are local-only) */
export interface DistributedAvailability {
  /** Number of jobs that can be executed */
  slots: number;
  /** Available tokens per minute (remaining), null if not tracked */
  tokensPerMinute?: number | null;
  /** Available tokens per day (remaining), null if not tracked */
  tokensPerDay?: number | null;
  /** Available requests per minute (remaining), null if not tracked */
  requestsPerMinute?: number | null;
  /** Available requests per day (remaining), null if not tracked */
  requestsPerDay?: number | null;
}
