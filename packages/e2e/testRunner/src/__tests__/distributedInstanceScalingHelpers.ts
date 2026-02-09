/**
 * Helper functions and constants for distributed instance scaling tests (Test 28).
 *
 * Config: instanceScaling or high-distributedBasic
 * - model-alpha: TPM=100K
 * - jobTypeA: estimatedTokens=10K, ratio=1.0
 * - Pool calculation:
 *   - 1 instance: floor(100K/10K/1) = 10 slots
 *   - 2 instances: floor(100K/10K/2) = 5 slots per instance
 *   - 3 instances: floor(100K/10K/3) = 3 slots per instance
 */
import {
  type AllocationResponse,
  bootInstance,
  cleanRedis,
  fetchAllocation,
  killAllInstances,
  killInstance,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Timing constants
const ALLOCATION_PROPAGATION_MS = 2000;
export const INSTANCE_CLEANUP_TIMEOUT_MS = 20000;
export const HEARTBEAT_WAIT_MS = 10000;

// Port constants
export const PORT_A = 4001;
export const PORT_B = 4002;
export const PORT_C = 4003;

// Config preset
export const CONFIG_PRESET: ConfigPresetName = 'instanceScaling';

// Instance and slot counts
export const SINGLE_INSTANCE = 1;
export const TWO_INSTANCES = 2;
export const THREE_INSTANCES = 3;
export const TEN_SLOTS = 10;
export const FIVE_SLOTS = 5;
export const THREE_SLOTS = 3;

// Model identifier
export const MODEL_ID = 'scale-model';

// Timeout constants
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;
export const TEST_TIMEOUT_MS = 90000;

/**
 * Get scale model slots from response
 */
export const getScaleModelSlots = (response: AllocationResponse): number | undefined => {
  const pools = response.allocation?.pools;
  if (pools === undefined) {
    return undefined;
  }
  return pools[MODEL_ID]?.totalSlots;
};

/**
 * Verify pool slots for an instance
 */
export const verifyPoolSlots = async (port: number, expectedSlots: number): Promise<void> => {
  const response = await fetchAllocation(port);
  const slots = getScaleModelSlots(response);
  expect(slots).toBe(expectedSlots);
};

/**
 * Verify instance count for an allocation response
 */
export const verifyInstanceCount = async (port: number, expectedCount: number): Promise<void> => {
  const response = await fetchAllocation(port);
  expect(response.allocation?.instanceCount).toBe(expectedCount);
};

/**
 * Setup single instance test
 */
export const setupSingleInstanceTest = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/**
 * Setup two instance test with verification
 */
export const setupTwoInstanceTest = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();

  // Start Instance A first
  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);

  // Verify A has full capacity initially
  const initialAlloc = await fetchAllocation(PORT_A);
  expect(initialAlloc.allocation?.instanceCount).toBe(SINGLE_INSTANCE);
  expect(getScaleModelSlots(initialAlloc)).toBe(TEN_SLOTS);

  // Now boot Instance B
  await bootInstance(PORT_B, CONFIG_PRESET);

  // Wait for A to receive the updated allocation
  await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === TWO_INSTANCES);
};

/**
 * Setup instance leave test
 */
export const setupInstanceLeaveTest = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();

  // Start both instances
  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(PORT_B, CONFIG_PRESET);
  await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === TWO_INSTANCES);

  // Verify both have 5 pool slots
  const allocA = await fetchAllocation(PORT_A);
  expect(getScaleModelSlots(allocA)).toBe(FIVE_SLOTS);

  // Kill ONLY Instance B while A continues running
  await killInstance(PORT_B);

  // Wait for A to detect B's departure via heartbeat timeout + reallocation
  await waitForAllocationUpdate(
    PORT_A,
    (alloc) => alloc.instanceCount === SINGLE_INSTANCE,
    INSTANCE_CLEANUP_TIMEOUT_MS
  );
};

// Re-export for convenience
export { killAllInstances, killInstance, bootInstance, waitForAllocationUpdate, sleep };
