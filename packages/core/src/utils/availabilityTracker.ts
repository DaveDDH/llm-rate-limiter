/**
 * Tracks availability changes and emits callbacks when slots change.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type {
  AllocationInfo,
  Availability,
  AvailabilityChangeReason,
  LLMRateLimiterStats,
  OnAvailableSlotsChange,
  RelativeAvailabilityAdjustment,
  SlotsByJobTypeAndModel,
} from '../multiModelTypes.js';
import type { InternalLimiterStats } from '../types.js';

const ZERO = 0;
const ONE = 1;
const DEFAULT_RATIO = 1;

/** Estimated resources per job, used to calculate available slots */
export interface EstimatedResources {
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
  estimatedUsedMemoryKB: number;
}

/** Capacity bounds for a single model */
export interface ModelCapacityBound {
  minCapacity?: number;
  maxCapacity?: number;
}

/** Capacity bounds per model ID */
export type ModelCapacityBounds = Record<string, ModelCapacityBound>;

/** Configuration for the availability tracker */
export interface AvailabilityTrackerConfig {
  callback: OnAvailableSlotsChange | undefined;
  getStats: () => LLMRateLimiterStats;
  estimatedResources: EstimatedResources;
  /** Resource estimations per job type (needed for per-job-type memory calculation) */
  resourceEstimationsPerJob?: ResourceEstimationsPerJob;
  /** Capacity bounds (minCapacity/maxCapacity) per model */
  modelCapacityBounds?: ModelCapacityBounds;
}

/** Helper to get minimum value across models for a stat */
const getMinRemaining = (
  models: Record<string, InternalLimiterStats>,
  getter: (stats: InternalLimiterStats) => number | undefined
): number | null => {
  let min: number | null = null;
  for (const modelStats of Object.values(models)) {
    const value = getter(modelStats);
    if (value !== undefined) {
      min = min === null ? value : Math.min(min, value);
    }
  }
  return min;
};

/** Compare two availability objects for equality */
const availabilityEquals = (a: Availability, b: Availability): boolean =>
  a.slots === b.slots &&
  a.tokensPerMinute === b.tokensPerMinute &&
  a.tokensPerDay === b.tokensPerDay &&
  a.requestsPerMinute === b.requestsPerMinute &&
  a.requestsPerDay === b.requestsPerDay &&
  a.concurrentRequests === b.concurrentRequests &&
  a.memoryKB === b.memoryKB;

/** Determine the reason based on what changed (priority order) */
const determineReason = (prev: Availability, curr: Availability): AvailabilityChangeReason => {
  if (prev.tokensPerMinute !== curr.tokensPerMinute) return 'tokensMinute';
  if (prev.tokensPerDay !== curr.tokensPerDay) return 'tokensDay';
  if (prev.requestsPerMinute !== curr.requestsPerMinute) return 'requestsMinute';
  if (prev.requestsPerDay !== curr.requestsPerDay) return 'requestsDay';
  if (prev.concurrentRequests !== curr.concurrentRequests) return 'concurrentRequests';
  // Slots are derived from the fields above plus memory. If we reach here, memory changed.
  return 'memory';
};

/** Add slot candidate if value and divisor are valid */
const addSlotCandidate = (slots: number[], value: number | null, divisor: number): void => {
  if (value !== null && divisor > ZERO) slots.push(Math.floor(value / divisor));
};

/** Sum slots across all job types and models from distributed allocation */
const sumDistributedSlots = (slotsByJobTypeAndModel: SlotsByJobTypeAndModel): number => {
  let total = ZERO;
  for (const jobTypeAlloc of Object.values(slotsByJobTypeAndModel)) {
    total += sumModelSlots(jobTypeAlloc);
  }
  return total;
};

/** Sum slots for a single job type across all models (without clamping) */
const sumModelSlots = (modelAllocations: Record<string, { slots: number }> | undefined): number => {
  if (modelAllocations === undefined) return ZERO;
  let total = ZERO;
  for (const modelAlloc of Object.values(modelAllocations)) {
    total += modelAlloc.slots;
  }
  return total;
};

/**
 * Apply memory constraint (scaling) and then per-model clamping.
 * Flow:
 *   1. Sum distributed slots (no clamping) to get distributedTotal
 *   2. constrainedTotal = min(distributedTotal, memorySlots)
 *   3. scaleFactor = constrainedTotal / distributedTotal
 *   4. For each model: clamp(floor(slots * scaleFactor), minCapacity, maxCapacity)
 *   5. Return sum of clamped values
 */
const applyMemoryConstraintAndClamping = (
  modelAllocations: Record<string, { slots: number }> | undefined,
  memorySlots: number,
  bounds: ModelCapacityBounds | undefined
): number => {
  if (modelAllocations === undefined) return ZERO;

  // Step 1: Sum distributed slots without clamping
  const distributedTotal = sumModelSlots(modelAllocations);
  if (distributedTotal === ZERO) {
    // No distributed slots - apply minCapacity for each model
    let total = ZERO;
    for (const modelId of Object.keys(modelAllocations)) {
      const minCap = bounds?.[modelId]?.minCapacity ?? ZERO;
      total += minCap;
    }
    return total;
  }

  // Step 2-3: Calculate scale factor from memory constraint
  const constrainedTotal = Math.min(distributedTotal, memorySlots);
  const scaleFactor = constrainedTotal / distributedTotal;

  // Step 4-5: Scale each model's slots, then clamp, then sum
  let total = ZERO;
  for (const [modelId, modelAlloc] of Object.entries(modelAllocations)) {
    const scaledSlots = Math.floor(modelAlloc.slots * scaleFactor);
    const modelBounds = bounds?.[modelId];
    const minCap = modelBounds?.minCapacity ?? ZERO;
    const maxCap = modelBounds?.maxCapacity ?? Number.POSITIVE_INFINITY;
    const clamped = Math.max(minCap, Math.min(maxCap, scaledSlots));
    total += clamped;
  }
  return total;
};

/** Calculate the number of slots (minimum jobs that can run) */
const calculateSlots = (availability: Availability, estimated: EstimatedResources): number => {
  const { tokensPerMinute, tokensPerDay, requestsPerMinute, requestsPerDay, concurrentRequests, memoryKB } =
    availability;
  const { estimatedUsedTokens, estimatedNumberOfRequests, estimatedUsedMemoryKB } = estimated;
  const slots: number[] = [];
  addSlotCandidate(slots, tokensPerMinute, estimatedUsedTokens);
  addSlotCandidate(slots, tokensPerDay, estimatedUsedTokens);
  addSlotCandidate(slots, requestsPerMinute, estimatedNumberOfRequests);
  addSlotCandidate(slots, requestsPerDay, estimatedNumberOfRequests);
  if (concurrentRequests !== null) slots.push(concurrentRequests);
  addSlotCandidate(slots, memoryKB, estimatedUsedMemoryKB);
  return slots.length === ZERO ? Number.POSITIVE_INFINITY : Math.max(ZERO, Math.min(...slots));
};

/** Utility class to track availability changes and emit callbacks */
export class AvailabilityTracker {
  private previousAvailability: Availability | null = null;
  private readonly callback: OnAvailableSlotsChange | undefined;
  private readonly getStats: () => LLMRateLimiterStats;
  private readonly estimated: EstimatedResources;
  private readonly resourceEstimationsPerJob: ResourceEstimationsPerJob | undefined;
  private readonly modelCapacityBounds: ModelCapacityBounds | undefined;
  private distributedAllocation: AllocationInfo | null = null;

  constructor(config: AvailabilityTrackerConfig) {
    const { callback, getStats, estimatedResources, resourceEstimationsPerJob, modelCapacityBounds } = config;
    this.callback = callback;
    this.getStats = getStats;
    this.estimated = estimatedResources;
    this.resourceEstimationsPerJob = resourceEstimationsPerJob;
    this.modelCapacityBounds = modelCapacityBounds;
  }

  /**
   * Set the distributed allocation for this instance.
   * Called when the V2 backend pushes an allocation update.
   * @param allocation - The new allocation info
   * @param modelId - The model that triggered the allocation change (use '*' for global changes)
   */
  setDistributedAllocation(allocation: AllocationInfo, modelId = '*'): void {
    this.distributedAllocation = allocation;
    this.checkAndEmit('distributed', modelId);
  }

  /** Get the current distributed allocation (for testing/inspection) */
  getDistributedAllocation(): AllocationInfo | null {
    return this.distributedAllocation;
  }

  /** Calculate current availability from stats, respecting distributed allocation */
  calculateAvailability(): Availability {
    const { models, memory } = this.getStats();
    // Local stats already reflect per-instance limits (set via setRateLimits from allocation)
    const tokensPerMinute = getMinRemaining(models, (s) => s.tokensPerMinute?.remaining);
    const tokensPerDay = getMinRemaining(models, (s) => s.tokensPerDay?.remaining);
    const requestsPerMinute = getMinRemaining(models, (s) => s.requestsPerMinute?.remaining);
    const requestsPerDay = getMinRemaining(models, (s) => s.requestsPerDay?.remaining);
    const concurrentRequests = getMinRemaining(models, (s) => s.concurrency?.available);
    const memoryKB = memory?.availableKB ?? null;

    const partialAvailability = {
      tokensPerMinute,
      tokensPerDay,
      requestsPerMinute,
      requestsPerDay,
      concurrentRequests,
      memoryKB,
    };

    // Calculate slots with per-job-type memory constraint
    const { distributedAllocation, resourceEstimationsPerJob } = this;
    const slots = this.calculateSlotsWithMemoryConstraint(
      partialAvailability,
      distributedAllocation,
      resourceEstimationsPerJob,
      memoryKB
    );

    return { slots, ...partialAvailability };
  }

  /**
   * Calculate total slots applying per-job-type memory constraint and per-model clamping.
   * Memory is LOCAL - each instance applies its own memory limit.
   *
   * For each job type:
   *   1. Calculate memory slots: floor((totalMemory × ratio) / estimatedMemoryKB)
   *   2. Apply memory constraint to distributed slots (scale down proportionally)
   *   3. Clamp each model's scaled slots using minCapacity/maxCapacity
   *   4. Sum clamped slots
   *
   * Clamping happens AFTER memory constraint, so minCapacity can override memory limits.
   */
  private calculateSlotsWithMemoryConstraint(
    availability: Omit<Availability, 'slots'>,
    allocation: AllocationInfo | null,
    resourcesPerJob: ResourceEstimationsPerJob | undefined,
    totalMemoryKB: number | null
  ): number {
    // No distributed allocation - use legacy local calculation
    if (allocation === null) {
      return calculateSlots({ ...availability, slots: ZERO }, this.estimated);
    }

    const { modelCapacityBounds } = this;

    // No per-job-type config - no memory constraint, just sum with clamping
    if (resourcesPerJob === undefined) {
      let total = ZERO;
      for (const jobTypeAlloc of Object.values(allocation.slotsByJobTypeAndModel)) {
        // No memory config means unlimited memory slots
        total += applyMemoryConstraintAndClamping(jobTypeAlloc, Number.POSITIVE_INFINITY, modelCapacityBounds);
      }
      return total;
    }

    // Calculate per-job-type slots with memory constraint and per-model clamping
    let totalSlots = ZERO;
    const jobTypeIds = Object.keys(allocation.slotsByJobTypeAndModel);
    const jobTypeCount = jobTypeIds.length;

    for (const jobTypeId of jobTypeIds) {
      const jobTypeAlloc = allocation.slotsByJobTypeAndModel[jobTypeId];
      const jobTypeConfig = resourcesPerJob[jobTypeId];

      // Get ratio for this job type (default to even distribution)
      const ratio = jobTypeConfig?.ratio?.initialValue ?? DEFAULT_RATIO / jobTypeCount;

      // Get estimated memory for this job type
      const estimatedMemoryKB = jobTypeConfig?.estimatedUsedMemoryKB ?? ZERO;

      // Calculate local memory slots for this job type
      let memorySlots = Number.POSITIVE_INFINITY;
      if (totalMemoryKB !== null && estimatedMemoryKB > ZERO) {
        const memoryForJobType = totalMemoryKB * ratio;
        memorySlots = Math.floor(memoryForJobType / estimatedMemoryKB);
      }

      // Apply memory constraint first, then clamp per model
      const finalSlotsForJobType = applyMemoryConstraintAndClamping(jobTypeAlloc, memorySlots, modelCapacityBounds);
      totalSlots += finalSlotsForJobType;
    }

    return totalSlots;
  }

  /** Check for changes and emit callback if availability changed */
  checkAndEmit(
    hintReason: AvailabilityChangeReason,
    modelId: string,
    adjustment?: RelativeAvailabilityAdjustment
  ): void {
    if (this.callback === undefined) return;
    const currentAvailability = this.calculateAvailability();
    const { previousAvailability } = this;

    if (hintReason === 'adjustment' && adjustment !== undefined) {
      this.previousAvailability = currentAvailability;
      this.callback(currentAvailability, 'adjustment', modelId, adjustment);
      return;
    }

    if (previousAvailability !== null && availabilityEquals(previousAvailability, currentAvailability)) {
      return;
    }

    const reason =
      previousAvailability === null ? hintReason : determineReason(previousAvailability, currentAvailability);
    this.previousAvailability = currentAvailability;
    this.callback(currentAvailability, reason, modelId, undefined);
  }

  /** Emit callback for adjustment with proper tracking */
  emitAdjustment(adjustment: RelativeAvailabilityAdjustment, modelId: string): void {
    if (this.callback === undefined) return;
    const currentAvailability = this.calculateAvailability();
    this.previousAvailability = currentAvailability;
    this.callback(currentAvailability, 'adjustment', modelId, adjustment);
  }

  /** Initialize with current availability (call after limiter is fully initialized) */
  initialize(): void {
    this.previousAvailability = this.calculateAvailability();
  }

  /** Get current availability without emitting */
  getCurrentAvailability(): Availability {
    return this.calculateAvailability();
  }
}
