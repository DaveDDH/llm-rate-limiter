/**
 * Helper functions and constants for time window handling tests (27.1-27.4).
 *
 * Config: high-timeWindow
 * - model-alpha: TPM=100K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 1 instance: floor(100K / 10K / 1) = 10 slots
 *
 * These tests verify time-window-aware refund/overage behavior.
 */
import { bootInstance, cleanRedis, killAllInstances, waitForAllocationUpdate } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;

// Instance constants
export const INSTANCE_PORT = 3001;
export const INSTANCE_URL = `http://localhost:${INSTANCE_PORT}`;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'high-timeWindow';

// Model and job type identifiers
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Capacity constants (from config)
export const TPM_LIMIT = 100000;
export const ESTIMATED_TOKENS = 10000;
export const TOTAL_SLOTS = 10;

// Test constants
export const ACTUAL_TOKENS = 6000;
export const EXPECTED_REFUND = 4000;
export const ZERO_COUNT = 0;
export const ZERO_OUTPUT_TOKENS = 0;

// Timing for window boundary tests
export const ONE_MINUTE_MS = 60000;
export const FIFTY_FIVE_SECONDS_MS = 55000;
export const FIFTY_NINE_SECONDS_MS = 59000;
export const ONE_MS = 1;
export const MARGIN_MS = 500;

// Shared constants
export const HTTP_ACCEPTED = 202;
export const SHORT_JOB_DURATION_MS = 100;
export const VERY_SHORT_JOB_DURATION_MS = 50;
export const JOB_COMPLETE_TIMEOUT_MS = 10000;
export const SINGLE_INSTANCE_COUNT = 1;

/** Model counter stats from the stats endpoint */
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

/** Fetch stats from an instance */
export const fetchStats = async (baseUrl: string): Promise<StatsResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/stats`);
  const data: unknown = await response.json();
  if (!isStatsResponse(data)) {
    throw new Error('Invalid stats response');
  }
  return data;
};

/** Get TPM counter for a model */
export const getTokensPerMinute = (stats: StatsResponse, modelId: string): ModelCounterStats | undefined =>
  stats.stats.models[modelId]?.tokensPerMinute;

/** Get RPM counter for a model */
export const getRequestsPerMinute = (stats: StatsResponse, modelId: string): ModelCounterStats | undefined =>
  stats.stats.models[modelId]?.requestsPerMinute;

/** Options for submitting a job */
export interface SubmitJobOptions {
  baseUrl: string;
  jobId: string;
  jobType: string;
  durationMs: number;
  extraPayload?: Record<string, unknown>;
}

/** Submit a job with optional actual usage overrides */
export const submitJob = async (options: SubmitJobOptions): Promise<number> => {
  const { baseUrl, jobId, jobType, durationMs, extraPayload } = options;
  const response = await fetch(`${baseUrl}/api/queue-job`, {
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

/** Boot a single instance with the given config preset */
export const setupSingleInstance = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT, configPreset);
  await waitForAllocationUpdate(
    INSTANCE_PORT,
    (allocation) => allocation.instanceCount === SINGLE_INSTANCE_COUNT
  );
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Poll until no active jobs remain */
const pollUntilNoActiveJobs = async (
  baseUrl: string,
  startTime: number,
  timeoutMs: number
): Promise<void> => {
  if (Date.now() - startTime >= timeoutMs) {
    throw new Error('Timeout waiting for job to complete');
  }

  const response = await fetch(`${baseUrl}/api/debug/active-jobs`);
  const data: unknown = await response.json();

  if (isActiveJobsResponse(data) && data.count === ZERO_COUNT) {
    return;
  }

  await sleep(POLL_INTERVAL_MS);
  await pollUntilNoActiveJobs(baseUrl, startTime, timeoutMs);
};

/** Wait for all active jobs to complete */
export const waitForJobComplete = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  await pollUntilNoActiveJobs(baseUrl, Date.now(), timeoutMs);
};

/** Get current time window start (start of current minute) */
export const getCurrentWindowStart = (): number => {
  const now = Date.now();
  return now - (now % ONE_MINUTE_MS);
};

/** Calculate milliseconds until next minute boundary */
export const getMillisecondsUntilNextMinute = (): number => {
  const now = Date.now();
  return ONE_MINUTE_MS - (now % ONE_MINUTE_MS);
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
