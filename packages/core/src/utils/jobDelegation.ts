/**
 * Job delegation logic for the LLM Rate Limiter.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type {
  ActiveJobInfo,
  ArgsWithoutModelId,
  AvailabilityChangeReason,
  JobExecutionContext,
  JobUsage,
  LLMJobResult,
  UsageEntry,
} from '../multiModelTypes.js';
import type { InternalJobResult, InternalLimiterInstance } from '../types.js';
import {
  addJobTriedModel,
  clearJobTriedModels,
  updateJobProcessing,
  updateJobWaiting,
} from './activeJobTracker.js';
import type { BackendOperationContext } from './backendHelpers.js';
import { acquireBackend, releaseBackend } from './backendHelpers.js';
import {
  buildErrorCallbackContext,
  getMaxWaitMS,
  isDelegationError,
  selectModelWithWait,
  toErrorObject,
} from './jobExecutionHelpers.js';
import { executeJobWithCallbacks } from './jobExecutor.js';
import { DEFAULT_POLL_INTERVAL_MS, ZERO } from './rateLimiterOperations.js';

/** Context for job delegation operations */
export interface DelegationContext {
  escalationOrder: readonly string[];
  resourceEstimationsPerJob: ResourceEstimationsPerJob;
  activeJobs: Map<string, ActiveJobInfo>;
  memoryManager: { acquire: (m: string) => Promise<void>; release: (m: string) => void } | null;
  hasCapacityForModel: (modelId: string) => boolean;
  getAvailableModelExcluding: (exclude: ReadonlySet<string>) => string | null;
  backendCtx: (modelId: string, jobId: string, jobType: string) => BackendOperationContext;
  getModelLimiter: (modelId: string) => InternalLimiterInstance;
  addUsageWithCost: (ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry) => void;
  emitAvailabilityChange: (reason: AvailabilityChangeReason, modelId: string) => void;
  emitJobAdjustment: (jobType: string, result: InternalJobResult, modelId: string) => void;
}

/** Execute job on a specific model */
export const executeOnModel = async <T, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
  dctx: DelegationContext,
  ctx: JobExecutionContext<T, Args>,
  modelId: string
): Promise<LLMJobResult<T>> => {
  updateJobProcessing(dctx.activeJobs, ctx.jobId, modelId);
  return await executeJobWithCallbacks({
    ctx,
    modelId,
    limiter: dctx.getModelLimiter(modelId),
    addUsageWithCost: dctx.addUsageWithCost,
    emitAvailabilityChange: (m) => {
      dctx.emitAvailabilityChange('tokensMinute', m);
    },
    emitJobAdjustment: dctx.emitJobAdjustment,
    releaseResources: (result) => {
      dctx.memoryManager?.release(modelId);
      const actual = { requests: result.requestCount, tokens: result.usage.input + result.usage.output };
      releaseBackend(dctx.backendCtx(modelId, ctx.jobId, ctx.jobType), actual);
    },
  });
};

/** Error handling params */
interface HandleErrorParams<T, Args extends ArgsWithoutModelId> {
  dctx: DelegationContext;
  ctx: JobExecutionContext<T, Args>;
  modelId: string;
  error: unknown;
}

/** Handle execution error with potential delegation */
const handleError = async <T, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
  params: HandleErrorParams<T, Args>
): Promise<LLMJobResult<T>> => {
  const { dctx, ctx, modelId, error } = params;
  dctx.memoryManager?.release(modelId);
  releaseBackend(dctx.backendCtx(modelId, ctx.jobId, ctx.jobType), { requests: ZERO, tokens: ZERO });
  if (isDelegationError(error)) {
    if (dctx.getAvailableModelExcluding(ctx.triedModels) === null) {
      ctx.triedModels.clear();
    }
    return await executeWithDelegation(dctx, ctx);
  }
  const err = toErrorObject(error);
  ctx.onError?.(err, buildErrorCallbackContext(ctx.jobId, ctx.usage));
  throw err;
};

/** Execute job with delegation support */
export const executeWithDelegation = async <T, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
  dctx: DelegationContext,
  ctx: JobExecutionContext<T, Args>
): Promise<LLMJobResult<T>> => {
  const { modelId: selectedModel, allModelsExhausted } = await selectModelWithWait({
    escalationOrder: dctx.escalationOrder,
    triedModels: ctx.triedModels,
    hasCapacityForModel: dctx.hasCapacityForModel,
    getMaxWaitMSForModel: (m) => getMaxWaitMS(dctx.resourceEstimationsPerJob, ctx.jobType, m),
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    onWaitingForModel: (modelId, maxWaitMS) => {
      updateJobWaiting(dctx.activeJobs, ctx.jobId, modelId, maxWaitMS);
    },
  });

  if (selectedModel === null) {
    if (allModelsExhausted) {
      throw new Error('All models exhausted: no capacity available within maxWaitMS');
    }
    ctx.triedModels.clear();
    clearJobTriedModels(dctx.activeJobs, ctx.jobId);
    return await executeWithDelegation(dctx, ctx);
  }

  ctx.triedModels.add(selectedModel);
  addJobTriedModel(dctx.activeJobs, ctx.jobId, selectedModel);
  await dctx.memoryManager?.acquire(selectedModel);
  if (!(await acquireBackend(dctx.backendCtx(selectedModel, ctx.jobId, ctx.jobType)))) {
    dctx.memoryManager?.release(selectedModel);
    if (ctx.triedModels.size >= dctx.escalationOrder.length) {
      throw new Error('All models rejected by backend');
    }
    return await executeWithDelegation(dctx, ctx);
  }
  try {
    return await executeOnModel(dctx, ctx, selectedModel);
  } catch (error) {
    return await handleError({ dctx, ctx, modelId: selectedModel, error });
  }
};
