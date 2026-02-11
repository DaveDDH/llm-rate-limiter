/**
 * Scaling verification helpers for slot calculation tests.
 * Functions that boot multiple instances and verify slot allocation.
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
import type { AllocationResponse } from './slotCalculationHelpers.js';

const ALLOCATION_PROPAGATION_MS = 2000;

// Instance count constants
const SINGLE_INSTANCE = 1;
const TWO_INSTANCES = 2;
const THREE_INSTANCES = 3;
const FOUR_INSTANCES = 4;

// Expected slot constants
const TEN_SLOTS = 10;
const FIVE_SLOTS = 5;
const THREE_SLOTS = 3;

/**
 * Get pool slots from allocation response
 */
const getPoolSlots = (response: AllocationResponse, modelId: string): number | undefined => {
  const pools = response.allocation?.pools;
  if (pools === undefined) {
    return undefined;
  }
  return pools[modelId]?.totalSlots;
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

// Port indices for tuple access
const PORT_INDEX_FIRST = 0;
const PORT_INDEX_SECOND = 1;
const PORT_INDEX_THIRD = 2;
const PORT_INDEX_FOURTH = 3;

/**
 * Boot second instance and wait for allocation update
 */
const bootSecondInstance = async (
  ports: [number, number, number, number],
  configPreset: ConfigPresetName
): Promise<void> => {
  await bootInstance(ports[PORT_INDEX_SECOND], configPreset);
  await waitForAllocationUpdate(ports[PORT_INDEX_FIRST], (a) => a.instanceCount === TWO_INSTANCES);
};

/**
 * Boot third instance and wait for allocation update
 */
const bootThirdInstance = async (
  ports: [number, number, number, number],
  configPreset: ConfigPresetName
): Promise<void> => {
  await bootInstance(ports[PORT_INDEX_THIRD], configPreset);
  await waitForAllocationUpdate(ports[PORT_INDEX_FIRST], (a) => a.instanceCount === THREE_INSTANCES);
};

/**
 * Boot fourth instance and wait for allocation update
 */
const bootFourthInstance = async (
  ports: [number, number, number, number],
  configPreset: ConfigPresetName
): Promise<void> => {
  await bootInstance(ports[PORT_INDEX_FOURTH], configPreset);
  await waitForAllocationUpdate(ports[PORT_INDEX_FIRST], (a) => a.instanceCount === FOUR_INSTANCES);
};

/**
 * Setup and verify pool slots with scaling - four instances
 */
export const setupAndVerifyFourInstances = async (
  ports: [number, number, number, number],
  configPreset: ConfigPresetName,
  modelId: string,
  expectedSlots: number
): Promise<void> => {
  await killAllInstances();
  await cleanRedis();

  // Boot first instance
  await bootInstance(ports[PORT_INDEX_FIRST], configPreset);
  await sleep(ALLOCATION_PROPAGATION_MS);

  // Boot remaining instances sequentially
  await bootSecondInstance(ports, configPreset);
  await bootThirdInstance(ports, configPreset);
  await bootFourthInstance(ports, configPreset);

  const response = await fetchAllocationFromPort(ports[PORT_INDEX_FIRST]);

  expect(response.allocation?.instanceCount).toBe(FOUR_INSTANCES);
  expect(getPoolSlots(response, modelId)).toBe(expectedSlots);

  await killAllInstances();
};
