/**
 * Helper functions and constants for distributed memory independence tests (Test 38).
 *
 * Config: highest-memoryDistributed
 * - model-alpha: TPM=1M (very high, not limiting)
 * - jobTypeA: estimatedMemoryKB=10MB
 * - Instance A: 100MB memory (10 memory slots)
 * - Instance B: 200MB memory (20 memory slots)
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';

import {
  type BootInstanceOptions,
  bootInstance,
  cleanRedis,
  killAllInstances,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;

// Ports for two-instance distributed tests
export const PORT_A = 4001;
export const PORT_B = 4002;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'highest-memoryDistributed';

// Model and job type identifiers
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE = 'jobTypeA';

// Memory configurations
export const MEMORY_A_MB = 100;
export const MEMORY_B_MB = 200;
export const ESTIMATED_MEMORY_MB = 10;

// Expected memory slots
export const MEMORY_SLOTS_A = 10;
export const MEMORY_SLOTS_B = 20;

// Pool slot expectations (from distributed allocation)
export const DISTRIBUTED_POOL_SLOTS = 100;
export const TWO_INSTANCES = 2;

// HTTP status
export const HTTP_ACCEPTED = 202;

// Job duration
export const SHORT_JOB_DURATION_MS = 100;

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

/** Setup two instances with different memory limits */
export const setupTwoInstancesWithMemory = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();

  const optionsA: BootInstanceOptions = { maxMemoryMB: MEMORY_A_MB };
  const optionsB: BootInstanceOptions = { maxMemoryMB: MEMORY_B_MB };

  await bootInstance(PORT_A, CONFIG_PRESET, optionsA);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(PORT_B, CONFIG_PRESET, optionsB);
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

// Re-export for convenience
export { fetchAllocation, killAllInstances } from '../instanceLifecycle.js';
