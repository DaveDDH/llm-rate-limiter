/**
 * Helper functions and constants for distributed time windows tests (Test 33).
 *
 * Config: high-distributedTimeWindow
 * - model-alpha: TPM=50K
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=1, ratio=1.0
 * - Pool calculation:
 *   - 2 instances: floor(50K/10K/2) = 2 slots per instance
 */
import { bootInstance, cleanRedis, fetchAllocation, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;
const MINUTE_IN_MS = 60000;
const FIVE_SECONDS_MS = 5000;
const BUFFER_MS = 1000;

// Port constants
export const PORT_A = 4001;
export const PORT_B = 4002;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'high-distributedTimeWindow';

// Model and job type identifiers
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Capacity constants
export const TPM_CAPACITY = 50000;
export const ESTIMATED_TOKENS = 10000;
export const TWO_INSTANCES = 2;
export const TWO_SLOTS_PER_INSTANCE = 2;

// Test constants
export const FORTY_K_TOKENS = 40000;
export const ZERO_TOKENS = 0;
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

/** Get TPD counter for a model */
export const getTokensPerDay = (stats: StatsResponse): CounterStats | undefined =>
  stats.stats.models[MODEL_ID]?.tokensPerDay;

/** Options for submitting a job */
export interface SubmitJobOptions {
  port: number;
  jobId: string;
  durationMs: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
}

/** Submit a job with optional actual usage overrides */
export const submitJob = async (options: SubmitJobOptions): Promise<number> => {
  const { port, jobId, durationMs, actualInputTokens, actualOutputTokens } = options;
  const payload: Record<string, unknown> = { durationMs };
  if (actualInputTokens !== undefined) {
    payload.actualInputTokens = actualInputTokens;
  }
  if (actualOutputTokens !== undefined) {
    payload.actualOutputTokens = actualOutputTokens;
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

// Time multipliers
const MS_PER_SECOND = 1000;

/** Get seconds until next minute boundary */
const getSecondsUntilNextMinute = (): number => {
  const now = new Date();
  const secondsIntoMinute = now.getSeconds();
  const msIntoSecond = now.getMilliseconds();
  const remainingMs = MINUTE_IN_MS - (secondsIntoMinute * MS_PER_SECOND + msIntoSecond);
  return Math.ceil(remainingMs / MS_PER_SECOND);
};

/** Wait until a minute boundary is crossed */
export const waitForMinuteBoundary = async (): Promise<void> => {
  const secondsToWait = getSecondsUntilNextMinute();
  await sleep(secondsToWait * MS_PER_SECOND + BUFFER_MS);
};

// Constants for slot checking
const ZERO_SLOTS = 0;

/** Check if allocation is restored */
const checkAllocationRestored = async (port: number): Promise<boolean> => {
  const response = await fetchAllocation(port);
  const slots = response.allocation?.pools[MODEL_ID]?.totalSlots;
  return slots !== undefined && slots > ZERO_SLOTS;
};

/** Poll for allocation restore recursively */
const pollAllocationRestored = async (port: number, startTime: number, timeoutMs: number): Promise<void> => {
  if (Date.now() - startTime >= timeoutMs) {
    throw new Error('Timeout waiting for allocation to be restored');
  }

  const isRestored = await checkAllocationRestored(port);
  if (isRestored) {
    return;
  }

  await sleep(POLL_INTERVAL_MS);
  await pollAllocationRestored(port, startTime, timeoutMs);
};

/** Wait for allocation to be available (totalSlots > 0) */
export const waitForAllocationRestored = async (port: number): Promise<void> => {
  await pollAllocationRestored(port, Date.now(), FIVE_SECONDS_MS);
};

// Job iteration constants
const FOUR_JOBS = 4;
const JOB_THRESHOLD = 2;
const TOKEN_HALF_DIVISOR = 2;

/** Submit a single window reset job and verify acceptance */
const submitWindowResetJob = async (index: number): Promise<void> => {
  const port = index < JOB_THRESHOLD ? PORT_A : PORT_B;
  const status = await submitJob({
    port,
    jobId: `window-reset-${index}`,
    durationMs: SHORT_JOB_DURATION_MS,
    actualInputTokens: ESTIMATED_TOKENS / TOKEN_HALF_DIVISOR,
    actualOutputTokens: ESTIMATED_TOKENS / TOKEN_HALF_DIVISOR,
  });
  if (status !== HTTP_ACCEPTED) {
    throw new Error(`Job submission failed with status ${status}`);
  }
};

/** Submit four jobs split across two instances */
export const submitFourJobsAcrossInstances = async (): Promise<void> => {
  await Promise.all(
    Array.from({ length: FOUR_JOBS }, async (_, i) => {
      await submitWindowResetJob(i);
    })
  );
};

/** Verify TPM counter shows expected tokens */
export const verifyTpmCounter = async (port: number, expectedTokens: number): Promise<void> => {
  const stats = await fetchStats(port);
  const tpm = getTokensPerMinute(stats);
  expect(tpm?.current).toBe(expectedTokens);
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
