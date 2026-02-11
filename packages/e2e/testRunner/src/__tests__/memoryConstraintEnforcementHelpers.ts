/**
 * Helper functions and constants for memory constraint enforcement tests (18.1-18.5).
 *
 * Tests verify memory constraints block/release jobs correctly,
 * memory + ratio interaction, different memory estimates, and all limit types.
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
const SINGLE_INSTANCE = 1;

// Config presets
export const MEMORY_CONSTRAIN_CONFIG: ConfigPresetName = 'mh-memoryConstrain';
export const MEMORY_RATIO_INTERACT_CONFIG: ConfigPresetName = 'mh-memoryRatioInteract';
export const MEMORY_DIFF_ESTIMATES_CONFIG: ConfigPresetName = 'mh-memoryDiffEstimates';
export const MEMORY_ALL_LIMITS_CONFIG: ConfigPresetName = 'mh-memoryAllLimits';

// Test 18.1/18.2: Memory constrain (50MB total, 10MB/job = 5 slots)
export const MEMORY_50MB = 51200;
export const MEMORY_10MB = 10240;
export const MEMORY_SLOTS_FIVE = 5;
export const JOBS_TO_FILL_MEMORY = 5;
export const JOBS_TO_OVERFLOW_MEMORY = 6;
export const INCREMENT = 1;

// Test 18.3: Memory + ratio interaction (100MB, 10MB each, 0.5 ratio)
export const MEMORY_100MB = 102400;
export const INITIAL_SLOTS_EACH = 5;
export const RATIO_ADJUSTED_A = 0.7;
export const RATIO_ADJUSTED_B = 0.3;
export const MEMORY_SHARE_A = 70;
export const MEMORY_SHARE_B = 30;
export const MEMORY_SLOTS_A = 7;
export const MEMORY_SLOTS_B = 3;

// Test 18.4: Different memory estimates (heavyJob=50MB, lightJob=5MB)
export const MEMORY_50MB_ESTIMATE = 51200;
export const MEMORY_5MB = 5120;
export const HEAVY_JOB_SLOTS = 1;
export const LIGHT_JOB_SLOTS = 5;

// Test 18.5: All limits (TPM=50K, RPM=10, concurrent=8, memory=100MB/20MB=5)
export const TPM_LIMIT = 50000;
export const RPM_LIMIT = 10;
export const CONCURRENT_LIMIT = 8;
export const MEMORY_20MB = 20480;
export const EFFECTIVE_SLOTS = 5;

// Timing
export const QUICK_JOB_DURATION_MS = 100;
export const FILL_JOB_DURATION_MS = 3000;
export const SETTLE_MS = 500;
export const JOB_START_MAX_MS = 500;
export const POLL_TIMEOUT_MS = 30000;
export const TWO_JOBS = 2;

// HTTP status
export const HTTP_ACCEPTED = 202;

// Shared constants
export const ZERO_COUNT = 0;
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;

// Model IDs
export const MODEL_ALPHA = 'model-alpha';

// Job types
export const JOB_TYPE_A = 'jobTypeA';
export const JOB_TYPE_B = 'jobTypeB';
export const HEAVY_JOB_TYPE = 'heavyJob';
export const LIGHT_JOB_TYPE = 'lightJob';

/** Memory stats from stats endpoint */
export interface MemoryStats {
  activeKB: number;
  maxCapacityKB: number;
  availableKB: number;
}

/** Concurrency stats */
export interface ConcurrencyStats {
  active: number;
  limit: number | null;
  available: number | null;
}

/** Per-model counter stats */
export interface ModelCounterStats {
  current: number;
  limit: number;
  remaining?: number;
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
    memory?: MemoryStats;
    models: Record<string, ModelStats>;
  };
}

/** Active jobs response */
export interface ActiveJobsResponse {
  instanceId: string;
  timestamp: number;
  activeJobs: Array<{ jobId: string; jobType: string }>;
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
  typeof value === 'object' && value !== null && 'count' in value && 'activeJobs' in value;

/** Fetch stats from an instance */
export const fetchStats = async (baseUrl: string): Promise<StatsResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/stats`);
  const data: unknown = await response.json();
  if (!isStatsResponse(data)) {
    throw new Error('Invalid stats response');
  }
  return data;
};

/** Fetch active jobs from an instance */
export const fetchActiveJobs = async (baseUrl: string): Promise<ActiveJobsResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/active-jobs`);
  const data: unknown = await response.json();
  if (!isActiveJobsResponse(data)) {
    throw new Error('Invalid active-jobs response');
  }
  return data;
};

/** Submit a job to an instance */
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

/** Boot a single instance with given config preset */
export const setupSingleInstance = async (preset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT, preset);
  await waitForAllocationUpdate(INSTANCE_PORT, (allocation) => allocation.instanceCount === SINGLE_INSTANCE);
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
  const { count } = await fetchActiveJobs(baseUrl);
  if (count === ZERO_COUNT) {
    return;
  }
  await sleep(POLL_INTERVAL_MS);
  await pollUntilNoActiveJobs(baseUrl, startTime, timeoutMs);
};

/** Wait for all active jobs to complete */
export const waitForNoActiveJobs = async (baseUrl: string, timeoutMs: number): Promise<void> => {
  await pollUntilNoActiveJobs(baseUrl, Date.now(), timeoutMs);
};

/** Get memory stats from stats response */
export const getMemoryStats = (stats: StatsResponse): MemoryStats | undefined => stats.stats.memory;

/** Get model stats from stats response */
export const getModelStats = (stats: StatsResponse, modelId: string): ModelStats | undefined =>
  stats.stats.models[modelId];

/** Options for submitting jobs sequentially */
export interface SubmitJobsSequentiallyOptions {
  baseUrl: string;
  count: number;
  prefix: string;
  jobType: string;
  durationMs: number;
}

/**
 * Submit jobs sequentially to an instance, verifying each is accepted.
 * Returns all HTTP status codes.
 */
export const submitJobsSequentially = async (options: SubmitJobsSequentiallyOptions): Promise<number[]> => {
  const { baseUrl, count, prefix, jobType, durationMs } = options;
  return await Array.from({ length: count }, (_, i) => i).reduce(
    async (prevPromise, i) => {
      const results = await prevPromise;
      const jobId = `${prefix}-${i}`;
      const status = await submitJob(baseUrl, jobId, jobType, durationMs);
      return [...results, status];
    },
    Promise.resolve([] as number[])
  );
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
export { sleep } from '../testUtils.js';
