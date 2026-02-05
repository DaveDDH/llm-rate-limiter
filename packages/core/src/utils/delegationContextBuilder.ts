/**
 * Helper for building DelegationContext objects.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type { ActiveJobInfo, AvailabilityChangeReason, JobUsage, UsageEntry } from '../multiModelTypes.js';
import type { InternalJobResult, InternalLimiterInstance, ReservationContext } from '../types.js';
import type { AvailabilityTracker } from './availabilityTracker.js';
import type { BackendOperationContext } from './backendHelpers.js';
import { addUsageWithCost, calculateJobAdjustment } from './costHelpers.js';
import type { DelegationContext } from './jobDelegation.js';
import type { MemoryManagerInstance } from './memoryManager.js';

/** Pricing config type for models */
type ModelPricingConfig = Record<string, { pricing: { input: number; cached: number; output: number } }>;

/** Parameters for building a DelegationContext */
export interface DelegationContextParams {
  escalationOrder: readonly string[];
  resourceEstimationsPerJob: ResourceEstimationsPerJob;
  activeJobs: Map<string, ActiveJobInfo>;
  memoryManager: MemoryManagerInstance | null;
  availabilityTracker: AvailabilityTracker | null;
  models: ModelPricingConfig;
  hasCapacityForModel: (modelId: string) => boolean;
  tryReserveForModel: (modelId: string) => ReservationContext | null;
  releaseReservationForModel: (modelId: string, ctx: ReservationContext) => void;
  getAvailableModelExcluding: (exclude: ReadonlySet<string>) => string | null;
  backendCtx: (modelId: string, jobId: string, jobType: string) => BackendOperationContext;
  getModelLimiter: (modelId: string) => InternalLimiterInstance;
}

/** Create job adjustment emitter callback */
const createJobAdjustmentEmitter =
  (
    resourceEstimationsPerJob: ResourceEstimationsPerJob,
    availabilityTracker: AvailabilityTracker | null
  ): ((jobType: string, result: InternalJobResult, modelId: string) => void) =>
  (jobType, result, modelId) => {
    const adj = calculateJobAdjustment(resourceEstimationsPerJob, jobType, result);
    if (adj !== null) {
      availabilityTracker?.emitAdjustment(adj, modelId);
    }
  };

/** Create usage cost adder callback */
const createUsageCostAdder =
  (models: ModelPricingConfig): ((ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry) => void) =>
  (ctx, modelId, usage) => {
    addUsageWithCost(models, ctx, modelId, usage);
  };

/** Create availability change emitter callback */
const createAvailabilityChangeEmitter =
  (
    availabilityTracker: AvailabilityTracker | null
  ): ((reason: AvailabilityChangeReason, modelId: string) => void) =>
  (reason, modelId) => {
    availabilityTracker?.checkAndEmit(reason, modelId);
  };

/** Build a DelegationContext from the given parameters */
export const buildDelegationContext = (params: DelegationContextParams): DelegationContext => {
  const {
    escalationOrder,
    resourceEstimationsPerJob,
    activeJobs,
    memoryManager,
    availabilityTracker,
    models,
    hasCapacityForModel,
    tryReserveForModel,
    releaseReservationForModel,
    getAvailableModelExcluding,
    backendCtx,
    getModelLimiter,
  } = params;

  return {
    escalationOrder,
    resourceEstimationsPerJob,
    activeJobs,
    memoryManager,
    hasCapacityForModel,
    tryReserveForModel,
    releaseReservationForModel,
    getAvailableModelExcluding,
    backendCtx,
    getModelLimiter,
    addUsageWithCost: createUsageCostAdder(models),
    emitAvailabilityChange: createAvailabilityChangeEmitter(availabilityTracker),
    emitJobAdjustment: createJobAdjustmentEmitter(resourceEstimationsPerJob, availabilityTracker),
  };
};
