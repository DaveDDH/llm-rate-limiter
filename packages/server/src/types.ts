/**
 * Type definitions for the server package.
 */

/**
 * Request body for the queue-job endpoint.
 */
export interface QueueJobRequestBody {
  /** Unique identifier for the job */
  jobId: string;
  /** Type of job (must match configured resourceEstimationsPerJob keys) */
  jobType: string;
  /** Payload data for the job */
  payload: Record<string, unknown>;
}

/**
 * Response for successfully queued job.
 */
export interface QueueJobResponse {
  /** Whether the job was accepted */
  success: boolean;
  /** The job ID */
  jobId: string;
  /** Message about the job status */
  message: string;
}

/**
 * Error response structure.
 */
export interface ErrorResponse {
  /** Whether the request was successful */
  success: false;
  /** Error message */
  error: string;
}

/**
 * Server configuration options.
 */
export interface ServerConfig {
  /** Primary port to try (default: 3000) */
  primaryPort?: number;
  /** Fallback port if primary is unavailable (default: 3001) */
  fallbackPort?: number;
  /** Redis URL for rate limiter backend (default: 'redis://localhost:6379') */
  redisUrl?: string;
  /** Key prefix for Redis (default: 'llm-rate-limiter:') */
  redisKeyPrefix?: string;
}

/**
 * Queued job stored in memory (for demo purposes).
 */
export interface QueuedJob {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
  queuedAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}
