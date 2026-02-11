/**
 * Helper functions and constants for multi-resource adjustment tests (26.1-26.2).
 *
 * Config: high-multiResource
 * - model-alpha: TPM=100K, RPM=500, TPD=1M, RPD=10K
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=5, ratio=1.0
 * - 1 instance
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
export const CONFIG_PRESET: ConfigPresetName = 'high-multiResource';

// Model and job type identifiers
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Capacity constants (from config)
export const TPM_LIMIT = 100000;
export const RPM_LIMIT = 500;
export const TPD_LIMIT = 1000000;
export const RPD_LIMIT = 10000;
export const ESTIMATED_TOKENS = 10000;
export const ESTIMATED_REQUESTS = 5;

// Test 26.1: All resources adjusted together
export const ACTUAL_TOKENS_PARTIAL = 6000;
export const ACTUAL_REQUESTS_PARTIAL = 3;
export const EXPECTED_TPM_REFUND = 4000;
export const EXPECTED_RPM_REFUND = 2;

// Test 26.2: Mixed refund and overage (config: high-multiResource-mixedOverage)
export const MIXED_OVERAGE_CONFIG: ConfigPresetName = 'high-multiResource-mixedOverage';
export const MIXED_OVERAGE_ESTIMATED_REQUESTS = 1;
export const MIXED_OVERAGE_ACTUAL_REQUESTS = 3;
export const ACTUAL_TOKENS_REFUND = 6000;
export const ACTUAL_REQUESTS_OVERAGE = MIXED_OVERAGE_ACTUAL_REQUESTS;
export const EXPECTED_TOKEN_REFUND = 4000;
export const EXPECTED_REQUEST_OVERAGE = 2;

// Shared constants
export const ZERO_COUNT = 0;
export const ZERO_OUTPUT_TOKENS = 0;
export const HTTP_ACCEPTED = 202;
export const SHORT_JOB_DURATION_MS = 100;
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
  tokensPerDay?: ModelCounterStats;
  requestsPerDay?: ModelCounterStats;
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

/** Get TPD counter for a model */
export const getTokensPerDay = (stats: StatsResponse, modelId: string): ModelCounterStats | undefined =>
  stats.stats.models[modelId]?.tokensPerDay;

/** Get RPD counter for a model */
export const getRequestsPerDay = (stats: StatsResponse, modelId: string): ModelCounterStats | undefined =>
  stats.stats.models[modelId]?.requestsPerDay;

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

/** Boot a single instance with the mixed overage config (estimatedRequests=1) */
export const setupMixedOverageInstance = async (): Promise<void> => {
  await setupSingleInstance(MIXED_OVERAGE_CONFIG);
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

/** Submit a job with partial actual usage and wait for completion */
export const submitPartialUsageJob = async (): Promise<void> => {
  const jobId = `multi-resource-partial-${Date.now()}`;
  const status = await submitJob({
    baseUrl: INSTANCE_URL,
    jobId,
    jobType: JOB_TYPE,
    durationMs: SHORT_JOB_DURATION_MS,
    extraPayload: {
      actualInputTokens: ACTUAL_TOKENS_PARTIAL,
      actualOutputTokens: ZERO_OUTPUT_TOKENS,
      actualRequestCount: ACTUAL_REQUESTS_PARTIAL,
    },
  });
  expect(status).toBe(HTTP_ACCEPTED);
  await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
};

/** Submit a job with mixed actual usage and wait for completion */
export const submitMixedUsageJob = async (): Promise<void> => {
  const jobId = `multi-resource-mixed-${Date.now()}`;
  const status = await submitJob({
    baseUrl: INSTANCE_URL,
    jobId,
    jobType: JOB_TYPE,
    durationMs: SHORT_JOB_DURATION_MS,
    extraPayload: {
      actualInputTokens: ACTUAL_TOKENS_REFUND,
      actualOutputTokens: ZERO_OUTPUT_TOKENS,
      actualRequestCount: ACTUAL_REQUESTS_OVERAGE,
    },
  });
  expect(status).toBe(HTTP_ACCEPTED);
  await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
