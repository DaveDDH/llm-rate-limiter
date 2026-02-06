/**
 * Helper functions and constants for memory slot calculation tests (3.1-3.6).
 */
import {
  type BootInstanceOptions,
  bootInstance,
  cleanRedis,
  killAllInstances,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;

// Instance constants
export const INSTANCE_PORT_A = 3001;
export const INSTANCE_PORT_B = 3002;
export const INSTANCE_A_URL = `http://localhost:${INSTANCE_PORT_A}`;

// Instance counts
const SINGLE_INSTANCE = 1;
const TWO_INSTANCES = 2;

// Test 3.1: Memory Slots Calculated Exactly
// Instance memory: 100MB (102,400 KB)
// jobTypeA: 10MB, ratio=0.5 → floor(102400*0.5/10240) = 5
// jobTypeB: 5MB, ratio=0.5 → floor(102400*0.5/5120) = 10
export const MEMORY_100MB = 100;
export const EXPECTED_JOB_TYPE_A_MEMORY_SLOTS = 5;
export const EXPECTED_JOB_TYPE_B_MEMORY_SLOTS = 10;

// Test 3.2: Memory is Minimum Constraint
// Distributed slots = floor((1M / 10K) / 2) = 50
// Memory slots = floor(50MB / 10MB) = 5 → Final = 5
export const MEMORY_50MB = 50;
export const DISTRIBUTED_SLOTS_TEST_3_2 = 50;
export const MEMORY_SLOTS_TEST_3_2 = 5;
export const FINAL_SLOTS_TEST_3_2 = 5;

// Test 3.3: Distributed Wins When Lower
// Distributed slots = floor((10K / 10K) / 2) = 0
// Memory slots = floor(500MB / 10MB) = 50 → Final = 0
export const MEMORY_500MB = 500;
export const DISTRIBUTED_SLOTS_TEST_3_3 = 0;
export const MEMORY_SLOTS_TEST_3_3 = 50;
export const FINAL_SLOTS_TEST_3_3 = 0;

// Test 3.4: Ratios Distribute Memory Correctly
// Instance memory: 100MB
// jobTypeA: 10MB, ratio=0.7 → 70MB → 7 slots
// jobTypeB: 10MB, ratio=0.3 → 30MB → 3 slots
export const EXPECTED_JOB_TYPE_A_RATIO_SLOTS = 7;
export const EXPECTED_JOB_TYPE_B_RATIO_SLOTS = 3;

// Test 3.5: Zero Memory Estimate
// TPM = 100K, tokens = 10K → distributed = 10
export const DISTRIBUTED_SLOTS_ZERO_MEMORY = 10;

// Test 3.6: freeMemoryRatio
// Instance memory: 100MB, freeMemoryRatio = 0.8
// Usable memory (80%) = 80MB → slots = 8
export const EXPECTED_FREE_RATIO_SLOTS = 8;

// Shared constants
export const ZERO_SLOTS = 0;

/** Allocation pool from the allocation response */
export interface ModelPoolAllocation {
  totalSlots: number;
  tokensPerMinute: number;
  requestsPerMinute: number;
  tokensPerDay: number;
  requestsPerDay: number;
}

/** Full allocation info */
export interface AllocationInfo {
  instanceCount: number;
  pools: Record<string, ModelPoolAllocation>;
}

/** Allocation response from GET /api/debug/allocation */
export interface AllocationResponse {
  instanceId: string;
  timestamp: number;
  allocation: AllocationInfo | null;
}

/** Memory stats from the stats endpoint */
export interface MemoryStats {
  maxCapacityKB: number;
}

/** Job type state from the stats endpoint */
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

/** Stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<string, unknown>;
    memory?: MemoryStats;
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

/** Type guard for AllocationResponse */
const isAllocationResponse = (value: unknown): value is AllocationResponse =>
  typeof value === 'object' && value !== null && 'instanceId' in value && 'allocation' in value;

/** Fetch stats from an instance */
export const fetchStats = async (baseUrl: string): Promise<StatsResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/stats`);
  const data: unknown = await response.json();
  if (!isStatsResponse(data)) {
    throw new Error('Invalid stats response');
  }
  return data;
};

/** Fetch allocation from an instance */
export const fetchAllocation = async (baseUrl: string): Promise<AllocationResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/allocation`);
  const data: unknown = await response.json();
  if (!isAllocationResponse(data)) {
    throw new Error('Invalid allocation response');
  }
  return data;
};

/** Get pool slots from allocation response */
export const getPoolSlots = (response: AllocationResponse, modelId: string): number | undefined =>
  response.allocation?.pools[modelId]?.totalSlots;

/** Get job type allocated slots from stats */
export const getJobTypeAllocatedSlots = (statsResponse: StatsResponse, jobType: string): number => {
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
  return state.allocatedSlots;
};

/** Get memory max capacity from stats */
export const getMemoryCapacity = (statsResponse: StatsResponse): number | undefined =>
  statsResponse.stats.memory?.maxCapacityKB;

/** Boot a single instance with memory config */
export const setupSingleInstance = async (
  configPreset: ConfigPresetName,
  options?: BootInstanceOptions
): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_A, configPreset, options);
  await waitForAllocationUpdate(
    INSTANCE_PORT_A,
    (allocation) => allocation.instanceCount === SINGLE_INSTANCE
  );
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Boot two instances with memory config */
export const setupTwoInstances = async (
  configPreset: ConfigPresetName,
  options?: BootInstanceOptions
): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_A, configPreset, options);
  await bootInstance(INSTANCE_PORT_B, configPreset, options);
  await waitForAllocationUpdate(INSTANCE_PORT_A, (allocation) => allocation.instanceCount === TWO_INSTANCES);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
