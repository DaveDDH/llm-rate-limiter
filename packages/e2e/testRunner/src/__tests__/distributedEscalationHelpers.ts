/**
 * Helper functions and constants for distributed escalation tests (Test 41).
 *
 * Config: highest-distributedEscalation
 * - model-alpha: TPM=50K (2 instances → 25K each)
 * - model-beta: TPM=1M (large)
 * - jobTypeA: estimatedTokens=10K, maxWaitMS=0 (immediate escalation)
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';

import { bootInstance, cleanRedis, fetchAllocation, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 100;
const JOB_COMPLETE_TIMEOUT_MS = 60000;

// Ports
export const PORT_A = 4001;
export const PORT_B = 4002;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'highest-distributedEscalation';

// Model and job type
export const MODEL_ALPHA = 'model-alpha';
export const MODEL_BETA = 'model-beta';
export const JOB_TYPE = 'jobTypeA';

// Capacity constants
export const ALPHA_TPM_TOTAL = 50000;
export const ALPHA_TPM_PER_INSTANCE = 25000;
export const BETA_TPM_TOTAL = 1000000;
export const ESTIMATED_TOKENS = 10000;

// Slot expectations
export const ALPHA_SLOTS_PER_INSTANCE = 2;
export const TWO_INSTANCES = 2;

// HTTP status
export const HTTP_ACCEPTED = 202;

// Numeric constants for assertions
export const LOOP_INCREMENT = 1;
export const ZERO_SLOTS = 0;

// Job duration
export const SHORT_JOB_DURATION_MS = 100;
export const MEDIUM_JOB_DURATION_MS = 3000;

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

/** Attempt to fetch a job result from the debug endpoint */
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

/** Fill all alpha slots on a given port and verify all are accepted */
export const fillAlphaSlots = async (port: number, prefix: string): Promise<void> => {
  const fillJobs = Array.from(
    { length: ALPHA_SLOTS_PER_INSTANCE },
    async (_, i) => await submitJob(port, `${prefix}-${i}`, JOB_TYPE, MEDIUM_JOB_DURATION_MS)
  );
  const results = await Promise.all(fillJobs);
  results.forEach((status) => {
    expect(status).toBe(HTTP_ACCEPTED);
  });
};

/** Verify allocation instance count on both ports */
export const verifyInstanceCount = async (): Promise<void> => {
  const allocA = await fetchAllocation(PORT_A);
  const allocB = await fetchAllocation(PORT_B);
  expect(allocA.allocation?.instanceCount).toBe(TWO_INSTANCES);
  expect(allocB.allocation?.instanceCount).toBe(TWO_INSTANCES);
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

// Re-export for convenience
export { fetchAllocation, killAllInstances } from '../instanceLifecycle.js';
