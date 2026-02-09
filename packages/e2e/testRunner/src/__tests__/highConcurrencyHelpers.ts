/**
 * Helper functions and constants for high concurrency tests (Test 46).
 *
 * Config: highest-highConcurrency
 * - model-alpha: TPM=100K, tokens=1K per job
 * - model-beta: TPM=1M
 * - Supports 100 jobs/min on model-alpha
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
export const PORT_C = 4003;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'highest-highConcurrency';

// Model identifiers
export const MODEL_ALPHA = 'model-alpha';
export const MODEL_BETA = 'model-beta';

// Job type
export const JOB_TYPE = 'jobTypeA';

// Instance counts
export const TWO_INSTANCES = 2;
export const THREE_INSTANCES = 3;

// Job counts
export const FIFTY_JOBS = 50;
export const ONE_HUNDRED_JOBS = 100;
export const ONE_HUNDRED_FIFTY_JOBS = 150;

// Capacity limits
export const MAX_JOBS_FIRST_MINUTE = 100;
export const ALPHA_CAPACITY = 10;
export const BETA_CAPACITY = 100;

// Timing
export const SHORT_JOB_DURATION_MS = 100;
export const JOB_COMPLETE_TIMEOUT_MS = 30000;

// HTTP status
export const HTTP_ACCEPTED = 202;

// Shared constants
export const ZERO_COUNT = 0;
const INCREMENT = 1;

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 90000;
export const AFTER_ALL_TIMEOUT_MS = 30000;
export const TEST_TIMEOUT_MS = 120000;

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
  port: number;
  jobId: string;
  jobType: string;
  durationMs: number;
  extraPayload?: Record<string, unknown>;
}

/**
 * Submit a job to an instance
 */
export const submitJob = async (options: SubmitJobOptions): Promise<number> => {
  const { port, jobId, jobType, durationMs, extraPayload } = options;
  const response = await fetch(`http://localhost:${port}/api/queue-job`, {
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
 * Submit multiple jobs in parallel to an instance
 */
export const submitMultipleJobs = async (port: number, count: number, prefix: string): Promise<number[]> => {
  const promises = [];
  for (let i = 0; i < count; i += INCREMENT) {
    const jobId = `${prefix}-${i}-${Date.now()}`;
    promises.push(
      submitJob({
        port,
        jobId,
        jobType: JOB_TYPE,
        durationMs: SHORT_JOB_DURATION_MS,
      })
    );
  }
  return await Promise.all(promises);
};

/**
 * Fetch job results from an instance
 */
export const fetchJobResults = async (port: number): Promise<JobResult[]> => {
  const response = await fetch(`http://localhost:${port}/api/debug/job-results`);
  const data: unknown = await response.json();
  if (!isJobResultsResponse(data)) {
    throw new Error('Invalid job results response');
  }
  return data.results;
};

/**
 * Count jobs that completed within first minute (startTime within 60s of first job start)
 */
export const countJobsInFirstMinute = (results: JobResult[]): number => {
  if (results.length === ZERO_COUNT) {
    return ZERO_COUNT;
  }
  const firstJobStartTime = Math.min(...results.map((r) => r.startTime));
  const oneMinuteMs = 60000;
  const oneMinuteAfter = firstJobStartTime + oneMinuteMs;
  return results.filter((r) => r.startTime < oneMinuteAfter).length;
};

/**
 * Count jobs by model used
 */
export const countJobsByModel = (results: JobResult[], modelId: string): number =>
  results.filter((r) => r.modelUsed === modelId).length;

/**
 * Setup two instance test
 */
export const setupTwoInstanceTest = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, CONFIG_PRESET);
  await bootInstance(PORT_B, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/**
 * Setup three instance test
 */
export const setupThreeInstanceTest = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, CONFIG_PRESET);
  await bootInstance(PORT_B, CONFIG_PRESET);
  await bootInstance(PORT_C, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/**
 * Poll until no active jobs remain on all ports (recursive)
 */
const pollUntilAllComplete = async (ports: number[], startTime: number, timeoutMs: number): Promise<void> => {
  if (Date.now() - startTime >= timeoutMs) {
    throw new Error('Timeout waiting for jobs to complete');
  }

  const responses = await Promise.all(
    ports.map(async (port) => {
      const response = await fetch(`http://localhost:${port}/api/debug/active-jobs`);
      return await response.json();
    })
  );

  const allComplete = responses.every((data) => isActiveJobsResponse(data) && data.count === ZERO_COUNT);

  if (allComplete) {
    return;
  }

  await sleep(POLL_INTERVAL_MS);
  await pollUntilAllComplete(ports, startTime, timeoutMs);
};

/**
 * Wait for all active jobs to complete across multiple instances
 */
export const waitForAllJobsComplete = async (ports: number[], timeoutMs: number): Promise<void> => {
  await pollUntilAllComplete(ports, Date.now(), timeoutMs);
};

// Re-export for convenience
export { killAllInstances };
