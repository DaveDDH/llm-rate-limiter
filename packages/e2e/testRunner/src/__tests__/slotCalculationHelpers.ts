/**
 * Helper functions for slot calculation tests
 */
import { bootInstance, cleanRedis, killAllInstances, waitForAllocationUpdate } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

const ALLOCATION_PROPAGATION_MS = 2000;

// Instance and slot constants
export const SINGLE_INSTANCE = 1;
export const TWO_INSTANCES = 2;
export const THREE_INSTANCES = 3;
export const FOUR_INSTANCES = 4;
export const ZERO_COUNT = 0;
export const TEN_SLOTS = 10;
export const SIX_SLOTS = 6;
export const FIVE_SLOTS = 5;
export const THREE_SLOTS = 3;
export const FIFTY_SLOTS = 50;
export const TWENTY_FIVE_SLOTS = 25;
export const MAX_TPM_PER_INSTANCE = 50000;
export const MAX_RPM_PER_INSTANCE = 250;
export const MIN_MEMORY_SLOTS = 1000;

// Test case 1.2: TPM-Only (Averaged Estimates)
// Model: TPM = 100,000, jobTypeA: 10K tokens, jobTypeB: 5K tokens
// avgTokens = (10K + 5K) / 2 = 7,500
// floor((100K / 7,500) / 2) = floor(6.67) = 6
export const TPM_AVERAGED_SLOTS = 6;
export const TPM_PER_INSTANCE_SPLIT = 50000;

// Test case 1.3: RPM-Only
// Model: RPM = 500, 2 instances
// avgRequests = (1 + 5) / 2 = 3 (from slotCalc-rpm config)
// floor((500 / 3) / 2) = floor(83.33) = 83
export const RPM_SLOTS_TWO_INSTANCES = 83;
export const RPM_PER_INSTANCE_SPLIT = 250;

// Test case 1.5: Mixed Limits
// TPM = 100K, RPM = 50, tokens = 10K, requests = 1, 2 instances
// TPM slots: floor((100K / 10K) / 2) = 5
// RPM slots: floor((50 / 1) / 2) = 25
// Limiting factor = min(5, 25) = 5
export const MIXED_LIMITS_SLOTS = 5;

// Test case 1.6: Daily Limits
// TPD = 1,000,000, RPD = 10,000, tokens = 10K, requests = 1, 2 instances
// TPD slots: floor((1M / 10K) / 2) = 50
// RPD slots: floor((10K / 1) / 2) = 5000
// Limiting = 50
export const DAILY_LIMITS_SLOTS = 50;
export const TPD_PER_INSTANCE = 500000;
export const RPD_PER_INSTANCE = 5000;

// Test case 1.4: Concurrent-Only (3 instances)
// Model: maxConcurrentRequests=100, 3 instances
// floor(100 / 3) = floor(33.33) = 33
export const CONCURRENT_THREE_INSTANCES_SLOTS = 33;

// Test case 1.10: RPM as Limiting Factor
// TPM = 100K, RPM = 6, tokens = 10K, requests = 1, 2 instances
// TPM slots: floor((100K / 10K) / 2) = 5
// RPM slots: floor((6 / 1) / 2) = 3
// Limiting factor = min(5, 3) = 3 (RPM is limiting)
export const RPM_LIMITING_SLOTS = 3;

// Test 1.1/1.7/1.8: Single job type instance scaling
// model-alpha: TPM=100K, jobTypeA: estimatedTokens=10K
// 1 instance: floor(100K/10K/1) = 10, TPM=100K
// 2 instances: floor(100K/10K/2) = 5, TPM=50K
// 3 instances: floor(100K/10K/3) = 3, TPM=33333
export const FULL_TPM_CAPACITY = 100000;
export const TPM_THREE_WAY_SPLIT = 33333;

export const INSTANCE_PORT_A = 3001;
export const INSTANCE_PORT_B = 3002;
export const INSTANCE_PORT_C = 3003;
export const INSTANCE_A_URL = `http://localhost:${INSTANCE_PORT_A}`;
export const INSTANCE_B_URL = `http://localhost:${INSTANCE_PORT_B}`;
export const INSTANCE_C_URL = `http://localhost:${INSTANCE_PORT_C}`;

export interface ModelPoolAllocation {
  totalSlots: number;
  tokensPerMinute: number;
  requestsPerMinute: number;
  tokensPerDay: number;
  requestsPerDay: number;
}

export interface AllocationInfo {
  instanceCount: number;
  pools: Record<string, ModelPoolAllocation>;
}

export interface AllocationResponse {
  instanceId: string;
  timestamp: number;
  allocation: AllocationInfo | null;
}

export interface MemoryStats {
  maxCapacityKB: number;
}

export interface StatsResponse {
  stats: {
    memory?: MemoryStats;
  };
}

/**
 * Check if value has stats property
 */
const hasStatsProperty = (value: object): value is { stats: unknown } => 'stats' in value;

/**
 * Type guard for StatsResponse
 */
export const isStatsResponse = (value: unknown): value is StatsResponse => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!hasStatsProperty(value)) {
    return false;
  }
  return typeof value.stats === 'object' && value.stats !== null;
};

/**
 * Fetch stats from an instance with type safety
 */
export const fetchStats = async (baseUrl: string): Promise<StatsResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/stats`);
  const data: unknown = await response.json();
  if (!isStatsResponse(data)) {
    throw new Error('Invalid stats response');
  }
  return data;
};

/**
 * Type guard for AllocationResponse
 */
const isAllocationResponse = (value: unknown): value is AllocationResponse =>
  typeof value === 'object' &&
  value !== null &&
  'instanceId' in value &&
  'timestamp' in value &&
  'allocation' in value;

/**
 * Fetch allocation from an instance.
 */
export const fetchAllocation = async (baseUrl: string): Promise<AllocationResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/allocation`);
  const data: unknown = await response.json();
  if (!isAllocationResponse(data)) {
    throw new Error('Invalid allocation response');
  }
  return data;
};

/**
 * Boot a single instance with a specific config preset.
 */
export const setupSingleInstance = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_A, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/**
 * Boot two instances with a specific config preset.
 */
export const setupInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_A, configPreset);
  await bootInstance(INSTANCE_PORT_B, configPreset);
  await waitForAllocationUpdate(INSTANCE_PORT_A, (a) => a.instanceCount === TWO_INSTANCES);
};

/**
 * Boot three instances with a specific config preset.
 */
export const setupThreeInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_A, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(INSTANCE_PORT_B, configPreset);
  await waitForAllocationUpdate(INSTANCE_PORT_A, (a) => a.instanceCount === TWO_INSTANCES);
  await bootInstance(INSTANCE_PORT_C, configPreset);
  await waitForAllocationUpdate(INSTANCE_PORT_A, (a) => a.instanceCount === THREE_INSTANCES);
};

/**
 * Get pool from allocation response
 */
export const getPool = (response: AllocationResponse, modelId: string): ModelPoolAllocation | undefined => {
  const pools = response.allocation?.pools;
  if (pools === undefined) {
    return undefined;
  }
  return pools[modelId];
};

/**
 * Get pool slots from allocation response
 */
export const getPoolSlots = (response: AllocationResponse, modelId: string): number | undefined => {
  const pool = getPool(response, modelId);
  return pool?.totalSlots;
};

/**
 * Verify instance count
 */
export const verifyInstanceCount = async (url: string, expectedCount: number): Promise<void> => {
  const response = await fetchAllocation(url);
  expect(response.allocation?.instanceCount).toBe(expectedCount);
};

/**
 * Verify pool exists and has slots
 */
export const verifyPoolExists = async (url: string, modelId: string): Promise<void> => {
  const response = await fetchAllocation(url);
  const pool = getPool(response, modelId);
  expect(pool).toBeDefined();
  expect(pool?.totalSlots).toBeGreaterThan(ZERO_COUNT);
};

// Re-export scaling helpers
export {
  setupAndVerifyFourInstances,
  setupAndVerifySingleInstance,
  setupAndVerifyThreeInstances,
  setupAndVerifyTwoInstances,
} from './slotCalculationScalingHelpers.js';

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
