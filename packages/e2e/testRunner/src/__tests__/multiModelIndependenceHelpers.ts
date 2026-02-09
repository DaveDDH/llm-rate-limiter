/**
 * Helper functions and constants for multi-model independence tests (25.1-25.3).
 *
 * Config: high-multiModel
 * - model-alpha: TPM=100K
 * - model-beta: TPM=50K
 * - model-gamma: maxConcurrentRequests=20
 * - jobTypeA: ratio=0.6, jobTypeB: ratio=0.4
 * - 2 instances
 */
import {
  type AllocationResponse,
  bootInstance,
  cleanRedis,
  killAllInstances,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
const POLL_INTERVAL_MS = 200;

// Instance constants
export const INSTANCE_PORT_A = 3001;
export const INSTANCE_PORT_B = 3002;
export const INSTANCE_URL_A = `http://localhost:${INSTANCE_PORT_A}`;
export const INSTANCE_URL_B = `http://localhost:${INSTANCE_PORT_B}`;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'high-multiModel';

// Model identifiers
export const MODEL_ALPHA = 'model-alpha';
export const MODEL_BETA = 'model-beta';
export const MODEL_GAMMA = 'model-gamma';

// Job type identifiers
export const JOB_TYPE_A = 'jobTypeA';
export const JOB_TYPE_B = 'jobTypeB';

// Capacity constants (from config)
export const TPM_ALPHA = 100000;
export const TPM_BETA = 50000;
export const CONCURRENT_GAMMA = 20;
export const ESTIMATED_TOKENS = 10000;
export const TWO_INSTANCE_COUNT = 2;

// Test 25.1: Pool calculations (2 instances)
// model-alpha: floor(100K / 10K / 2) = 5 slots per instance
// model-beta: floor(50K / 10K / 2) = 2 slots per instance
// model-gamma: floor(20 / 2) = 10 slots per instance
export const ALPHA_SLOTS_PER_INSTANCE = 5;
export const BETA_SLOTS_PER_INSTANCE = 2;
export const GAMMA_SLOTS_PER_INSTANCE = 10;

// Test 25.3: Per-model ratio allocations (2 instances)
// model-alpha (5 pool slots): jobTypeA=floor(5*0.6)=3, jobTypeB=floor(5*0.4)=2
// model-beta (2 pool slots): jobTypeA=floor(2*0.6)=1, jobTypeB=floor(2*0.4)=0
export const ALPHA_JOB_A_SLOTS = 3;
export const ALPHA_JOB_B_SLOTS = 2;
export const BETA_JOB_A_SLOTS = 1;
export const BETA_JOB_B_SLOTS = 1;

// Shared constants
export const HTTP_ACCEPTED = 202;
export const ZERO_COUNT = 0;
export const LONG_JOB_DURATION_MS = 5000;
export const SHORT_JOB_DURATION_MS = 100;
export const JOB_COMPLETE_TIMEOUT_MS = 30000;
export const JOB_SETTLE_MS = 500;
export const RATIO_SIXTY = 0.6;
export const RATIO_FORTY = 0.4;

/** Job type state from stats */
export interface JobTypeState {
  currentRatio: number;
  initialRatio: number;
  flexible: boolean;
  inFlight: number;
  allocatedSlots: number;
  resources: Record<string, unknown>;
}

/** Per-model per-jobType info from modelJobTypes */
export interface ModelJobTypeInfo {
  allocated: number;
  inFlight: number;
}

/** Job type stats from stats endpoint */
export interface JobTypeStats {
  jobTypes: Record<string, JobTypeState>;
  totalSlots: number;
  lastAdjustmentTime: number | null;
  modelJobTypes?: Record<string, Record<string, ModelJobTypeInfo>>;
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

/** Get per-model allocated slots for a specific (model, jobType) pair */
export const getModelAllocatedSlots = (
  jobTypeStats: JobTypeStats,
  modelId: string,
  jobType: string
): number => {
  const info = jobTypeStats.modelJobTypes?.[modelId]?.[jobType];
  if (info === undefined) {
    throw new Error(`No modelJobTypes entry for ${modelId}/${jobType}`);
  }
  return info.allocated;
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

/** Fill alpha capacity on instance A and verify in-flight */
export const fillAlphaCapacityOnInstanceA = async (): Promise<void> => {
  const submissions = Array.from({ length: ALPHA_SLOTS_PER_INSTANCE }, async (_, i) => {
    const jobId = `alpha-fill-${Date.now()}-${i}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL_A,
      jobId,
      jobType: JOB_TYPE_A,
      durationMs: LONG_JOB_DURATION_MS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
  });
  await Promise.all(submissions);
  await sleep(JOB_SETTLE_MS);
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

// Re-export for convenience
export { fetchAllocation, killAllInstances } from '../instanceLifecycle.js';
export type { AllocationResponse };
