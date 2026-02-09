/**
 * Helper functions and constants for distributed multi-model tracking tests (Test 35).
 *
 * Config: high-distributedMultiModel
 * - model-alpha: TPM=100K
 * - model-beta: TPM=50K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 2 instances
 */
import { type AllocationResponse, bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;

// Port constants
export const PORT_A = 4001;
export const PORT_B = 4002;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'high-distributedMultiModel';

// Model identifiers
export const MODEL_ALPHA = 'model-alpha';
export const MODEL_BETA = 'model-beta';
export const JOB_TYPE = 'jobTypeA';

// Capacity constants
export const ALPHA_TPM = 100000;
export const BETA_TPM = 50000;
export const ESTIMATED_TOKENS = 10000;
export const TWO_INSTANCES = 2;

// Test constants
export const EIGHTY_K_TOKENS = 80000;
export const TWENTY_K_TOKENS = 20000;
export const ALPHA_EXPECTED_REMAINING = 10000;
export const BETA_EXPECTED_REMAINING = 15000;
export const SHORT_JOB_DURATION_MS = 100;
export const HTTP_ACCEPTED = 202;
export const JOB_COMPLETE_TIMEOUT_MS = 10000;

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
export const getTokensPerMinute = (stats: StatsResponse, modelId: string): CounterStats | undefined =>
  stats.stats.models[modelId]?.tokensPerMinute;

/** Get allocation pools for a model */
export const getModelPools = (response: AllocationResponse, modelId: string): number | undefined =>
  response.allocation?.pools[modelId]?.totalSlots;

/** Options for submitting a job */
export interface SubmitJobOptions {
  port: number;
  jobId: string;
  jobType: string;
  modelId: string;
  durationMs: number;
  actualInputTokens: number;
  actualOutputTokens: number;
}

/** Submit a job with model override */
export const submitJob = async (options: SubmitJobOptions): Promise<number> => {
  const { port, jobId, jobType, modelId, durationMs, actualInputTokens, actualOutputTokens } = options;
  const payload: Record<string, unknown> = {
    durationMs,
    actualInputTokens,
    actualOutputTokens,
    modelId,
  };

  const response = await fetch(`http://localhost:${port}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType,
      payload,
    }),
  });
  return response.status;
};

/** Boot two instances with the config preset */
export const setupTwoInstances = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, CONFIG_PRESET);
  await bootInstance(PORT_B, CONFIG_PRESET);
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
const EIGHT_JOBS = 8;
const TWO_JOBS = 2;
const TOKEN_HALF = 5000;

/** Submit a single job and verify acceptance */
const submitAndVerifyJob = async (
  port: number,
  modelId: string,
  prefix: string,
  index: number
): Promise<void> => {
  const status = await submitJob({
    port,
    jobId: `${prefix}-${index}`,
    jobType: JOB_TYPE,
    modelId,
    durationMs: SHORT_JOB_DURATION_MS,
    actualInputTokens: TOKEN_HALF,
    actualOutputTokens: TOKEN_HALF,
  });
  if (status !== HTTP_ACCEPTED) {
    throw new Error(`Job submission failed with status ${status}`);
  }
};

/** Submit 8 jobs to a model */
export const submitEightJobsToModel = async (
  port: number,
  modelId: string,
  prefix: string
): Promise<void> => {
  await Promise.all(
    Array.from({ length: EIGHT_JOBS }, async (_, i) => {
      await submitAndVerifyJob(port, modelId, prefix, i);
    })
  );
};

/** Submit 2 jobs to a model */
export const submitTwoJobsToModel = async (port: number, modelId: string, prefix: string): Promise<void> => {
  await Promise.all(
    Array.from({ length: TWO_JOBS }, async (_, i) => {
      await submitAndVerifyJob(port, modelId, prefix, i);
    })
  );
};

// Re-export for convenience
export { fetchAllocation, killAllInstances } from '../instanceLifecycle.js';
