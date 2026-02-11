/**
 * Helper functions and constants for distributed global usage tracking tests (Test 29).
 *
 * Config: high-distributedBasic
 * - model-alpha: TPM=100K
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=1, ratio=1.0
 * - 2 instances: floor(100K/10K/2) = 5 slots per instance
 */
import {
  bootInstance,
  cleanRedis,
  fetchAllocation,
  killAllInstances,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;

// Port constants
export const PORT_A = 4001;
export const PORT_B = 4002;
export const INSTANCE_URL_A = `http://localhost:${PORT_A}`;
export const INSTANCE_URL_B = `http://localhost:${PORT_B}`;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'high-distributedBasic';

// Model and job type identifiers
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Capacity constants
export const ESTIMATED_TOKENS = 10_000;
export const TOTAL_TPM = 100_000;
export const TWO_INSTANCES = 2;
export const INITIAL_ALLOCATION_PER_INSTANCE = 50_000;

// Token amounts for tests
export const TOKENS_1K = 1000;
export const TOKENS_2K = 2000;
export const TOKENS_3K = 3000;
export const TOKENS_5K = 5000;
export const TOKENS_10K = 10_000;
export const TOKENS_20K = 20_000;
export const TOKENS_25K = 25_000;
export const TOKENS_40K = 40_000;
export const TOKENS_45K = 45_000;
export const TOKENS_50K = 50_000;
export const TOKENS_60K = 60_000;

// Shared constants
export const ZERO_COUNT = 0;
export const ZERO_TOKENS = 0;
export const HTTP_ACCEPTED = 202;
export const SHORT_JOB_DURATION_MS = 100;
export const JOB_COMPLETE_TIMEOUT_MS = 10_000;

// Job count constants for loops
export const THREE_JOBS = 3;
export const TWO_JOBS = 2;
export const SIX_JOBS = 6;
export const TEN_JOBS = 10;
export const TWENTY_JOBS = 20;

// Expected slot counts
export const TWO_SLOTS = 2;

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;
export const TEST_TIMEOUT_MS = 60000;

/** Active jobs response */
interface ActiveJobsResponse {
  count: number;
}

/** Type guard for ActiveJobsResponse */
const isActiveJobsResponse = (value: unknown): value is ActiveJobsResponse =>
  typeof value === 'object' && value !== null && 'count' in value;

/**
 * Options for submitting a job
 */
export interface SubmitJobOptions {
  baseUrl: string;
  jobId: string;
  jobType: string;
  durationMs: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
}

/**
 * Submit a job with optional actual usage overrides
 */
export const submitJob = async (options: SubmitJobOptions): Promise<number> => {
  const { baseUrl, jobId, jobType, durationMs, actualInputTokens, actualOutputTokens } = options;
  const payload: Record<string, unknown> = { durationMs };

  if (actualInputTokens !== undefined) {
    payload.actualInputTokens = actualInputTokens;
  }
  if (actualOutputTokens !== undefined) {
    payload.actualOutputTokens = actualOutputTokens;
  }

  const response = await fetch(`${baseUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, jobType, payload }),
  });
  return response.status;
};

/** Options for creating multiple job promises */
interface BatchJobOptions {
  baseUrl: string;
  jobPrefix: string;
  count: number;
  actualInputTokens: number;
}

/**
 * Create an array of job submission promises (no awaiting)
 */
export const createJobPromises = (options: BatchJobOptions): Array<Promise<number>> => {
  const { baseUrl, jobPrefix, count, actualInputTokens } = options;
  return Array.from(
    { length: count },
    async (_, i) =>
      await submitJob({
        baseUrl,
        jobId: `${jobPrefix}-${i}`,
        jobType: JOB_TYPE,
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens,
        actualOutputTokens: ZERO_TOKENS,
      })
  );
};

/**
 * Submit batch jobs and verify all are accepted
 */
export const submitBatchAndVerify = async (promises: Array<Promise<number>>): Promise<void> => {
  const statuses = await Promise.all(promises);
  statuses.forEach((status) => {
    expect(status).toBe(HTTP_ACCEPTED);
  });
};

/**
 * Submit a job, verify acceptance, and wait for completion
 */
export const submitJobAndWait = async (
  baseUrl: string,
  jobId: string,
  actualInputTokens: number
): Promise<void> => {
  const status = await submitJob({
    baseUrl,
    jobId,
    jobType: JOB_TYPE,
    durationMs: SHORT_JOB_DURATION_MS,
    actualInputTokens,
    actualOutputTokens: ZERO_TOKENS,
  });
  expect(status).toBe(HTTP_ACCEPTED);
  await waitForJobComplete(baseUrl, JOB_COMPLETE_TIMEOUT_MS);
};

/**
 * Boot two instances with the given config preset
 */
export const setupTwoInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, configPreset);
  await bootInstance(PORT_B, configPreset);
  await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === TWO_INSTANCES);
  await waitForAllocationUpdate(PORT_B, (alloc) => alloc.instanceCount === TWO_INSTANCES);
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
 * Wait for all active jobs to complete on an instance
 */
export const waitForJobComplete = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  await pollUntilNoActiveJobs(baseUrl, Date.now(), timeoutMs);
};

// Re-export for convenience
export { killAllInstances, fetchAllocation, waitForAllocationUpdate };
