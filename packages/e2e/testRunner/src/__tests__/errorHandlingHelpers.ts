/**
 * Helper functions and constants for error handling tests (12.1-12.6).
 *
 * Tests verify error scenarios: throw without reject, reject with usage,
 * and how concurrency/memory/TPM counters behave in each case.
 */
import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;

// Instance constants
export const INSTANCE_PORT = 3001;
export const INSTANCE_URL = `http://localhost:${INSTANCE_PORT}`;

// HTTP status
export const HTTP_ACCEPTED = 202;

// Timing
export const JOB_DURATION_MS = 100;
export const ZERO_DURATION_MS = 0;
export const JOB_SETTLE_MS = 500;
export const JOB_COMPLETE_TIMEOUT_MS = 5000;
export const POLL_INTERVAL_MS = 200;

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;

// Config presets
export const TPM_CONFIG: ConfigPresetName = 'slotCalc-tpm-single';
export const CONCURRENT_CONFIG: ConfigPresetName = 'slotCalc-concurrent';
export const ERROR_MEMORY_CONFIG: ConfigPresetName = 'medium-errorMemory';

// Test 12.1: Error without reject - TPM not released
// Config: slotCalc-tpm-single, 1 instance, TPM=100K, estimated=10K
// Reserved 10K on submit. Error without reject => counter keeps 10K.
export const ESTIMATED_TOKENS = 10000;

// Test 12.2: Error without reject - concurrency released
// Config: slotCalc-concurrent, 1 instance, maxConcurrent=100
export const CONCURRENT_SLOTS_SINGLE = 100;

// Test 12.3: Error without reject - memory released
// Config: medium-errorMemory, 1 instance, maxMemoryKB=102400, estimated=51200
// Slots = floor(102400 / 51200) = 2
export const MEMORY_SLOTS = 2;

// Test 12.4: Reject with full usage adjusts counters
// rejectUsage: inputTokens=4000, outputTokens=2000 => total=6000
export const REJECT_FULL_INPUT = 4000;
export const REJECT_FULL_OUTPUT = 2000;
export const REJECT_FULL_TOTAL = 6000;

// Test 12.5: Reject with zero usage => full refund
export const REJECT_ZERO_TOTAL = 0;

// Test 12.6: Reject with overage usage
// rejectUsage: inputTokens=10000, outputTokens=8000 => total=18000
export const REJECT_OVERAGE_INPUT = 10000;
export const REJECT_OVERAGE_OUTPUT = 8000;
export const REJECT_OVERAGE_TOTAL = 18000;
export const REJECT_OVERAGE_REQUEST_COUNT = 2;
export const REJECT_OVERAGE_AMOUNT = 8000;

// Model IDs
export const MODEL_ALPHA = 'model-alpha';
export const MODEL_GAMMA = 'model-gamma';

// Shared constants
export const ZERO_COUNT = 0;
export const ZERO_ACTIVE_KB = 0;

/** Per-model counter stats */
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

/** Memory stats from stats endpoint */
export interface MemoryStats {
  activeKB: number;
  maxCapacityKB: number;
  availableKB: number;
}

/** Per-model stats */
export interface ModelStats {
  tokensPerMinute?: ModelCounterStats;
  requestsPerMinute?: ModelCounterStats;
  concurrency?: ConcurrencyStats;
  memory?: MemoryStats;
}

/** Stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<string, ModelStats>;
    memory?: MemoryStats;
  };
}

/** Overages response from GET /api/debug/overages */
export interface OveragesResponse {
  overages: Array<{
    resourceType: string;
    estimated: number;
    actual: number;
    overage: number;
  }>;
  count: number;
}

/** Type guard for StatsResponse */
const isStatsResponse = (value: unknown): value is StatsResponse => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return 'stats' in value && 'instanceId' in value;
};

/** Type guard for OveragesResponse */
const isOveragesResponse = (value: unknown): value is OveragesResponse => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return 'overages' in value && 'count' in value;
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

/** Fetch overages from an instance */
export const fetchOverages = async (baseUrl: string): Promise<OveragesResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/overages`);
  const data: unknown = await response.json();
  if (!isOveragesResponse(data)) {
    throw new Error('Invalid overages response');
  }
  return data;
};

/** Get TPM counter for a model */
export const getTokensPerMinute = (stats: StatsResponse, modelId: string): ModelCounterStats | undefined =>
  stats.stats.models[modelId]?.tokensPerMinute;

/** Get concurrency stats for a model */
export const getConcurrency = (stats: StatsResponse, modelId: string): ConcurrencyStats | undefined =>
  stats.stats.models[modelId]?.concurrency;

/** Get memory stats (memory is a top-level shared resource, not per-model) */
export const getMemoryStats = (stats: StatsResponse, _modelId: string): MemoryStats | undefined =>
  stats.stats.memory;

/** Submit a job that throws without calling reject */
export const submitThrowJob = async (baseUrl: string, jobId: string, durationMs: number): Promise<number> => {
  const response = await fetch(`${baseUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType: 'jobTypeA',
      payload: {
        testData: `Error test ${jobId}`,
        durationMs,
        shouldThrow: true,
      },
    }),
  });
  return response.status;
};

/** Reject usage payload shape */
interface RejectUsagePayload {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  requestCount: number;
}

/** Submit a job that calls reject() with specific usage then throws */
export const submitRejectJob = async (
  baseUrl: string,
  jobId: string,
  rejectUsage: RejectUsagePayload
): Promise<number> => {
  const response = await fetch(`${baseUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      jobType: 'jobTypeA',
      payload: {
        testData: `Reject test ${jobId}`,
        durationMs: JOB_DURATION_MS,
        rejectUsage,
      },
    }),
  });
  return response.status;
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

/** Boot a single instance with a config preset */
export const setupSingleInstance = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
