/**
 * Helper functions and constants for single job operations tests (4.1-4.4).
 */
import { bootInstance, cleanRedis, killAllInstances, waitForAllocationUpdate } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;

// Instance constants
export const INSTANCE_PORT_A = 3001;
export const INSTANCE_PORT_B = 3002;
export const INSTANCE_A_URL = `http://localhost:${INSTANCE_PORT_A}`;
export const INSTANCE_B_URL = `http://localhost:${INSTANCE_PORT_B}`;

// Instance counts
const TWO_INSTANCES = 2;

// Test 4.1/4.2: Acquire/Release pool slots
// Using slotCalc-tpm-single: model-alpha TPM=100K, jobTypeA 10K tokens, ratio=1.0
// 2 instances → floor(100K / 10K / 2) = 5 slots per instance
export const POOL_SLOTS_PER_INSTANCE = 5;
export const INITIAL_IN_FLIGHT = 0;
export const ONE_IN_FLIGHT = 1;
export const AVAILABLE_AFTER_ACQUIRE = 4;
export const AVAILABLE_AFTER_RELEASE = 5;

// Test 4.3: Global counter
// Mock job sends actual tokens via payload overrides: input=3000, output=2000
// Total actual tokens = 3000 + 2000 = 5000
export const MOCK_INPUT_TOKENS = 3000;
export const MOCK_OUTPUT_TOKENS = 2000;
export const MOCK_TOTAL_TOKENS = 5000;
export const MOCK_REQUEST_COUNT = 1;

// Test 4.4: Concurrent model
// Using slotCalc-concurrent: model-gamma maxConcurrent=100
// 2 instances → floor(100 / 2) = 50 per instance
export const CONCURRENT_SLOTS_PER_INSTANCE = 50;
export const CONCURRENT_AFTER_ACQUIRE = 49;

// Job configuration
export const LONG_JOB_DURATION_MS = 5000;
export const SHORT_JOB_DURATION_MS = 100;
export const JOB_SETTLE_MS = 500;
export const JOB_COMPLETE_WAIT_MS = 2000;

// Config presets
export const TPM_CONFIG: ConfigPresetName = 'slotCalc-tpm-single';
export const CONCURRENT_CONFIG: ConfigPresetName = 'slotCalc-concurrent';

// Shared constants
export const ZERO_COUNT = 0;
export const HTTP_ACCEPTED = 202;

/** Job type state from stats endpoint */
export interface JobTypeState {
  currentRatio: number;
  initialRatio: number;
  flexible: boolean;
  inFlight: number;
  allocatedSlots: number;
  resources: Record<string, unknown>;
}

/** Job type stats */
export interface JobTypeStats {
  jobTypes: Record<string, JobTypeState>;
  totalSlots: number;
  lastAdjustmentTime: number | null;
}

/** Model stats with token counters */
export interface ModelCounterStats {
  current: number;
  limit: number;
  remaining?: number;
}

/** Concurrency stats */
export interface ConcurrencyStats {
  active: number;
  limit: number | null;
  available: number | null;
}

/** Per-model stats */
export interface ModelStats {
  tokensPerMinute?: ModelCounterStats;
  requestsPerMinute?: ModelCounterStats;
  concurrency?: ConcurrencyStats;
}

/** Stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<string, ModelStats>;
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

/** Look up a job type state, throwing if not found */
const lookupJobType = (statsResponse: StatsResponse, jobType: string): JobTypeState => {
  const {
    stats: { jobTypes },
  } = statsResponse;
  if (jobTypes === undefined) {
    throw new Error('No jobTypes in stats response');
  }
  const {
    jobTypes: { [jobType]: state },
  } = jobTypes;
  if (state === undefined) {
    throw new Error(`Job type "${jobType}" not found`);
  }
  return state;
};

/** Get in-flight count for a job type */
export const getInFlight = (stats: StatsResponse, jobType: string): number =>
  lookupJobType(stats, jobType).inFlight;

/** Get allocated slots for a job type */
export const getAllocatedSlots = (stats: StatsResponse, jobType: string): number =>
  lookupJobType(stats, jobType).allocatedSlots;

/** Get model concurrency stats */
export const getConcurrency = (stats: StatsResponse, modelId: string): ConcurrencyStats | undefined =>
  stats.stats.models[modelId]?.concurrency;

/** Get model TPM counter */
export const getTokensPerMinute = (stats: StatsResponse, modelId: string): ModelCounterStats | undefined =>
  stats.stats.models[modelId]?.tokensPerMinute;

/** Get model RPM counter */
export const getRequestsPerMinute = (stats: StatsResponse, modelId: string): ModelCounterStats | undefined =>
  stats.stats.models[modelId]?.requestsPerMinute;

/** Optional token overrides for job payload */
export interface TokenOverrides {
  actualInputTokens: number;
  actualOutputTokens: number;
}

/** Parameters for submitting a job */
export interface SubmitJobParams {
  baseUrl: string;
  jobId: string;
  jobType: string;
  durationMs: number;
  tokenOverrides?: TokenOverrides;
}

/** Build the job payload from submit params */
const buildJobPayload = (params: SubmitJobParams): Record<string, unknown> => ({
  testData: `Test job ${params.jobId}`,
  durationMs: params.durationMs,
  ...params.tokenOverrides,
});

/** Submit a single job to an instance via direct POST */
export const submitJob = async (params: SubmitJobParams): Promise<number> => {
  const payload = buildJobPayload(params);
  const { baseUrl, jobId, jobType } = params;
  const response = await fetch(`${baseUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, jobType, payload }),
  });
  return response.status;
};

/** Boot two instances with a config preset */
export const setupInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_A, configPreset);
  await bootInstance(INSTANCE_PORT_B, configPreset);
  await waitForAllocationUpdate(INSTANCE_PORT_A, (allocation) => allocation.instanceCount === TWO_INSTANCES);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Wait for a job to complete by polling active jobs */
export const waitForJobComplete = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  const startTime = Date.now();
  const pollInterval = 200;
  await pollUntilNoActiveJobs(baseUrl, startTime, timeoutMs, pollInterval);
};

/** Type guard for active jobs response */
const isActiveJobsData = (value: unknown): value is { count: number } =>
  typeof value === 'object' && value !== null && 'count' in value;

/** Poll until no active jobs remain */
const pollUntilNoActiveJobs = async (
  baseUrl: string,
  startTime: number,
  timeoutMs: number,
  pollInterval: number
): Promise<void> => {
  if (Date.now() - startTime >= timeoutMs) {
    throw new Error('Timeout waiting for job to complete');
  }

  const response = await fetch(`${baseUrl}/api/debug/active-jobs`);
  const data: unknown = await response.json();

  if (isActiveJobsData(data) && data.count === ZERO_COUNT) {
    return;
  }

  await sleep(pollInterval);
  await pollUntilNoActiveJobs(baseUrl, startTime, timeoutMs, pollInterval);
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
