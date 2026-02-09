/**
 * Helper functions and constants for distributed graceful degradation tests (Test 42).
 *
 * Config: high-distributedBasic
 * - model-alpha: TPM=100K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 2 instances: floor(100K/10K/2) = 5 slots per instance
 */
import {
  type AllocationResponse,
  bootInstance,
  cleanRedis,
  fetchAllocation,
  killAllInstances,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;

// Port constants
export const PORT_A = 4001;
export const PORT_B = 4002;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'high-distributedBasic';

// Model identifier
export const MODEL_ID = 'model-alpha';

// Job type
export const JOB_TYPE = 'jobTypeA';

// Instance counts
export const TWO_INSTANCES = 2;

// Slot counts
export const TEN_SLOTS = 10;
export const FIVE_SLOTS = 5;

// Timing
export const SHORT_JOB_DURATION_MS = 100;
export const LONG_JOB_DURATION_MS = 5000;
export const JOB_COMPLETE_TIMEOUT_MS = 10000;
export const CONVERGENCE_TIMEOUT_MS = 15000;

// HTTP status
export const HTTP_ACCEPTED = 202;

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;

/** Token counter stats from the stats endpoint */
export interface ModelCounterStats {
  current: number;
  limit: number;
  remaining?: number;
}

/** Per-model stats */
export interface ModelStats {
  tokensPerMinute?: ModelCounterStats;
  requestsPerMinute?: ModelCounterStats;
  concurrency?: { active: number; limit: number | null; available: number | null };
}

/** Stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<string, ModelStats>;
  };
}

/** Active jobs response */
interface ActiveJobsResponse {
  count: number;
}

/** Type guard for StatsResponse */
const isStatsResponse = (value: unknown): value is StatsResponse => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return 'stats' in value && 'instanceId' in value;
};

/** Type guard for ActiveJobsResponse */
const isActiveJobsResponse = (value: unknown): value is ActiveJobsResponse =>
  typeof value === 'object' && value !== null && 'count' in value;

/**
 * Get model slots from allocation response
 */
export const getModelSlots = (response: AllocationResponse): number | undefined => {
  const pools = response.allocation?.pools;
  if (pools === undefined) {
    return undefined;
  }
  return pools[MODEL_ID]?.totalSlots;
};

/**
 * Fetch stats from an instance
 */
export const fetchStats = async (port: number): Promise<StatsResponse> => {
  const response = await fetch(`http://localhost:${port}/api/debug/stats`);
  const data: unknown = await response.json();
  if (!isStatsResponse(data)) {
    throw new Error('Invalid stats response');
  }
  return data;
};

/**
 * Get TPM counter for a model
 */
export const getTokensPerMinute = (stats: StatsResponse, modelId: string): ModelCounterStats | undefined =>
  stats.stats.models[modelId]?.tokensPerMinute;

/** Options for submitting a job */
export interface SubmitJobOptions {
  port: number;
  jobId: string;
  jobType: string;
  durationMs: number;
  extraPayload?: Record<string, unknown>;
}

/**
 * Submit a job to an instance
 */
export const submitJob = async (options: SubmitJobOptions): Promise<number> => {
  const { port, jobId, jobType, durationMs, extraPayload } = options;
  const response = await fetch(`http://localhost:${port}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType,
      payload: { durationMs, ...extraPayload },
    }),
  });
  return response.status;
};

/**
 * Setup two instance test
 */
export const setupTwoInstanceTest = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, CONFIG_PRESET);
  await bootInstance(PORT_B, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/**
 * Poll until no active jobs remain (recursive)
 */
const pollUntilNoActiveJobs = async (port: number, startTime: number, timeoutMs: number): Promise<void> => {
  const zeroCount = 0;
  if (Date.now() - startTime >= timeoutMs) {
    throw new Error('Timeout waiting for job to complete');
  }

  const response = await fetch(`http://localhost:${port}/api/debug/active-jobs`);
  const data: unknown = await response.json();

  if (isActiveJobsResponse(data) && data.count === zeroCount) {
    return;
  }

  await sleep(POLL_INTERVAL_MS);
  await pollUntilNoActiveJobs(port, startTime, timeoutMs);
};

/**
 * Wait for all active jobs to complete on an instance
 */
export const waitForJobComplete = async (port: number, timeoutMs: number): Promise<void> => {
  await pollUntilNoActiveJobs(port, Date.now(), timeoutMs);
};

// Re-export for convenience
export { killAllInstances, fetchAllocation, sleep };
