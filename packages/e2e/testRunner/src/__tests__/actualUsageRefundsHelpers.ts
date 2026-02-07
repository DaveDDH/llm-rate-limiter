/**
 * Helper functions and constants for actual usage refund tests (Test 9).
 *
 * Config: slotCalc-tpm-single
 * - model-alpha: TPM=100K, RPM=1000
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=1, ratio=1.0
 * - 1 instance: floor(100K / 10K / 1) = 10 slots
 */
import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;

// Instance constants
export const INSTANCE_PORT = 3001;
export const INSTANCE_URL = `http://localhost:${INSTANCE_PORT}`;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'slotCalc-tpm-single';

// Model and job type identifiers
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Capacity constants (from config)
export const ESTIMATED_TOKENS = 10_000;
export const ESTIMATED_REQUESTS = 1;
export const TOTAL_SLOTS = 10;
export const FULL_TPM = 100_000;

// Test 9.1: Partial refund
export const ACTUAL_INPUT_TOKENS_PARTIAL = 4000;
export const ACTUAL_OUTPUT_TOKENS_PARTIAL = 2000;
export const ACTUAL_TOTAL_TOKENS_PARTIAL = 6000;

// Test 9.2: Full refund (zero actual)
export const ZERO_TOKENS = 0;
export const ZERO_REQUESTS = 0;

// Test 9.5: Multiple refund accumulation
export const JOB_A_INPUT = 3000;
export const JOB_A_OUTPUT = 1000;
export const JOB_A_TOTAL = 4000;
export const JOB_B_INPUT = 2000;
export const JOB_B_OUTPUT = 500;
export const JOB_B_TOTAL = 2500;
export const JOB_C_INPUT = 1000;
export const JOB_C_OUTPUT = 500;
export const JOB_C_TOTAL = 1500;
export const ACCUMULATED_TOTAL = 8000;

// Shared constants
export const ZERO_COUNT = 0;
export const HTTP_ACCEPTED = 202;
export const SHORT_JOB_DURATION_MS = 100;
export const LONG_JOB_DURATION_MS = 5000;
export const JOB_COMPLETE_TIMEOUT_MS = 10_000;
export const JOB_SETTLE_MS = 500;

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
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Poll until no active jobs remain (recursive) */
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

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
