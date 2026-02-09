/**
 * Helper functions and constants for two-layer acquire/release tests (24.1-24.3).
 *
 * Config: high-twoLayer
 * - model-alpha: maxConcurrentRequests=10
 * - jobTypeA: ratio=0.6 (6 slots), jobTypeB: ratio=0.4 (4 slots)
 * - 1 instance: totalSlots = 10
 */
import { bootInstance, cleanRedis, killAllInstances, waitForAllocationUpdate } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;

// Instance constants
export const INSTANCE_PORT = 3001;
export const INSTANCE_PORT_A = 3001;
export const INSTANCE_PORT_B = 3002;
export const INSTANCE_URL = `http://localhost:${INSTANCE_PORT}`;
export const INSTANCE_URL_A = `http://localhost:${INSTANCE_PORT_A}`;
export const INSTANCE_URL_B = `http://localhost:${INSTANCE_PORT_B}`;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'high-twoLayer';

// Model and job type identifiers
export const MODEL_ID = 'model-alpha';
export const JOB_TYPE_A = 'jobTypeA';
export const JOB_TYPE_B = 'jobTypeB';

// Capacity constants (from config)
export const MAX_CONCURRENT = 10;
export const JOB_TYPE_A_RATIO = 0.6;
export const JOB_TYPE_B_RATIO = 0.4;
export const TOTAL_SLOTS_SINGLE = 10;
export const TOTAL_SLOTS_TWO_INSTANCES = 5;

// Test 24.1: Two-layer check (single instance)
export const JOB_TYPE_A_SLOTS_SINGLE = 6;
export const SUBMIT_COUNT_TEST_ONE = 6;
export const EXPECTED_RUNNING_TEST_ONE = 5;
export const EXPECTED_QUEUED_TEST_ONE = 1;

// Test 24.2: In-flight constraint (two instances)
export const JOB_TYPE_A_SLOTS_TWO = 3;
export const JOB_TYPE_B_SLOTS_TWO = 2;
export const SUBMIT_JOB_TYPE_A_COUNT = 3;
export const SUBMIT_ADDITIONAL_A_COUNT = 1;
export const SUBMIT_JOB_TYPE_B_COUNT = 1;

// Test 24.3: Release decrements counter
export const ACQUIRE_COUNT = 10;
export const RELEASE_COUNT = 3;
export const REMAINING_IN_FLIGHT = 7;
export const ZERO_IN_FLIGHT = 0;

// Shared constants
export const HTTP_ACCEPTED = 202;
export const ZERO_COUNT = 0;
export const LONG_JOB_DURATION_MS = 5000;
export const SHORT_JOB_DURATION_MS = 100;
export const JOB_COMPLETE_TIMEOUT_MS = 10000;
export const JOB_SETTLE_MS = 500;
export const SINGLE_INSTANCE_COUNT = 1;
export const TWO_INSTANCE_COUNT = 2;

/** Job type state from stats */
export interface JobTypeState {
  currentRatio: number;
  initialRatio: number;
  flexible: boolean;
  inFlight: number;
  allocatedSlots: number;
  resources: Record<string, unknown>;
}

/** Job type stats from stats endpoint */
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

/** Active jobs response */
interface ActiveJobsResponse {
  count: number;
}

/** Type guard for StatsResponse */
const isStatsResponse = (value: unknown): value is StatsResponse => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return 'stats' in value && 'instanceId' in value;
};

/** Type guard for ActiveJobsResponse */
const isActiveJobsResponse = (value: unknown): value is ActiveJobsResponse =>
  typeof value === 'object' && value !== null && 'count' in value;

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

/** Look up a job type state */
const lookupJobType = (jobTypeStats: JobTypeStats, jobType: string): JobTypeState => {
  const {
    jobTypes: { [jobType]: state },
  } = jobTypeStats;
  if (state === undefined) {
    throw new Error(`Job type "${jobType}" not found`);
  }
  return state;
};

/** Get in-flight count for a job type */
export const getInFlight = (jobTypeStats: JobTypeStats, jobType: string): number => {
  const { inFlight } = lookupJobType(jobTypeStats, jobType);
  return inFlight;
};

/** Get allocated slots for a job type */
export const getAllocatedSlots = (jobTypeStats: JobTypeStats, jobType: string): number => {
  const { allocatedSlots } = lookupJobType(jobTypeStats, jobType);
  return allocatedSlots;
};

/** Options for submitting a job */
export interface SubmitJobOptions {
  baseUrl: string;
  jobId: string;
  jobType: string;
  durationMs: number;
  extraPayload?: Record<string, unknown>;
}

/** Submit a job */
export const submitJob = async (options: SubmitJobOptions): Promise<number> => {
  const { baseUrl, jobId, jobType, durationMs, extraPayload } = options;
  const response = await fetch(`${baseUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType,
      payload: { durationMs, ...extraPayload },
    }),
  });
  return response.status;
};

/** Options for batch job submission */
export interface SubmitJobBatchOptions {
  baseUrl: string;
  prefix: string;
  jobType: string;
  count: number;
  durationMs: number;
}

/** Submit multiple jobs of a given type and wait for them to settle */
export const submitJobBatch = async (options: SubmitJobBatchOptions): Promise<void> => {
  const { baseUrl, prefix, jobType, count, durationMs } = options;
  const submissions = Array.from({ length: count }, async (_, i) => {
    const jobId = `${prefix}-${Date.now()}-${i}`;
    const status = await submitJob({ baseUrl, jobId, jobType, durationMs });
    expect(status).toBe(HTTP_ACCEPTED);
  });
  await Promise.all(submissions);
  await sleep(JOB_SETTLE_MS);
};

/** Boot a single instance */
export const setupSingleInstance = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT, configPreset);
  await waitForAllocationUpdate(
    INSTANCE_PORT,
    (allocation) => allocation.instanceCount === SINGLE_INSTANCE_COUNT
  );
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Boot two instances */
export const setupTwoInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_A, configPreset);
  await bootInstance(INSTANCE_PORT_B, configPreset);
  await waitForAllocationUpdate(
    INSTANCE_PORT_A,
    (allocation) => allocation.instanceCount === TWO_INSTANCE_COUNT
  );
  await waitForAllocationUpdate(
    INSTANCE_PORT_B,
    (allocation) => allocation.instanceCount === TWO_INSTANCE_COUNT
  );
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Poll until no active jobs remain */
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

  if (isActiveJobsResponse(data) && data.count === ZERO_COUNT) {
    return;
  }

  await sleep(POLL_INTERVAL_MS);
  await pollUntilNoActiveJobs(baseUrl, startTime, timeoutMs);
};

/** Wait for all active jobs to complete */
export const waitForNoActiveJobs = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  await pollUntilNoActiveJobs(baseUrl, Date.now(), timeoutMs);
};

/** Submit a single job and verify it was accepted, then wait for settle */
export const submitSingleJobAndSettle = async (
  baseUrl: string,
  prefix: string,
  jobType: string,
  durationMs: number
): Promise<void> => {
  const jobId = `${prefix}-${Date.now()}`;
  const status = await submitJob({ baseUrl, jobId, jobType, durationMs });
  expect(status).toBe(HTTP_ACCEPTED);
  await sleep(JOB_SETTLE_MS);
};

/** Verify all in-flight counts are zero for given job types */
export const verifyAllJobsComplete = async (baseUrl: string, jobTypes: readonly string[]): Promise<void> => {
  await waitForNoActiveJobs(baseUrl, JOB_COMPLETE_TIMEOUT_MS);
  const stats = await fetchStats(baseUrl);
  const jobTypeStats = getJobTypeStats(stats);
  jobTypes.forEach((jobType) => {
    expect(getInFlight(jobTypeStats, jobType)).toBe(ZERO_COUNT);
  });
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
