/**
 * Helper functions and constants for distributed ratio management tests (Test 37).
 *
 * Config: flexibleRatio (reused)
 * - flex-model: TPM=100K
 * - flexJobA, flexJobB, flexJobC: 10K tokens each, ratio=0.33 each
 * - 2 instances: floor(100K / 10K / 2) = 5 slots per instance
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';

import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const JOB_SETTLE_MS = 500;

// Ports for two-instance distributed tests
export const PORT_A = 4001;
export const PORT_B = 4002;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'flexibleRatio';

// Model and job type identifiers
export const MODEL_ID = 'flex-model';
export const JOB_TYPE_A = 'flexJobA';
export const JOB_TYPE_B = 'flexJobB';
export const JOB_TYPE_C = 'flexJobC';

// Pool slot expectations
export const FIVE_SLOTS = 5;
export const TWO_INSTANCES = 2;

// Ratio constants
export const INITIAL_RATIO = 0.33;
export const RATIO_TOLERANCE = 0.02;

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

/** Stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<
      string,
      {
        jobTypes?: Record<string, { ratio: number }>;
      }
    >;
  };
}

/** Type guard for StatsResponse */
const isStatsResponse = (value: unknown): value is StatsResponse => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return 'stats' in value && 'instanceId' in value;
};

/** Fetch stats from an instance */
export const fetchStats = async (port: number): Promise<StatsResponse> => {
  const response = await fetch(`http://localhost:${port}/api/debug/stats`);
  const data: unknown = await response.json();
  if (!isStatsResponse(data)) {
    throw new Error('Invalid stats response');
  }
  return data;
};

/** Get ratio for a job type from stats */
export const getJobTypeRatio = (stats: StatsResponse, modelId: string, jobType: string): number | undefined =>
  stats.stats.models[modelId]?.jobTypes?.[jobType]?.ratio;

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

/** Submit a job with optional payload */
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

/** Setup two-instance infrastructure */
export const setupTwoInstances = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();

  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(PORT_B, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Wait for job settle time */
export const waitForJobSettle = async (): Promise<void> => {
  await sleep(JOB_SETTLE_MS);
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
