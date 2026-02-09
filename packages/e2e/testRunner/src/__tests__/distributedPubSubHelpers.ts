/**
 * Helper functions and constants for distributed pub/sub tests (Test 31).
 *
 * Config: high-distributedPubSub
 * - model-alpha: TPM=100K, RPM=500
 * - model-beta: TPM=50K
 * - jobTypeA: estimatedTokens=10K, estimatedRequests=2, ratio=1.0
 */
import { bootInstance, cleanRedis, fetchAllocation, killAllInstances } from '../instanceLifecycle.js';
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

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'high-distributedPubSub';

// Model and job type identifiers
export const MODEL_ALPHA = 'model-alpha';
export const MODEL_BETA = 'model-beta';
export const JOB_TYPE = 'jobTypeA';

// Capacity constants
export const TPM_100K = 100_000;
export const TPM_50K = 50_000;
export const RPM_500 = 500;
export const ESTIMATED_TOKENS = 10_000;
export const ESTIMATED_REQUESTS = 2;

// Token amounts
export const TOKENS_8K = 8000;

// Shared constants
export const ZERO_COUNT = 0;
export const HTTP_ACCEPTED = 202;
export const SHORT_JOB_DURATION_MS = 100;
export const JOB_COMPLETE_TIMEOUT_MS = 10_000;

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

/**
 * Boot two instances with the given config preset
 */
export const setupTwoInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(PORT_B, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/**
 * Boot three instances with the given config preset
 */
export const setupThreeInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(PORT_B, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(PORT_C, configPreset);
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
export { killAllInstances, fetchAllocation };
