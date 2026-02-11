/**
 * Helper functions and constants for cross-instance propagation additional tests (30.6-30.7).
 *
 * Tests verify refund and overage propagation across instances.
 *
 * Config: high-distributedBasic
 * - model-alpha: TPM=100K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - 2 instances: 50K TPM per instance initially
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
export const CONFIG_BASIC: ConfigPresetName = 'high-distributedBasic';

// Model and job type identifiers
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Instance constants
export const TWO_INSTANCES = 2;

// Capacity constants
export const TOTAL_TPM = 100_000;
export const INITIAL_PER_INSTANCE = 50_000;
export const ESTIMATED_TOKENS = 10_000;

// Refund test constants (30.6)
export const REFUND_ACTUAL_INPUT = 6000;
export const REFUND_ACTUAL_OUTPUT = 0;
export const REFUND_TOTAL_USED = 6000;

// Overage test constants (30.7)
export const OVERAGE_ACTUAL_INPUT = 15_000;
export const OVERAGE_ACTUAL_OUTPUT = 0;
export const OVERAGE_TOTAL_USED = 15_000;

// Expected per-instance TPM after refund: (100K - 6K) / 2 = 47K
export const TPM_AFTER_REFUND = 47_000;

// Expected per-instance TPM after overage: (100K - 15K) / 2 = 42.5K
export const TPM_AFTER_OVERAGE = 42_500;

// Shared constants
export const ZERO_TOKENS = 0;
export const HTTP_ACCEPTED = 202;
export const SHORT_JOB_DURATION_MS = 100;
export const JOB_COMPLETE_TIMEOUT_MS = 30_000;

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
 * Submit a job with actual usage overrides
 */
export const submitJobWithUsage = async (
  baseUrl: string,
  jobId: string,
  actualInputTokens: number,
  actualOutputTokens: number
): Promise<number> => {
  const response = await fetch(`${baseUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType: JOB_TYPE,
      payload: {
        durationMs: SHORT_JOB_DURATION_MS,
        actualInputTokens,
        actualOutputTokens,
      },
    }),
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

  if (isActiveJobsResponse(data) && data.count === ZERO_TOKENS) {
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
