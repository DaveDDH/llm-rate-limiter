/**
 * Helper functions for availability calculations.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type { Pools } from '../multiModelTypes.js';
import type { ModelCapacityBounds } from './availabilityTracker.js';

const ZERO = 0;
const ONE = 1;

/** Sum total slots across all model pools from distributed allocation */
export const sumPoolSlots = (pools: Pools): number => {
  let total = ZERO;
  for (const pool of Object.values(pools)) {
    total += pool.totalSlots;
  }
  return total;
};

/** Sum minCapacity across all models when pool total is zero */
export const sumMinCapacities = (pools: Pools, bounds: ModelCapacityBounds | undefined): number => {
  let total = ZERO;
  for (const modelId of Object.keys(pools)) {
    const minCap = bounds?.[modelId]?.minCapacity ?? ZERO;
    total += minCap;
  }
  return total;
};

/** Clamp a value between min and max bounds */
export const clampValue = (value: number, minCap: number, maxCap: number): number =>
  Math.max(minCap, Math.min(maxCap, value));

/** Scale and clamp slots for each model, returning total */
export const scaleAndClampPoolSlots = (
  pools: Pools,
  scaleFactor: number,
  bounds: ModelCapacityBounds | undefined
): number => {
  let total = ZERO;
  for (const [modelId, pool] of Object.entries(pools)) {
    const scaledSlots = Math.floor(pool.totalSlots * scaleFactor);
    const modelBounds = bounds?.[modelId];
    const minCap = modelBounds?.minCapacity ?? ZERO;
    const maxCap = modelBounds?.maxCapacity ?? Number.POSITIVE_INFINITY;
    total += clampValue(scaledSlots, minCap, maxCap);
  }
  return total;
};

/**
 * Apply memory constraint (scaling) and then per-model clamping to pools.
 * Flow:
 *   1. Sum pool slots (no clamping) to get poolTotal
 *   2. constrainedTotal = min(poolTotal, memorySlots)
 *   3. scaleFactor = constrainedTotal / poolTotal
 *   4. For each model: clamp(floor(totalSlots * scaleFactor), minCapacity, maxCapacity)
 *   5. Return sum of clamped values
 */
export const applyMemoryConstraintAndClamping = (
  pools: Pools,
  memorySlots: number,
  bounds: ModelCapacityBounds | undefined
): number => {
  const poolTotal = sumPoolSlots(pools);
  if (poolTotal === ZERO) {
    return sumMinCapacities(pools, bounds);
  }

  const constrainedTotal = Math.min(poolTotal, memorySlots);
  const scaleFactor = constrainedTotal / poolTotal;

  return scaleAndClampPoolSlots(pools, scaleFactor, bounds);
};

/** Calculate ratios from resourceEstimationsPerJob config (initial values or equal distribution) */
export const calculateRatiosFromConfig = (
  resourcesPerJob: ResourceEstimationsPerJob
): Map<string, number> => {
  const jobTypeIds = Object.keys(resourcesPerJob);
  const ratios = new Map<string, number>();

  let specifiedTotal = ZERO;
  const specifiedRatios = new Map<string, number>();

  for (const id of jobTypeIds) {
    const { ratio } = resourcesPerJob[id] ?? {};
    if (ratio?.initialValue !== undefined) {
      specifiedRatios.set(id, ratio.initialValue);
      specifiedTotal += ratio.initialValue;
    }
  }

  const remainingRatio = ONE - specifiedTotal;
  const unspecifiedCount = jobTypeIds.length - specifiedRatios.size;
  const evenShare = unspecifiedCount > ZERO ? remainingRatio / unspecifiedCount : ZERO;

  for (const id of jobTypeIds) {
    ratios.set(id, specifiedRatios.get(id) ?? evenShare);
  }

  return ratios;
};

/**
 * Calculate total memory slots by summing per-job-type memory slots.
 * Each job type gets: floor((totalMemory * ratio) / estimatedMemoryKB)
 * Uses initial ratios from config for stable reporting.
 */
export const calculatePerJobTypeMemorySlots = (
  resourcesPerJob: ResourceEstimationsPerJob,
  totalMemoryKB: number
): number => {
  const jobTypes = Object.entries(resourcesPerJob);
  if (jobTypes.length === ZERO) return Number.POSITIVE_INFINITY;

  const ratios = calculateRatiosFromConfig(resourcesPerJob);

  let totalSlots = ZERO;
  let hasMemoryConstraint = false;

  for (const [jobType, config] of jobTypes) {
    const ratio = ratios.get(jobType) ?? ONE / jobTypes.length;
    const memoryForJobType = totalMemoryKB * ratio;
    const { estimatedUsedMemoryKB = ZERO } = config;

    if (estimatedUsedMemoryKB > ZERO) {
      totalSlots += Math.floor(memoryForJobType / estimatedUsedMemoryKB);
      hasMemoryConstraint = true;
    }
  }

  return hasMemoryConstraint ? totalSlots : Number.POSITIVE_INFINITY;
};
