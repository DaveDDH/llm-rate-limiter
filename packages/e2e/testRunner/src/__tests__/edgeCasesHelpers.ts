/**
 * Helper functions and constants for edge cases tests (Test 47).
 *
 * Multiple config presets used:
 * - highest-edgeZeroSlots: TPM=15K, 4 instances → 0 slots
 * - highest-edgeFloor: TPM=20K, ratio=0.1 → floor=0
 * - highest-edgeAllFixed: Only fixed job types
 * - highest-edgeSingleFlex: Single flexible job type
 * - mh-escalationTpm: For maxWaitMS tests
 */
import type { AllocationResponse, BootInstanceOptions } from '../instanceLifecycle.js';
import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;

// Instance constants
export const INSTANCE_PORT = 3001;
export const INSTANCE_URL = `http://localhost:${INSTANCE_PORT}`;

// Port constants for distributed tests
export const PORT_A = 4001;
export const PORT_B = 4002;
export const PORT_C = 4003;
export const PORT_D = 4004;

// Model identifiers
export const MODEL_ALPHA = 'model-alpha';
export const MODEL_BETA = 'model-beta';

// Job types
export const JOB_TYPE_A = 'jobTypeA';
export const JOB_TYPE_B = 'jobTypeB';
export const JOB_TYPE_FIXED_A = 'fixedA';
export const JOB_TYPE_FIXED_B = 'fixedB';
export const JOB_TYPE_FLEXIBLE_ONLY = 'flexibleOnly';

// Instance counts
export const FOUR_INSTANCES = 4;
export const TWO_INSTANCES = 2;

// Memory constants
export const MEMORY_5MB = 5;
export const MEMORY_100MB = 100;

// Timing
export const SHORT_JOB_DURATION_MS = 100;
export const VERY_SHORT_WAIT_MS = 1;
export const LONG_WAIT_MS = 60000;
export const JOB_COMPLETE_TIMEOUT_MS = 10000;
export const IMMEDIATE_DELEGATION_MS = 100;
export const DELEGATION_TOLERANCE_MS = 100;

// HTTP status
export const HTTP_ACCEPTED = 202;

// Shared constants
export const ZERO_COUNT = 0;
export const ZERO_SLOTS = 0;
export const ONE_SLOT = 1;

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 90000;
export const AFTER_ALL_TIMEOUT_MS = 30000;
const { MAX_SAFE_INTEGER } = Number;
export const MAX_SAFE_INTEGER_WAIT: number = MAX_SAFE_INTEGER;

/** Job result from the job endpoint */
export interface JobResult {
  jobId: string;
  status: string;
  modelUsed?: string;
  startTime: number;
  endTime: number;
  queueDuration: number;
  executionDuration: number;
}

/** Job results response */
interface JobResultsResponse {
  results: JobResult[];
}

/** Active jobs response */
interface ActiveJobsResponse {
  count: number;
}

/** Type guard for JobResultsResponse */
const isJobResultsResponse = (value: unknown): value is JobResultsResponse =>
  typeof value === 'object' && value !== null && 'results' in value;

/** Type guard for ActiveJobsResponse */
const isActiveJobsResponse = (value: unknown): value is ActiveJobsResponse =>
  typeof value === 'object' && value !== null && 'count' in value;

/**
 * Get model slots from allocation response
 */
export const getModelSlots = (response: AllocationResponse, modelId: string): number | undefined => {
  const pools = response.allocation?.pools;
  if (pools === undefined) {
    return undefined;
  }
  return pools[modelId]?.totalSlots;
};

/** Options for submitting a job */
export interface SubmitJobOptions {
  baseUrl: string;
  jobId: string;
  jobType: string;
  durationMs: number;
  extraPayload?: Record<string, unknown>;
}

/**
 * Submit a job with optional payload
 */
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

/**
 * Fetch job results from an instance
 */
export const fetchJobResults = async (baseUrl: string): Promise<JobResult[]> => {
  const response = await fetch(`${baseUrl}/api/debug/job-results`);
  const data: unknown = await response.json();
  if (!isJobResultsResponse(data)) {
    throw new Error('Invalid job results response');
  }
  return data.results;
};

/**
 * Find a job result by ID
 */
export const findJobResult = (results: JobResult[], jobId: string): JobResult | undefined =>
  results.find((r) => r.jobId === jobId);

/**
 * Boot a single instance with the given config preset
 */
export const setupSingleInstance = async (
  configPreset: ConfigPresetName,
  options?: BootInstanceOptions
): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT, configPreset, options);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/**
 * Setup four instance test with a specific config
 */
export const setupFourInstanceTest = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, configPreset);
  await bootInstance(PORT_B, configPreset);
  await bootInstance(PORT_C, configPreset);
  await bootInstance(PORT_D, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/**
 * Setup two instance test with a specific config
 */
export const setupTwoInstanceTest = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, configPreset);
  await bootInstance(PORT_B, configPreset);
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

  if (isActiveJobsResponse(data) && data.count === ZERO_COUNT) {
    return;
  }

  await sleep(POLL_INTERVAL_MS);
  await pollUntilNoActiveJobs(baseUrl, startTime, timeoutMs);
};

/**
 * Wait for all active jobs to complete
 */
export const waitForJobComplete = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  await pollUntilNoActiveJobs(baseUrl, Date.now(), timeoutMs);
};

/** Job type state from stats endpoint */
export interface JobTypeState {
  currentRatio: number;
  initialRatio: number;
  flexible: boolean;
  inFlight: number;
  allocatedSlots: number;
}

/** Stats response from debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    jobTypes?: {
      jobTypes: Record<string, JobTypeState>;
      totalSlots: number;
    };
    models: Record<string, Record<string, unknown>>;
  };
}

/** Type guard for StatsResponse */
const isStatsResponse = (value: unknown): value is StatsResponse =>
  typeof value === 'object' && value !== null && 'stats' in value;

/** Fetch stats from an instance */
export const fetchStats = async (baseUrl: string): Promise<StatsResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/stats`);
  const data: unknown = await response.json();
  if (!isStatsResponse(data)) {
    throw new Error('Invalid stats response');
  }
  return data;
};

// Re-export for convenience
export { killAllInstances };
export { fetchAllocation } from '../instanceLifecycle.js';
