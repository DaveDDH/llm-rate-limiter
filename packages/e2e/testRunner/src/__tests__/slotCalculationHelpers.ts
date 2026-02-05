/**
 * Helper functions for slot calculation tests
 */
import {
  bootInstance,
  cleanRedis,
  fetchAllocation as fetchAllocationFromPort,
  killAllInstances,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

const ALLOCATION_PROPAGATION_MS = 2000;

// Instance and slot constants
export const SINGLE_INSTANCE = 1;
export const TWO_INSTANCES = 2;
export const THREE_INSTANCES = 3;
export const ZERO_COUNT = 0;
export const TEN_SLOTS = 10;
export const FIVE_SLOTS = 5;
export const THREE_SLOTS = 3;
export const FIFTY_SLOTS = 50;
export const TWENTY_FIVE_SLOTS = 25;
export const MAX_TPM_PER_INSTANCE = 50000;
export const MAX_RPM_PER_INSTANCE = 250;
export const MIN_MEMORY_SLOTS = 1000;

export const INSTANCE_PORT_A = 3001;
export const INSTANCE_PORT_B = 3002;
export const INSTANCE_A_URL = `http://localhost:${INSTANCE_PORT_A}`;
export const INSTANCE_B_URL = `http://localhost:${INSTANCE_PORT_B}`;

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
 * Boot instances with a specific config preset.
 * Kills any existing instances, cleans Redis, then boots fresh instances.
 */
export const setupInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_A, configPreset);
  await bootInstance(INSTANCE_PORT_B, configPreset);
  await waitForAllocationUpdate(INSTANCE_PORT_A, (a) => a.instanceCount === TWO_INSTANCES);
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

/**
 * Setup and verify pool slots with scaling - single instance
 */
export const setupAndVerifySingleInstance = async (
  port: number,
  configPreset: ConfigPresetName
): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(port, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);

  const response = await fetchAllocationFromPort(port);
  expect(response.allocation?.instanceCount).toBe(SINGLE_INSTANCE);
  expect(getPoolSlots(response, 'scale-model')).toBe(TEN_SLOTS);

  await killAllInstances();
};

/**
 * Setup and verify pool slots with scaling - two instances
 */
export const setupAndVerifyTwoInstances = async (
  portA: number,
  portB: number,
  configPreset: ConfigPresetName
): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(portA, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(portB, configPreset);
  await waitForAllocationUpdate(portA, (a) => a.instanceCount === TWO_INSTANCES);

  const responseA = await fetchAllocationFromPort(portA);
  const responseB = await fetchAllocationFromPort(portB);

  expect(responseA.allocation?.instanceCount).toBe(TWO_INSTANCES);
  expect(getPoolSlots(responseA, 'scale-model')).toBe(FIVE_SLOTS);
  expect(getPoolSlots(responseB, 'scale-model')).toBe(FIVE_SLOTS);

  await killAllInstances();
};

/**
 * Setup and verify pool slots with scaling - three instances
 */
export const setupAndVerifyThreeInstances = async (
  portA: number,
  portB: number,
  portC: number,
  configPreset: ConfigPresetName
): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(portA, configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(portB, configPreset);
  await waitForAllocationUpdate(portA, (a) => a.instanceCount === TWO_INSTANCES);
  await bootInstance(portC, configPreset);
  await waitForAllocationUpdate(portA, (a) => a.instanceCount === THREE_INSTANCES);

  const responseA = await fetchAllocationFromPort(portA);
  const responseB = await fetchAllocationFromPort(portB);
  const responseC = await fetchAllocationFromPort(portC);

  expect(responseA.allocation?.instanceCount).toBe(THREE_INSTANCES);
  expect(getPoolSlots(responseA, 'scale-model')).toBe(THREE_SLOTS);
  expect(getPoolSlots(responseB, 'scale-model')).toBe(THREE_SLOTS);
  expect(getPoolSlots(responseC, 'scale-model')).toBe(THREE_SLOTS);

  await killAllInstances();
};

// Re-export for convenience
export { killAllInstances } from '../instanceLifecycle.js';
