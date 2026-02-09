/**
 * Helper functions and constants for distributed request count tracking tests (Test 34).
 *
 * Config presets:
 * - high-rpmTracking: TPM=100K, RPM=50
 * - high-tpmRpmTracking: TPM=1M, RPM=100, TPD=10M, RPD=1K
 */
import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;

// Port constants
export const PORT_A = 4001;
export const PORT_B = 4002;

// Model and job type identifiers
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Capacity constants for high-rpmTracking
export const RPM_TRACKING_TPM = 100000;
export const RPM_TRACKING_RPM = 50;
export const RPM_TRACKING_ESTIMATED_TOKENS = 10000;
export const RPM_TRACKING_ESTIMATED_REQUESTS = 2;

// Capacity constants for high-tpmRpmTracking
export const TPM_RPM_TRACKING_TPM = 1000000;
export const TPM_RPM_TRACKING_RPM = 100;
export const TPM_RPM_TRACKING_TPD = 10000000;
export const TPM_RPM_TRACKING_RPD = 1000;
export const TPM_RPM_TRACKING_ESTIMATED_TOKENS = 1000;
export const TPM_RPM_TRACKING_ESTIMATED_REQUESTS = 1;

// Test constants
export const TEN_JOBS = 10;
export const EIGHTY_JOBS = 80;
export const SHORT_JOB_DURATION_MS = 100;
export const HTTP_ACCEPTED = 202;
export const JOB_COMPLETE_TIMEOUT_MS = 20000;
export const TWO_INSTANCES = 2;

// Request count test values
export const REQUEST_COUNT_THREE = 3;
export const EXPECTED_TPM_EIGHT_K = 8000;
export const EXPECTED_RPM_THREE = 3;
export const JOBS_PER_INSTANCE = 5;

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;
export const TEST_TIMEOUT_MS = 90000;

/** Stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<string, ModelStats>;
  };
}

/** Per-model stats */
export interface ModelStats {
  tokensPerMinute?: CounterStats;
  requestsPerMinute?: CounterStats;
  tokensPerDay?: CounterStats;
  requestsPerDay?: CounterStats;
  concurrency?: ConcurrencyStats;
}

/** Counter stats */
export interface CounterStats {
  current: number;
  limit: number;
  remaining?: number;
}

/** Concurrency stats */
export interface ConcurrencyStats {
  active: number;
  limit: number | null;
  available: number | null;
}

// Zero constant
const ZERO_COUNT = 0;

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
export const fetchStats = async (port: number): Promise<StatsResponse> => {
  const response = await fetch(`http://localhost:${port}/api/debug/stats`);
  const data: unknown = await response.json();
  if (!isStatsResponse(data)) {
    throw new Error('Invalid stats response');
  }
  return data;
};

/** Get TPM counter for a model */
export const getTokensPerMinute = (stats: StatsResponse): CounterStats | undefined =>
  stats.stats.models[MODEL_ID]?.tokensPerMinute;

/** Get RPM counter for a model */
export const getRequestsPerMinute = (stats: StatsResponse): CounterStats | undefined =>
  stats.stats.models[MODEL_ID]?.requestsPerMinute;

/** Get TPD counter for a model */
export const getTokensPerDay = (stats: StatsResponse): CounterStats | undefined =>
  stats.stats.models[MODEL_ID]?.tokensPerDay;

/** Get RPD counter for a model */
export const getRequestsPerDay = (stats: StatsResponse): CounterStats | undefined =>
  stats.stats.models[MODEL_ID]?.requestsPerDay;

/** Options for submitting a job */
export interface SubmitJobOptions {
  port: number;
  jobId: string;
  durationMs: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  actualRequestCount?: number;
}

/** Submit a job with optional actual usage overrides */
export const submitJob = async (options: SubmitJobOptions): Promise<number> => {
  const { port, jobId, durationMs, actualInputTokens, actualOutputTokens, actualRequestCount } = options;
  const payload: Record<string, unknown> = { durationMs };
  if (actualInputTokens !== undefined) {
    payload.actualInputTokens = actualInputTokens;
  }
  if (actualOutputTokens !== undefined) {
    payload.actualOutputTokens = actualOutputTokens;
  }
  if (actualRequestCount !== undefined) {
    payload.actualRequestCount = actualRequestCount;
  }

  const response = await fetch(`http://localhost:${port}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType: JOB_TYPE,
      payload,
    }),
  });
  return response.status;
};

/** Boot two instances with the given config preset */
export const setupTwoInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, configPreset);
  await bootInstance(PORT_B, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Poll until no active jobs remain (recursive) */
const pollUntilNoActiveJobs = async (port: number, startTime: number, timeoutMs: number): Promise<void> => {
  if (Date.now() - startTime >= timeoutMs) {
    throw new Error('Timeout waiting for jobs to complete');
  }

  const response = await fetch(`http://localhost:${port}/api/debug/active-jobs`);
  const data: unknown = await response.json();

  if (isActiveJobsResponse(data) && data.count === ZERO_COUNT) {
    return;
  }

  await sleep(POLL_INTERVAL_MS);
  await pollUntilNoActiveJobs(port, startTime, timeoutMs);
};

/** Wait for all active jobs to complete */
export const waitForJobsComplete = async (port: number, timeoutMs: number): Promise<void> => {
  await pollUntilNoActiveJobs(port, Date.now(), timeoutMs);
};

// Job iteration constants
const TEN_JOBS_COUNT = 10;
const TEN_JOBS_THRESHOLD = 5;
const EIGHTY_JOBS_COUNT = 80;
const TOKEN_HALF_DIVISOR = 2;
const ONE_REQUEST = 1;

/** Submit a single job across instances and verify acceptance */
const submitCrossInstanceJob = async (
  index: number,
  tokenMultiplier: number,
  requestCount: number
): Promise<void> => {
  const port = index < TEN_JOBS_THRESHOLD ? PORT_A : PORT_B;
  const status = await submitJob({
    port,
    jobId: `rpm-separate-${index}`,
    durationMs: SHORT_JOB_DURATION_MS,
    actualInputTokens: RPM_TRACKING_ESTIMATED_TOKENS * tokenMultiplier,
    actualOutputTokens: RPM_TRACKING_ESTIMATED_TOKENS * tokenMultiplier,
    actualRequestCount: requestCount,
  });
  if (status !== HTTP_ACCEPTED) {
    throw new Error(`Job submission failed with status ${status}`);
  }
};

/** Submit 10 jobs with custom request count split across two instances */
export const submitTenJobsAcrossInstances = async (
  tokenMultiplier: number,
  requestCount: number
): Promise<void> => {
  await Promise.all(
    Array.from({ length: TEN_JOBS_COUNT }, async (_, i) => {
      await submitCrossInstanceJob(i, tokenMultiplier, requestCount);
    })
  );
};

/** Submit a single counter job and verify acceptance */
const submitCounterJob = async (port: number, index: number, estimatedTokens: number): Promise<void> => {
  const status = await submitJob({
    port,
    jobId: `all-counters-${index}`,
    durationMs: SHORT_JOB_DURATION_MS,
    actualInputTokens: estimatedTokens / TOKEN_HALF_DIVISOR,
    actualOutputTokens: estimatedTokens / TOKEN_HALF_DIVISOR,
    actualRequestCount: ONE_REQUEST,
  });
  if (status !== HTTP_ACCEPTED) {
    throw new Error(`Job submission failed with status ${status}`);
  }
};

/** Submit 80 jobs to a single instance */
export const submitEightyJobs = async (port: number, estimatedTokens: number): Promise<void> => {
  await Promise.all(
    Array.from({ length: EIGHTY_JOBS_COUNT }, async (_, i) => {
      await submitCounterJob(port, i, estimatedTokens);
    })
  );
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
