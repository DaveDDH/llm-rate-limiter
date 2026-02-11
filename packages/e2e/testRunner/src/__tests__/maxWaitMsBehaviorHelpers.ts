/**
 * Helper functions and constants for maxWaitMS behavior tests (14.2-14.7).
 *
 * Various configs testing maxWaitMS delegation, rejection, and timeout behavior.
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

// Config presets
export const TWO_MODEL_CONFIG: ConfigPresetName = 'medium-maxWait-twoModel';
export const SINGLE_MODEL_CONFIG: ConfigPresetName = 'medium-maxWait-singleModel';
export const EXPLICIT_CONFIG: ConfigPresetName = 'medium-maxWait-explicit';
export const TIMEOUT_CONFIG: ConfigPresetName = 'medium-maxWait-timeout';
export const RELEASE_CONFIG: ConfigPresetName = 'medium-maxWait-release';
export const PER_MODEL_CONFIG: ConfigPresetName = 'medium-maxWait-perModel';
export const DEFAULT_CONFIG: ConfigPresetName = 'medium-maxWait-default';

// Job duration constants
export const QUICK_JOB_DURATION_MS = 100;
export const FILL_JOB_DURATION_MS = 2000;
export const DEFAULT_WAIT_FILL_MS = 90000;
export const LONG_FILL_DURATION_MS = 20000;
export const MEDIUM_FILL_DURATION_MS = 5000;
export const RELEASE_FILL_DURATION_MS = 2000;

// Timing tolerances
export const JOB_SETTLE_MS = 500;
export const IMMEDIATE_DELEGATION_MAX_MS = 500;
export const IMMEDIATE_REJECTION_MAX_MS = 2000;
export const EXPLICIT_WAIT_MIN_MS = 4500;
export const EXPLICIT_WAIT_MAX_MS = 5500;
export const TIMEOUT_DELEGATION_MIN_MS = 1500;
export const TIMEOUT_DELEGATION_MAX_MS = 3000;
export const RELEASE_WAIT_MIN_MS = 1500;
export const RELEASE_WAIT_MAX_MS = 3000;

// Per-model test (14.5) tolerances
export const PER_MODEL_TOTAL_WAIT_MIN_MS = 10500;
export const PER_MODEL_TOTAL_WAIT_MAX_MS = 13000;

// Simultaneous timeout test (14.8) constants
export const SIMULTANEOUS_JOB_COUNT = 10;
export const SIMULTANEOUS_WAIT_MIN_MS = 4500;
export const SIMULTANEOUS_WAIT_MAX_MS = 6500;

// Default maxWaitMS test (14.1) constants
export const DEFAULT_WAIT_BUFFER_S = 5;
export const SECONDS_PER_MINUTE = 60;
export const DEFAULT_TIMING_TOLERANCE_MS = 3000;

// Shared constants
export const ZERO_COUNT = 0;
export const HTTP_ACCEPTED = 202;

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;
export const POLL_INTERVAL_MS = 200;
export const JOB_COMPLETE_TIMEOUT_MS = 100000;

// Job history status values
export const STATUS_COMPLETED = 'completed';
export const STATUS_FAILED = 'failed';

/** Historical job from job history endpoint */
export interface HistoricalJob {
  jobId: string;
  jobType: string;
  status: 'completed' | 'failed';
  modelUsed: string;
  queuedAt: number;
  startedAt: number;
  completedAt: number;
  totalCost: number;
  error?: string;
  modelsTried: string[];
}

/** Job history response from GET /api/debug/job-history */
export interface JobHistoryResponse {
  instanceId: string;
  timestamp: number;
  history: HistoricalJob[];
  summary: { completed: number; failed: number; total: number };
}

/** Active jobs response from GET /api/debug/active-jobs */
export interface ActiveJobsResponse {
  instanceId: string;
  timestamp: number;
  activeJobs: Array<{ jobId: string; jobType: string }>;
  count: number;
}

/** Type guard for JobHistoryResponse */
const isJobHistoryResponse = (value: unknown): value is JobHistoryResponse =>
  typeof value === 'object' && value !== null && 'history' in value && 'summary' in value;

/** Type guard for ActiveJobsResponse */
const isActiveJobsResponse = (value: unknown): value is ActiveJobsResponse =>
  typeof value === 'object' && value !== null && 'count' in value && 'activeJobs' in value;

/** Fetch job history from an instance */
export const fetchJobHistory = async (baseUrl: string): Promise<JobHistoryResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/job-history`);
  const data: unknown = await response.json();
  if (!isJobHistoryResponse(data)) {
    throw new Error('Invalid job-history response');
  }
  return data;
};

/** Fetch active jobs from an instance */
export const fetchActiveJobs = async (baseUrl: string): Promise<ActiveJobsResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/active-jobs`);
  const data: unknown = await response.json();
  if (!isActiveJobsResponse(data)) {
    throw new Error('Invalid active-jobs response');
  }
  return data;
};

/** Submit a job to an instance */
export const submitJob = async (
  baseUrl: string,
  jobId: string,
  jobType: string,
  durationMs: number
): Promise<number> => {
  const response = await fetch(`${baseUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType,
      payload: { testData: `Test job ${jobId}`, durationMs },
    }),
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

/** Find a specific job in history by jobId */
export const findJobById = (history: HistoricalJob[], jobId: string): HistoricalJob | undefined =>
  history.find((j) => j.jobId === jobId);

/** Get seconds into current minute */
export const getSecondsIntoMinute = (): number => new Date().getSeconds();

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
export { sleep } from '../testUtils.js';
