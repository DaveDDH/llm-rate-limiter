/**
 * Helper functions and constants for token type breakdown tests (11.1-11.3).
 *
 * Tests verify that input, output, and cached tokens are all totaled
 * correctly in the TPM counter, and that overages are tracked.
 *
 * Config: slotCalc-tpm-single (model-alpha TPM=100K, jobTypeA 10K tokens)
 * 1 instance -> floor(100K / 10K / 1) = 10 slots
 */
import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;

// Instance constants
export const INSTANCE_PORT = 3001;
export const INSTANCE_URL = `http://localhost:${INSTANCE_PORT}`;

// Config preset
export const TPM_SINGLE_CONFIG: ConfigPresetName = 'slotCalc-tpm-single';

// HTTP status
export const HTTP_ACCEPTED = 202;

// Job timing
export const SHORT_DURATION_MS = 100;
export const JOB_COMPLETE_TIMEOUT_MS = 5000;
export const POLL_INTERVAL_MS = 200;

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;

// Test 11.1: Input + Output + Cached totaled
// Send: inputTokens=3000, outputTokens=2000, cachedTokens=1000
// Expected TPM = 3000 + 2000 + 1000 = 6000
export const TEST_11_1_INPUT_TOKENS = 3000;
export const TEST_11_1_OUTPUT_TOKENS = 2000;
export const TEST_11_1_CACHED_TOKENS = 1000;
export const TEST_11_1_EXPECTED_TPM = 6000;

// Test 11.2: Cached-only tokens
// Send: inputTokens=0, outputTokens=0, cachedTokens=5000
// Expected TPM = 5000
export const TEST_11_2_INPUT_TOKENS = 0;
export const TEST_11_2_OUTPUT_TOKENS = 0;
export const TEST_11_2_CACHED_TOKENS = 5000;
export const TEST_11_2_EXPECTED_TPM = 5000;

// Test 11.3: Cached in overage
// Send: inputTokens=3000, outputTokens=2000, cachedTokens=7000
// Estimated = 10000. Actual = 12000. Overage = 2000.
export const TEST_11_3_INPUT_TOKENS = 3000;
export const TEST_11_3_OUTPUT_TOKENS = 2000;
export const TEST_11_3_CACHED_TOKENS = 7000;
export const TEST_11_3_EXPECTED_TPM = 12000;
export const TEST_11_3_EXPECTED_OVERAGE = 2000;

// Default request count
export const REQUEST_COUNT_ONE = 1;

// Model ID
export const MODEL_ALPHA = 'model-alpha';

// Zero constant
export const ZERO_COUNT = 0;

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
  concurrency?: { active: number; limit: number | null; available: number | null };
}

/** Stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<string, ModelStats>;
  };
}

/** Overage event from the server */
export interface OverageEvent {
  resourceType: string;
  estimated: number;
  actual: number;
  overage: number;
  timestamp: number;
}

/** Overages response from GET /api/debug/overages */
export interface OveragesResponse {
  overages: OverageEvent[];
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

/** Token counts for a test job */
export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

/** Token job payload shape */
interface TokenJobPayload {
  testData: string;
  durationMs: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualCachedTokens: number;
  actualRequestCount: number;
}

/** Build payload for a token type test job */
const buildTokenJobPayload = (jobId: string, tokens: TokenCounts): TokenJobPayload => ({
  testData: `Token type test ${jobId}`,
  durationMs: SHORT_DURATION_MS,
  actualInputTokens: tokens.inputTokens,
  actualOutputTokens: tokens.outputTokens,
  actualCachedTokens: tokens.cachedTokens,
  actualRequestCount: REQUEST_COUNT_ONE,
});

/** Submit a job with custom token counts */
export const submitTokenJob = async (
  baseUrl: string,
  jobId: string,
  tokens: TokenCounts
): Promise<number> => {
  const payload = buildTokenJobPayload(jobId, tokens);
  const response = await fetch(`${baseUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, jobType: 'jobTypeA', payload }),
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
    throw new Error('Timeout waiting for job to complete');
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
