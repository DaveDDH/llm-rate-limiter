/**
 * Helper functions and constants for distributed daily limits test (Test 33.3).
 *
 * Config: high-distributedDailyLimit
 * - model-alpha: TPM=100K, TPD=200K
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=1, ratio=1.0
 * - Pool calculation (TPM): floor(100K/10K/2) = 5 slots per instance
 * - Pool calculation (TPD): floor(200K/10K/2) = 10 slots per instance
 * - TPM is the limiting factor: 5 slots per instance
 */
import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;
const MINUTE_IN_MS = 60000;
const BUFFER_MS = 1000;
const MS_PER_SECOND = 1000;

// Port constants
export const PORT_A = 4001;
export const PORT_B = 4002;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'high-distributedDailyLimit';

// Model and job type identifiers
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Capacity constants
export const TPM_CAPACITY = 100000;
export const TPD_CAPACITY = 200000;
export const ESTIMATED_TOKENS = 10000;
export const TWO_INSTANCES = 2;

// Per-instance TPD allocation: 200K / 2 = 100K per instance
export const INITIAL_TPD_PER_INSTANCE = 100000;

// Job counts per minute-phase: 4 jobs per instance = 8 total = 80K tokens
export const JOBS_PER_INSTANCE_PER_MINUTE = 4;
export const TOKENS_PER_MINUTE_PHASE = 80000;

// Cumulative TPD after two minutes
export const CUMULATIVE_TPD_AFTER_TWO_MINUTES = 160000;

// Remaining TPD capacity after two minutes: 200K - 160K = 40K
export const REMAINING_TPD_AFTER_TWO_MINUTES = 40000;

// Token split for actual usage (half input, half output)
const TOKEN_HALF_DIVISOR = 2;

// Job submission
export const SHORT_JOB_DURATION_MS = 100;
export const HTTP_ACCEPTED = 202;
export const ZERO_TOKENS = 0;

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;
export const JOB_COMPLETE_TIMEOUT_MS = 15000;

/** 5 minutes for cross-minute-boundary test */
export const DAILY_LIMIT_TEST_TIMEOUT_MS = 300000;

/** Stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<string, ModelStats>;
  };
}

/** Per-model stats */
interface ModelStats {
  tokensPerMinute?: CounterStats;
  tokensPerDay?: CounterStats;
}

/** Counter stats */
export interface CounterStats {
  current: number;
  limit: number;
  remaining?: number;
}

/** Active jobs response */
interface ActiveJobsResponse {
  count: number;
}

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';

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

/** Get TPD counter for a model */
export const getTokensPerDay = (stats: StatsResponse): CounterStats | undefined =>
  stats.stats.models[MODEL_ID]?.tokensPerDay;

/** Get TPM counter for a model */
export const getTokensPerMinute = (stats: StatsResponse): CounterStats | undefined =>
  stats.stats.models[MODEL_ID]?.tokensPerMinute;

/** Options for submitting a job */
interface SubmitJobOptions {
  port: number;
  jobId: string;
  durationMs: number;
  actualInputTokens: number;
  actualOutputTokens: number;
}

/** Submit a job with actual usage overrides */
export const submitJob = async (options: SubmitJobOptions): Promise<number> => {
  const { port, jobId, durationMs, actualInputTokens, actualOutputTokens } = options;
  const response = await fetch(`http://localhost:${port}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType: JOB_TYPE,
      payload: { durationMs, actualInputTokens, actualOutputTokens },
    }),
  });
  return response.status;
};

/** Boot two instances with the daily limit config preset */
export const setupTwoInstances = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, CONFIG_PRESET);
  await bootInstance(PORT_B, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Submit a single job to a given port */
const submitSinglePhaseJob = async (port: number, phase: string, index: number): Promise<void> => {
  const jobId = `daily-${phase}-${index}`;
  const halfTokens = ESTIMATED_TOKENS / TOKEN_HALF_DIVISOR;
  const status = await submitJob({
    port,
    jobId,
    durationMs: SHORT_JOB_DURATION_MS,
    actualInputTokens: halfTokens,
    actualOutputTokens: halfTokens,
  });
  if (status !== HTTP_ACCEPTED) {
    throw new Error(`Job ${jobId} rejected with status ${status}`);
  }
};

/** Submit jobs across both instances for a minute phase */
export const submitJobsForPhase = async (phase: string): Promise<void> => {
  const promises: Array<Promise<void>> = [];
  for (let i = 0; i < JOBS_PER_INSTANCE_PER_MINUTE; i += INCREMENT) {
    promises.push(submitSinglePhaseJob(PORT_A, `${phase}-A`, i));
    promises.push(submitSinglePhaseJob(PORT_B, `${phase}-B`, i));
  }
  await Promise.all(promises);
};

// Loop and polling constants
const INCREMENT = 1;
const ZERO_COUNT = 0;

/** Poll until no active jobs remain */
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

/** Wait for all active jobs to complete on a port */
export const waitForJobsComplete = async (port: number, timeoutMs: number): Promise<void> => {
  await pollUntilNoActiveJobs(port, Date.now(), timeoutMs);
};

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

/** Wait for jobs to complete on both instances */
export const waitForAllJobsComplete = async (): Promise<void> => {
  await waitForJobsComplete(PORT_A, JOB_COMPLETE_TIMEOUT_MS);
  await waitForJobsComplete(PORT_B, JOB_COMPLETE_TIMEOUT_MS);
};
