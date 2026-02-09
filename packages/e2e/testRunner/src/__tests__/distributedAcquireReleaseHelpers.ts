/**
 * Helper functions and constants for distributed acquire/release tests (Test 39).
 *
 * Config: highest-distributedAcquire (39.1), highest-acquireAtomicity (39.2)
 * - 39.1: model-alpha: TPM=20K, 2 instances → 1 slot each
 * - 39.2: model-alpha: maxConcurrentRequests=100, 1 instance
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';

import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 100;
const ACQUIRE_TIMEOUT_MS = 10000;

// Ports
export const PORT_A = 4001;
export const PORT_B = 4002;
export const PORT_SINGLE = 4001;

// Config presets
export const CONFIG_DISTRIBUTED_ACQUIRE: ConfigPresetName = 'highest-distributedAcquire';
export const CONFIG_ACQUIRE_ATOMICITY: ConfigPresetName = 'highest-acquireAtomicity';

// Model and job type
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Slot expectations
export const ONE_SLOT = 1;
export const TWO_INSTANCES = 2;
export const CONCURRENT_100 = 100;

// HTTP status
export const HTTP_ACCEPTED = 202;

// Job duration
export const SHORT_JOB_DURATION_MS = 100;
export const MEDIUM_JOB_DURATION_MS = 3000;

/** Allocation response from the debug endpoint */
export interface AllocationResponse {
  instanceId: string;
  timestamp: number;
  allocation: AllocationInfo | null;
}

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

/** Setup two instances */
export const setupTwoInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();

  await bootInstance(PORT_A, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(PORT_B, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Setup single instance */
export const setupSingleInstance = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();

  await bootInstance(PORT_SINGLE, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Active jobs response */
interface ActiveJobsResponse {
  count: number;
}

/** Type guard for ActiveJobsResponse */
const isActiveJobsResponse = (value: unknown): value is ActiveJobsResponse =>
  typeof value === 'object' && value !== null && 'count' in value;

/** Get active job count */
export const getActiveJobCount = async (port: number): Promise<number> => {
  const response = await fetch(`http://localhost:${port}/api/debug/active-jobs`);
  const data: unknown = await response.json();
  if (!isActiveJobsResponse(data)) {
    throw new Error('Invalid active jobs response');
  }
  return data.count;
};

/** Wait for active job count to reach expected value */
const pollActiveJobCount = async (
  port: number,
  expectedCount: number,
  startTime: number,
  timeoutMs: number
): Promise<boolean> => {
  if (Date.now() - startTime >= timeoutMs) {
    return false;
  }

  const count = await getActiveJobCount(port);
  if (count === expectedCount) {
    return true;
  }

  await sleep(POLL_INTERVAL_MS);
  return await pollActiveJobCount(port, expectedCount, startTime, timeoutMs);
};

/** Wait for active job count to reach expected value */
export const waitForActiveJobCount = async (
  port: number,
  expectedCount: number,
  timeoutMs = ACQUIRE_TIMEOUT_MS
): Promise<void> => {
  const success = await pollActiveJobCount(port, expectedCount, Date.now(), timeoutMs);
  if (!success) {
    throw new Error(`Timeout waiting for active job count to reach ${expectedCount}`);
  }
};

// Re-export for convenience
export { fetchAllocation, killAllInstances } from '../instanceLifecycle.js';
