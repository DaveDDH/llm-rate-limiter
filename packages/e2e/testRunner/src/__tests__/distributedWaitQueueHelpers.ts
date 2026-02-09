/**
 * Helper functions and constants for distributed wait queue tests (Test 40).
 *
 * Config: highest-distributedWaitQueue
 * - model-alpha: TPM=20K
 * - jobTypeA: estimatedTokens=10K, maxWaitMS=30s
 * - 2 instances: 1 slot each
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';

import {
  bootInstance,
  cleanRedis,
  killAllInstances,
  killInstance,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const INSTANCE_CLEANUP_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 100;
const JOB_COMPLETE_TIMEOUT_MS = 60000;

// Ports
export const PORT_A = 4001;
export const PORT_B = 4002;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'highest-distributedWaitQueue';

// Model and job type
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Slot expectations
export const ONE_SLOT = 1;
export const TWO_SLOTS = 2;
export const TWO_INSTANCES = 2;
export const ONE_INSTANCE = 1;

// HTTP status
export const HTTP_ACCEPTED = 202;

// Job duration
export const MEDIUM_JOB_DURATION_MS = 3000;
export const QUEUE_DURATION_THRESHOLD_MS = 2800;
export const REALLOCATION_WAKE_THRESHOLD_MS = 5000;

/** Allocation response from the debug endpoint */
export interface AllocationResponse {
  instanceId: string;
  timestamp: number;
  allocation: AllocationInfo | null;
}

/** Job result response */
interface JobResultResponse {
  jobId: string;
  status: string;
  modelUsed?: string;
  queueDuration?: number;
}

/** Type guard for JobResultResponse */
const isJobResultResponse = (value: unknown): value is JobResultResponse =>
  typeof value === 'object' && value !== null && 'jobId' in value && 'status' in value;

/** Get pool slots for a model */
export const getModelPoolSlots = (
  allocationResponse: AllocationResponse,
  modelId: string
): number | undefined => {
  const pools = allocationResponse.allocation?.pools;
  if (pools === undefined) {
    return undefined;
  }
  return pools[modelId]?.totalSlots;
};

/** Submit a job */
export const submitJob = async (
  port: number,
  jobId: string,
  jobType: string,
  durationMs: number
): Promise<number> => {
  const response = await fetch(`http://localhost:${port}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType,
      payload: { durationMs },
    }),
  });
  return response.status;
};

/** Try to fetch a job result from an instance */
const tryFetchJobResult = async (port: number, jobId: string): Promise<JobResultResponse | null> => {
  try {
    const response = await fetch(`http://localhost:${port}/api/debug/job-result/${jobId}`);
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    return isJobResultResponse(data) ? data : null;
  } catch {
    return null;
  }
};

/** Poll for job result recursively */
const pollJobResultRecursive = async (
  port: number,
  jobId: string,
  startTime: number,
  timeoutMs: number
): Promise<JobResultResponse | null> => {
  if (Date.now() - startTime >= timeoutMs) {
    return null;
  }

  const result = await tryFetchJobResult(port, jobId);
  if (result !== null) {
    return result;
  }

  await sleep(POLL_INTERVAL_MS);
  return await pollJobResultRecursive(port, jobId, startTime, timeoutMs);
};

/** Wait for job result */
export const waitForJobResult = async (
  port: number,
  jobId: string,
  timeoutMs = JOB_COMPLETE_TIMEOUT_MS
): Promise<JobResultResponse> => {
  const result = await pollJobResultRecursive(port, jobId, Date.now(), timeoutMs);
  if (result === null) {
    throw new Error(`Timeout waiting for job result: ${jobId}`);
  }
  return result;
};

/** Setup two instances */
export const setupTwoInstances = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();

  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(PORT_B, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Kill instance B and wait for reallocation */
export const killInstanceBAndWaitForReallocation = async (): Promise<void> => {
  await killInstance(PORT_B);
  await waitForAllocationUpdate(
    PORT_A,
    (alloc) => alloc.instanceCount === ONE_INSTANCE,
    INSTANCE_CLEANUP_TIMEOUT_MS
  );
};

// Re-export for convenience
export { fetchAllocation, killAllInstances } from '../instanceLifecycle.js';
