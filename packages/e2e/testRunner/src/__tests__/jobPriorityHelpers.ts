/**
 * Helper functions and constants for job priority tests (Test 45).
 *
 * Config: highest-jobPriority
 * - model-alpha: TPM=10K (1 slot), model-beta: TPM=100K
 * - lowPriority: maxWaitMS=0, critical: maxWaitMS=60s
 * - 1 instance
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
export const CONFIG_PRESET: ConfigPresetName = 'highest-jobPriority';

// Model identifiers
export const MODEL_ALPHA = 'model-alpha';
export const MODEL_BETA = 'model-beta';

// Job types
export const JOB_TYPE_LOW_PRIORITY = 'lowPriority';
export const JOB_TYPE_CRITICAL = 'critical';

// Timing
export const SHORT_JOB_DURATION_MS = 100;
export const LONG_JOB_DURATION_MS = 5000;
export const JOB_COMPLETE_TIMEOUT_MS = 10000;
export const IMMEDIATE_DELEGATION_MS = 100;
export const DELEGATION_TOLERANCE_MS = 200;

// HTTP status
export const HTTP_ACCEPTED = 202;

// Zero-token payload: prevents TPM exhaustion on fill jobs
const ZERO_TOKENS = 0;
export const ZERO_TOKEN_PAYLOAD: Record<string, unknown> = {
  actualInputTokens: ZERO_TOKENS,
  actualOutputTokens: ZERO_TOKENS,
};

// Shared constants
export const ZERO_COUNT = 0;
export const ONE_SLOT = 1;

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;

/** Job result from the job endpoint */
export interface JobResult {
  jobId: string;
  status: string;
  modelUsed?: string;
  startTime: number;
  endTime: number;
  queueDuration: number;
  executionDuration: number;
}

/** Job results response */
interface JobResultsResponse {
  results: JobResult[];
}

/** Active jobs response */
interface ActiveJobsResponse {
  count: number;
}

/** Type guard for JobResultsResponse */
const isJobResultsResponse = (value: unknown): value is JobResultsResponse =>
  typeof value === 'object' && value !== null && 'results' in value;

/** Type guard for ActiveJobsResponse */
const isActiveJobsResponse = (value: unknown): value is ActiveJobsResponse =>
  typeof value === 'object' && value !== null && 'count' in value;

/** Options for submitting a job */
export interface SubmitJobOptions {
  baseUrl: string;
  jobId: string;
  jobType: string;
  durationMs: number;
  extraPayload?: Record<string, unknown>;
}

/**
 * Submit a job with optional payload
 */
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

/**
 * Fetch job results from an instance
 */
export const fetchJobResults = async (baseUrl: string): Promise<JobResult[]> => {
  const response = await fetch(`${baseUrl}/api/debug/job-results`);
  const data: unknown = await response.json();
  if (!isJobResultsResponse(data)) {
    throw new Error('Invalid job results response');
  }
  return data.results;
};

/**
 * Find a job result by ID
 */
export const findJobResult = (results: JobResult[], jobId: string): JobResult | undefined =>
  results.find((r) => r.jobId === jobId);

/**
 * Boot a single instance with the given config preset
 */
export const setupSingleInstance = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/**
 * Poll until no active jobs remain (recursive)
 */
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

/**
 * Wait for all active jobs to complete
 */
export const waitForJobComplete = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  await pollUntilNoActiveJobs(baseUrl, Date.now(), timeoutMs);
};

/**
 * Submit a job and verify it was accepted (HTTP 202)
 */
export const submitAndExpectAccepted = async (options: SubmitJobOptions): Promise<void> => {
  const status = await submitJob(options);
  expect(status).toBe(HTTP_ACCEPTED);
};

/** Job submission descriptor for batch sequential submission */
export interface JobSubmission {
  jobId: string;
  jobType: string;
  durationMs: number;
  extraPayload?: Record<string, unknown>;
}

/**
 * Submit multiple jobs sequentially using reduce pattern
 */
export const submitJobsInOrder = async (baseUrl: string, jobs: JobSubmission[]): Promise<void> => {
  await jobs.reduce(async (prev, job) => {
    await prev;
    await submitAndExpectAccepted({
      baseUrl,
      jobId: job.jobId,
      jobType: job.jobType,
      durationMs: job.durationMs,
      extraPayload: job.extraPayload,
    });
  }, Promise.resolve());
};

/**
 * Verify a low-priority job was delegated immediately to model-beta
 */
export const verifyLowPriorityDelegation = (
  result: JobResult | undefined,
  expectedModel: string,
  maxDelegationMs: number
): void => {
  expect(result).toBeDefined();
  expect(result?.modelUsed).toBe(expectedModel);
  expect(result?.queueDuration).toBeLessThan(maxDelegationMs);
};

/**
 * Verify a critical job was queued (not immediately delegated)
 */
export const verifyCriticalJobQueued = (result: JobResult | undefined, minQueueMs: number): void => {
  expect(result).toBeDefined();
  expect(result?.queueDuration).toBeGreaterThan(minQueueMs);
};

// Re-export for convenience
export { killAllInstances };
