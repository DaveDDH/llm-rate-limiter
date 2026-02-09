/**
 * Helper functions and constants for distributed cross-instance propagation tests (Test 30).
 *
 * Configs:
 * - high-distributedBasic: model-alpha TPM=100K
 * - high-distributedThree: model-alpha TPM=90K (3 instances)
 * - high-distributedMixed: model-alpha TPM=120K (3 instances)
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
export const PORT_C = 4003;
export const INSTANCE_URL_A = `http://localhost:${PORT_A}`;
export const INSTANCE_URL_B = `http://localhost:${PORT_B}`;
export const INSTANCE_URL_C = `http://localhost:${PORT_C}`;

// Config presets
export const CONFIG_BASIC: ConfigPresetName = 'high-distributedBasic';
export const CONFIG_THREE: ConfigPresetName = 'high-distributedThree';
export const CONFIG_MIXED: ConfigPresetName = 'high-distributedMixed';

// Model and job type identifiers
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Capacity constants
export const ESTIMATED_TOKENS = 10_000;
export const TPM_100K = 100_000;
export const TPM_90K = 90_000;
export const TPM_120K = 120_000;

// Token amounts
export const TOKENS_5K = 5000;
export const TOKENS_9K = 9000;
export const TOKENS_10K = 10_000;
export const TOKENS_15K = 15_000;
export const TOKENS_2K = 2000;
export const TOKENS_12K = 12_000;

// Shared constants
export const ZERO_COUNT = 0;
export const ZERO_TOKENS = 0;
export const ZERO_SLOTS = 0;
export const HTTP_ACCEPTED = 202;
export const SHORT_JOB_DURATION_MS = 100;
export const JOB_COMPLETE_TIMEOUT_MS = 30_000;

// Job count constants
export const FIVE_JOBS = 5;
export const EIGHT_JOBS = 8;
export const FOUR_JOBS = 4;
export const THREE_JOBS = 3;
export const TWO_JOBS = 2;

// Instance count divisors
export const TWO_INSTANCES = 2;
export const THREE_INSTANCE_DIVISOR = 3;

// Index increment for recursive functions
const INDEX_INCREMENT = 1;

// Tolerance for toBeCloseTo
export const CLOSE_TOLERANCE_NEG3 = -3;

// Max slots after 75K usage
export const MAX_SLOT_AFTER_OVERAGE = 1;

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

/** Submit a single sequential job and wait for completion */
const submitOneAndWait = async (baseUrl: string, jobId: string, actualInputTokens: number): Promise<void> => {
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
 * Submit sequential jobs with completion wait between each (recursive)
 */
export const submitSequentialJobs = async (
  baseUrl: string,
  count: number,
  actualInputTokens: number,
  currentIndex?: number
): Promise<void> => {
  const index = currentIndex ?? ZERO_COUNT;
  if (index >= count) {
    return;
  }
  await submitOneAndWait(baseUrl, `job-${index}`, actualInputTokens);
  await submitSequentialJobs(baseUrl, count, actualInputTokens, index + INDEX_INCREMENT);
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
 * Boot three instances with the given config preset
 */
export const setupThreeInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, configPreset);
  await bootInstance(PORT_B, configPreset);
  await bootInstance(PORT_C, configPreset);
  await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === THREE_INSTANCE_DIVISOR);
  await waitForAllocationUpdate(PORT_B, (alloc) => alloc.instanceCount === THREE_INSTANCE_DIVISOR);
  await waitForAllocationUpdate(PORT_C, (alloc) => alloc.instanceCount === THREE_INSTANCE_DIVISOR);
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
