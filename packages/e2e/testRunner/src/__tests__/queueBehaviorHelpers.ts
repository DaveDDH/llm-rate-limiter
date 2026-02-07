/**
 * Helper functions and constants for queue behavior tests (13.1-13.5).
 *
 * Config: medium-queue-concurrent
 * model-alpha: maxConcurrent=5, maxWaitMS=60000
 * 1 instance → 5 concurrent slots
 */
import { bootInstance, cleanRedis, killAllInstances, waitForAllocationUpdate } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;

// Instance constants
export const INSTANCE_PORT = 3001;
export const INSTANCE_URL = `http://localhost:${INSTANCE_PORT}`;

// Instance counts
const SINGLE_INSTANCE = 1;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'medium-queue-concurrent';

// Capacity constants
export const MAX_CONCURRENT = 5;

// Job duration constants
export const LONG_JOB_DURATION_MS = 60000;
export const SHORT_JOB_DURATION_MS = 500;
export const MEDIUM_JOB_DURATION_MS = 2000;
export const WAKE_JOB_DURATION_MS = 1000;

// Timing tolerances
export const JOB_SETTLE_MS = 500;
export const FIFO_GAP_MS = 50;
export const FIFO_SETTLE_MS = 200;

// Job counts
export const FILL_CAPACITY_COUNT = 5;
export const ONE_EXTRA_JOB = 1;
export const TOTAL_WITH_QUEUED = 6;
export const SIMULTANEOUS_JOBS = 10;
export const FIFO_EXTRA_JOBS = 3;

// Expected values
export const EXPECTED_ACTIVE_WITH_QUEUE = 6;

// Shared constants
export const ZERO_COUNT = 0;
export const HTTP_ACCEPTED = 202;

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;
export const POLL_INTERVAL_MS = 200;
export const JOB_COMPLETE_TIMEOUT_MS = 30000;

/** Active jobs response from GET /api/debug/active-jobs */
export interface ActiveJobsResponse {
  instanceId: string;
  timestamp: number;
  activeJobs: Array<{ jobId: string; jobType: string }>;
  count: number;
}

/** Historical job from job history endpoint */
export interface HistoricalJob {
  jobId: string;
  jobType: string;
  status: 'completed' | 'failed';
  modelUsed: string;
  queuedAt: number;
  startedAt: number;
  completedAt: number;
  error?: string;
}

/** Job history response from GET /api/debug/job-history */
export interface JobHistoryResponse {
  instanceId: string;
  timestamp: number;
  history: HistoricalJob[];
  summary: { completed: number; failed: number; total: number };
}

/** Concurrency stats from debug/stats */
export interface ConcurrencyStats {
  active: number;
  limit: number | null;
  available: number | null;
}

/** Stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<string, { concurrency?: ConcurrencyStats }>;
  };
}

/** Type guard for ActiveJobsResponse */
const isActiveJobsResponse = (value: unknown): value is ActiveJobsResponse =>
  typeof value === 'object' && value !== null && 'count' in value && 'activeJobs' in value;

/** Type guard for JobHistoryResponse */
const isJobHistoryResponse = (value: unknown): value is JobHistoryResponse =>
  typeof value === 'object' && value !== null && 'history' in value && 'summary' in value;

/** Type guard for StatsResponse */
const isStatsResponse = (value: unknown): value is StatsResponse =>
  typeof value === 'object' && value !== null && 'stats' in value && 'instanceId' in value;

/** Fetch active jobs from an instance */
export const fetchActiveJobs = async (baseUrl: string): Promise<ActiveJobsResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/active-jobs`);
  const data: unknown = await response.json();
  if (!isActiveJobsResponse(data)) {
    throw new Error('Invalid active-jobs response');
  }
  return data;
};

/** Fetch job history from an instance */
export const fetchJobHistory = async (baseUrl: string): Promise<JobHistoryResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/job-history`);
  const data: unknown = await response.json();
  if (!isJobHistoryResponse(data)) {
    throw new Error('Invalid job-history response');
  }
  return data;
};

/** Fetch stats from an instance */
export const fetchStats = async (baseUrl: string): Promise<StatsResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/stats`);
  const data: unknown = await response.json();
  if (!isStatsResponse(data)) {
    throw new Error('Invalid stats response');
  }
  return data;
};

/** Parameters for submitting a job */
interface SubmitJobParams {
  baseUrl: string;
  jobId: string;
  jobType: string;
  durationMs: number;
}

/** Build the request body for a job submission */
const buildJobRequestBody = (params: SubmitJobParams): string =>
  JSON.stringify({
    jobId: params.jobId,
    jobType: params.jobType,
    payload: { testData: `Test job ${params.jobId}`, durationMs: params.durationMs },
  });

/** Submit a job to an instance */
export const submitJob = async (
  baseUrl: string,
  jobId: string,
  jobType: string,
  durationMs: number
): Promise<number> => {
  const body = buildJobRequestBody({ baseUrl, jobId, jobType, durationMs });
  const response = await fetch(`${baseUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  return response.status;
};

/** Boot a single instance with the given config preset */
export const setupSingleInstance = async (preset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT, preset);
  await waitForAllocationUpdate(INSTANCE_PORT, (allocation) => allocation.instanceCount === SINGLE_INSTANCE);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Poll until no active jobs remain */
const pollUntilNoActiveJobs = async (
  baseUrl: string,
  startTime: number,
  timeoutMs: number
): Promise<void> => {
  if (Date.now() - startTime >= timeoutMs) {
    throw new Error('Timeout waiting for jobs to complete');
  }
  const { count } = await fetchActiveJobs(baseUrl);
  if (count === ZERO_COUNT) {
    return;
  }
  await sleep(POLL_INTERVAL_MS);
  await pollUntilNoActiveJobs(baseUrl, startTime, timeoutMs);
};

/** Wait for all active jobs to complete */
export const waitForNoActiveJobs = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  await pollUntilNoActiveJobs(baseUrl, Date.now(), timeoutMs);
};

/** Create job IDs for a batch */
const createBatchJobIds = (prefix: string, count: number): string[] => {
  const timestamp = Date.now();
  return Array.from({ length: count }, (_, i) => `${prefix}-${timestamp}-${i}`);
};

/** Submit multiple jobs in parallel */
export const submitJobBatch = async (
  baseUrl: string,
  prefix: string,
  count: number,
  durationMs: number
): Promise<void> => {
  const jobIds = createBatchJobIds(prefix, count);
  const submissions = jobIds.map(async (jobId) => await submitJob(baseUrl, jobId, 'jobTypeA', durationMs));
  await Promise.all(submissions);
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
export { sleep } from '../testUtils.js';
