/**
 * Helper functions and constants for flexible ratio adjustment tests (17.1-17.9).
 *
 * Uses the flexibleRatio config preset:
 * - flex-model: 100K TPM, single model
 * - flexJobA, flexJobB, flexJobC: 10K tokens, ratio 0.33 each, all flexible
 *
 * Single instance: totalSlots = floor(100K / 10K / 1) = 10
 * Per-type: allocatedSlots = floor(10 * 0.33) = 3
 *
 * Defaults for ratioAdjustmentConfig (from core):
 * - highLoadThreshold: 0.7 (70%)
 * - lowLoadThreshold: 0.3 (30%)
 * - maxAdjustment: 0.2 (20%)
 * - minRatio: 0.01 (1%)
 * - adjustmentIntervalMs: 5000 (5s)
 * - releasesPerAdjustment: 10
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

// Instance count
const SINGLE_INSTANCE = 1;

// Config preset
export const FLEX_CONFIG: ConfigPresetName = 'flexibleRatio';

// Slot calculation: single instance, 100K TPM, 10K tokens/job
// totalSlots = floor(100K / 10K / 1) = 10
// Per-type: floor(10 * 0.33) = 3
export const TOTAL_SLOTS = 10;
export const INITIAL_SLOTS_PER_TYPE = 3;
export const INITIAL_RATIO = 0.33;

// Thresholds (defaults from RatioAdjustmentConfig)
export const HIGH_LOAD_THRESHOLD = 0.7;
export const LOW_LOAD_THRESHOLD = 0.3;
export const MAX_ADJUSTMENT = 0.2;
export const MIN_RATIO = 0.01;

// Ratio sum tolerance
export const RATIO_SUM_TOLERANCE = 0.01;
export const EXPECTED_RATIO_SUM = 1.0;

// Job counts for load creation
export const ZERO_COUNT = 0;
export const HTTP_ACCEPTED = 202;

// Duration for long-running jobs (keep alive during tests)
export const LONG_JOB_DURATION_MS = 30000;

// Wait time for adjustment cycle (default interval is 5s)
export const ADJUSTMENT_WAIT_MS = 7000;

// Small tolerance for ratio comparison
export const RATIO_TOLERANCE = 0.001;

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

/** Get job type stats, throwing if absent */
export const getJobTypeStats = (resp: StatsResponse): JobTypeStats => {
  const {
    stats: { jobTypes },
  } = resp;
  if (jobTypes === undefined) {
    throw new Error('No jobTypes in stats response');
  }
  return jobTypes;
};

/** Look up a single job type state */
export const lookupJobType = (jts: JobTypeStats, jobType: string): JobTypeState => {
  const {
    jobTypes: { [jobType]: state },
  } = jts;
  if (state === undefined) {
    throw new Error(`Job type "${jobType}" not found in stats`);
  }
  return state;
};

/** Get currentRatio for a job type */
export const getCurrentRatio = (jts: JobTypeStats, jobType: string): number =>
  lookupJobType(jts, jobType).currentRatio;

/** Get initialRatio for a job type */
export const getInitialRatio = (jts: JobTypeStats, jobType: string): number =>
  lookupJobType(jts, jobType).initialRatio;

/** Get allocatedSlots for a job type */
export const getAllocatedSlots = (jts: JobTypeStats, jobType: string): number =>
  lookupJobType(jts, jobType).allocatedSlots;

/** Get inFlight for a job type */
export const getInFlight = (jts: JobTypeStats, jobType: string): number =>
  lookupJobType(jts, jobType).inFlight;

/** Submit a job to the instance directly */
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
      payload: { testData: `Job ${jobId}`, durationMs },
    }),
  });
  return response.status;
};

/** Submit N long-running jobs of a given type */
export const submitLongRunningJobs = async (
  baseUrl: string,
  jobType: string,
  count: number,
  prefix: string
): Promise<void> => {
  const submissions = Array.from({ length: count }, async (_, i) => {
    const jobId = `${prefix}-${Date.now()}-${i}`;
    await submitJob(baseUrl, jobId, jobType, LONG_JOB_DURATION_MS);
  });
  await Promise.all(submissions);
};

/** Sum all currentRatios for all job types */
export const sumCurrentRatios = (jts: JobTypeStats): number => {
  let sum = ZERO_COUNT;
  for (const state of Object.values(jts.jobTypes)) {
    sum += state.currentRatio;
  }
  return sum;
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
