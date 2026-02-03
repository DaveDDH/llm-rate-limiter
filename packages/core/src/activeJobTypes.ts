/**
 * Types for active job tracking in the LLM Rate Limiter.
 */

/**
 * Status of an active job in the rate limiter.
 * - 'waiting-for-capacity': Job is waiting for job type slot (before model selection)
 * - 'waiting-for-model': Job is waiting for a specific model to have capacity (with timeout)
 * - 'processing': Job is currently being executed on a model
 */
export type ActiveJobStatus = 'waiting-for-capacity' | 'waiting-for-model' | 'processing';

/**
 * Information about an active job in the rate limiter queue.
 * Used for debugging and testing to inspect queue state.
 */
export interface ActiveJobInfo {
  /** Unique identifier for this job */
  jobId: string;
  /** Job type for capacity allocation */
  jobType: string;
  /** Current status of the job */
  status: ActiveJobStatus;
  /** Timestamp when job entered queueJob() (ms since epoch) */
  queuedAt: number;
  /** Timestamp when processing started (ms since epoch), null if not yet processing */
  startedAt: number | null;
  /** Model currently being tried or used, null if waiting for capacity */
  currentModelId: string | null;
  /** Models that have already been attempted */
  triedModels: string[];
  /** When wait for current model started (ms since epoch) */
  waitStartedAt: number | null;
  /** Max wait time for current model (ms) */
  maxWaitMS: number | null;
  /** Calculated timeout deadline: waitStartedAt + maxWaitMS */
  timeoutAt: number | null;
}
