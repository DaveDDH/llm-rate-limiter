/**
 * Helper functions and constants for model escalation basic tests (19.1-19.6).
 *
 * Tests verify basic model escalation behavior.
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
const SINGLE_INSTANCE = 1;

// Config presets
export const TWO_MODEL_CONFIG: ConfigPresetName = 'medium-maxWait-twoModel';
export const THREE_MODEL_CONFIG: ConfigPresetName = 'mh-escalationThreeModel';
export const SINGLE_MODEL_CONFIG: ConfigPresetName = 'medium-maxWait-singleModel';

// Model IDs
export const MODEL_ALPHA = 'model-alpha';
export const MODEL_BETA = 'model-beta';
export const MODEL_GAMMA = 'model-gamma';
export const MODEL_PRIMARY = 'model-primary';
export const MODEL_SECONDARY = 'model-secondary';
export const MODEL_ONLY = 'model-only';

// Job types
export const JOB_TYPE_A = 'jobTypeA';

// Timing
export const QUICK_JOB_DURATION_MS = 100;
export const FILL_JOB_DURATION_MS = 2000;
export const SETTLE_MS = 500;
export const JOB_COMPLETE_TIMEOUT_MS = 10000;

// HTTP status
export const HTTP_ACCEPTED = 202;

// Job status values
export const STATUS_COMPLETED = 'completed';
export const STATUS_FAILED = 'failed';

// Shared constants
export const ZERO_COUNT = 0;
export const INCREMENT = 1;
export const EXPECTED_SINGLE_MODEL = 1;
export const THREE_MODELS = 3;
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;

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

/** Active jobs response */
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

/** Boot a single instance with given config preset */
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

/** Options for submitting fill jobs with settle */
export interface SubmitFillJobsOptions {
  baseUrl: string;
  count: number;
  prefix: string;
  jobType: string;
  durationMs: number;
  settleMs: number;
}

/**
 * Submit fill jobs sequentially with settle time between each.
 * Returns the list of job IDs submitted.
 */
export const submitFillJobsWithSettle = async (options: SubmitFillJobsOptions): Promise<string[]> => {
  const { baseUrl, count, prefix, jobType, durationMs, settleMs } = options;
  return await Array.from({ length: count }, (_, i) => i).reduce(
    async (prevPromise, i) => {
      const jobIds = await prevPromise;
      const jobId = `${prefix}-${i}`;
      await submitJob(baseUrl, jobId, jobType, durationMs);
      await sleep(settleMs);
      return [...jobIds, jobId];
    },
    Promise.resolve([] as string[])
  );
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
export { sleep } from '../testUtils.js';
