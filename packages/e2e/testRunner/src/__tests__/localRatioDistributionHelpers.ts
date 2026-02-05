/**
 * Helper functions and constants for local ratio distribution tests (2.1–2.6).
 */
import { bootInstance, cleanRedis, killAllInstances, waitForAllocationUpdate } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;

// Instance constants
export const INSTANCE_PORT_A = 3001;
export const INSTANCE_A_URL = `http://localhost:${INSTANCE_PORT_A}`;

// Single instance count
const SINGLE_INSTANCE = 1;

// Expected slot values for test 2.1 (two types, totalSlots=10)
export const TWO_TYPE_SLOTS_A = 6;
export const TWO_TYPE_SLOTS_B = 4;
export const TWO_TYPE_TOTAL_SLOTS = 10;

// Expected slot values for test 2.2 (three types, totalSlots=100)
export const THREE_TYPE_SLOTS_A = 50;
export const THREE_TYPE_SLOTS_B = 30;
export const THREE_TYPE_SLOTS_C = 20;
export const THREE_TYPE_TOTAL_SLOTS = 100;

// Expected slot values for test 2.3 (equal three, totalSlots=10)
export const EQUAL_THREE_SLOTS_A = 3;
export const EQUAL_THREE_SLOTS_B = 3;
export const EQUAL_THREE_SLOTS_C = 3;
export const EQUAL_THREE_TOTAL_SLOTS = 10;

// Expected slot values for test 2.4 (single type, totalSlots=10)
export const SINGLE_TYPE_TOTAL_SLOTS = 10;

// Expected values for test 2.6 (zero allocation)
export const ZERO_ALLOCATED_SLOTS = 0;

// In-flight test constants (test 2.5)
export const SEVEN_IN_FLIGHT = 7;
export const SEVENTY_PERCENT_LOAD = 0.7;
export const LONG_JOB_DURATION_MS = 30000;

/** Job type state from the stats endpoint */
export interface JobTypeState {
  currentRatio: number;
  initialRatio: number;
  flexible: boolean;
  inFlight: number;
  allocatedSlots: number;
  resources: Record<string, unknown>;
}

/** Job type stats from the stats endpoint */
export interface JobTypeStats {
  jobTypes: Record<string, JobTypeState>;
  totalSlots: number;
  lastAdjustmentTime: number | null;
}

/** Full stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<string, unknown>;
    memory?: Record<string, unknown>;
    jobTypes?: JobTypeStats;
  };
}

/** Check if value has stats property */
const hasStatsProperty = (value: object): value is { stats: unknown } => 'stats' in value;

/** Type guard for StatsResponse */
const isStatsResponse = (value: unknown): value is StatsResponse => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!hasStatsProperty(value)) {
    return false;
  }
  return typeof value.stats === 'object' && value.stats !== null;
};

/** Fetch stats from an instance */
export const fetchStats = async (baseUrl: string): Promise<StatsResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/stats`);
  const data: unknown = await response.json();
  if (!isStatsResponse(data)) {
    throw new Error('Invalid stats response');
  }
  return data;
};

/** Get job type stats from a stats response */
export const getJobTypeStats = (statsResponse: StatsResponse): JobTypeStats => {
  const {
    stats: { jobTypes },
  } = statsResponse;
  if (jobTypes === undefined) {
    throw new Error('No jobTypes in stats response');
  }
  return jobTypes;
};

/** Look up a job type state, throwing if not found */
const lookupJobType = (jobTypeStats: JobTypeStats, jobType: string): JobTypeState => {
  const {
    jobTypes: { [jobType]: state },
  } = jobTypeStats;
  if (state === undefined) {
    throw new Error(`Job type "${jobType}" not found in stats`);
  }
  return state;
};

/** Get allocated slots for a specific job type */
export const getJobTypeAllocatedSlots = (jobTypeStats: JobTypeStats, jobType: string): number => {
  const { allocatedSlots } = lookupJobType(jobTypeStats, jobType);
  return allocatedSlots;
};

/** Get in-flight count for a specific job type */
export const getJobTypeInFlight = (jobTypeStats: JobTypeStats, jobType: string): number => {
  const { inFlight } = lookupJobType(jobTypeStats, jobType);
  return inFlight;
};

/** Boot a single instance and wait for allocation propagation */
export const setupSingleInstance = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_A, configPreset);
  await waitForAllocationUpdate(
    INSTANCE_PORT_A,
    (allocation) => allocation.instanceCount === SINGLE_INSTANCE
  );
  await sleep(ALLOCATION_PROPAGATION_MS);
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
