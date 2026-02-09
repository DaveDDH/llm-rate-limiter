/**
 * Helper functions and constants for fixed ratio protection tests (16.1-16.3).
 *
 * Verifies that fixed (non-flexible) job types maintain their allocated slots
 * even when flexible job types experience heavy load.
 *
 * Config presets used:
 * - medium-fixedProtection-twoType: fixedType(0.4, fixed) + flexType(0.6, flex)
 * - medium-fixedProtection-threeType: fixedType(0.3, fixed) + flexJobA(0.35, flex) + flexJobB(0.35, flex)
 * - medium-fixedProtection-multiFixed: fixedA(0.3, fixed) + fixedB(0.3, fixed) + flexC(0.4, flex)
 *
 * All configs: model-alpha TPM=100K, tokens=10K per job.
 * 1 instance: totalSlots = floor(100K/10K/1) = 10.
 */
import { bootInstance, cleanRedis, killAllInstances, waitForAllocationUpdate } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;

// Instance constants
export const INSTANCE_PORT = 3001;
export const INSTANCE_URL = `http://localhost:${INSTANCE_PORT}`;

// Instance counts
const SINGLE_INSTANCE = 1;

// Config preset names
export const TWO_TYPE_CONFIG: ConfigPresetName = 'medium-fixedProtection-twoType';
export const THREE_TYPE_CONFIG: ConfigPresetName = 'medium-fixedProtection-threeType';
export const MULTI_FIXED_CONFIG: ConfigPresetName = 'medium-fixedProtection-multiFixed';

// Slot constants for two-type config (test 16.1)
// totalSlots=10, fixedType: floor(10*0.4)=4, flexType: floor(10*0.6)=6
export const TWO_TYPE_FIXED_SLOTS = 4;
export const TWO_TYPE_FLEX_SLOTS = 6;
export const TWO_TYPE_TOTAL_SLOTS = 10;

// Slot constants for three-type config (test 16.2)
// totalSlots=10, fixedType: floor(10*0.3)=3, flexJobA: floor(10*0.35)=3, flexJobB: floor(10*0.35)=3
export const THREE_TYPE_FIXED_SLOTS = 3;
export const THREE_TYPE_FLEX_A_SLOTS = 3;
export const THREE_TYPE_FLEX_B_SLOTS = 3;

// Slot constants for multi-fixed config (test 16.3)
// totalSlots=10, fixedA: floor(10*0.3)=3, fixedB: floor(10*0.3)=3, flexC: floor(10*0.4)=4
export const MULTI_FIXED_A_SLOTS = 3;
export const MULTI_FIXED_B_SLOTS = 3;
export const MULTI_FLEX_C_SLOTS = 4;

// Job configuration
export const HEAVY_LOAD_JOB_COUNT = 20;
export const SINGLE_JOB_COUNT = 1;
export const LONG_JOB_DURATION_MS = 2000;
export const SHORT_JOB_DURATION_MS = 100;
export const JOB_START_DELAY_MS = 500;
export const JOB_START_SHORT_DELAY_MS = 200;
export const FIXED_JOB_SETTLE_MS = 2000;
export const MAX_FIXED_QUEUE_DURATION_MS = 5000;

// Shared constants
export const HTTP_ACCEPTED = 202;
export const ZERO_COUNT = 0;

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

/** Stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<string, unknown>;
    jobTypes?: JobTypeStats;
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
export const getAllocatedSlots = (jobTypeStats: JobTypeStats, jobType: string): number => {
  const { allocatedSlots } = lookupJobType(jobTypeStats, jobType);
  return allocatedSlots;
};

/** Get in-flight count for a specific job type */
export const getInFlight = (jobTypeStats: JobTypeStats, jobType: string): number => {
  const { inFlight } = lookupJobType(jobTypeStats, jobType);
  return inFlight;
};

/** Submit a single job to an instance */
export const submitJob = async (
  baseUrl: string,
  jobId: string,
  jobType: string,
  durationMs: number
): Promise<number> => {
  const response = await fetch(`${baseUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType,
      payload: { testData: `Test job ${jobId}`, durationMs },
    }),
  });
  return response.status;
};

/** Boot a single instance and wait for allocation propagation */
export const setupSingleInstance = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT, configPreset);
  await waitForAllocationUpdate(INSTANCE_PORT, (allocation) => allocation.instanceCount === SINGLE_INSTANCE);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Type guard for active jobs response */
const isActiveJobsData = (value: unknown): value is { count: number } =>
  typeof value === 'object' && value !== null && 'count' in value;

/** Poll until no active jobs remain (recursive) */
const pollUntilNoActiveJobs = async (
  baseUrl: string,
  startTime: number,
  timeoutMs: number
): Promise<void> => {
  if (Date.now() - startTime >= timeoutMs) {
    throw new Error('Timeout waiting for jobs to complete');
  }

  const response = await fetch(`${baseUrl}/api/debug/active-jobs`);
  const data: unknown = await response.json();

  if (isActiveJobsData(data) && data.count === ZERO_COUNT) {
    return;
  }

  await sleep(POLL_INTERVAL_MS);
  await pollUntilNoActiveJobs(baseUrl, startTime, timeoutMs);
};

/** Wait for all active jobs to complete */
export const waitForNoActiveJobs = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  await pollUntilNoActiveJobs(baseUrl, Date.now(), timeoutMs);
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
