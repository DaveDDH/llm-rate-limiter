/** LLM Rate Limiter with per-model limits and automatic fallback. */
import { AvailabilityTracker } from '@globalUtils/availabilityTracker.js';
import {
  DelegationError,
  buildJobArgs,
  calculateMaxEstimatedResource,
  calculateTotalCost,
  isDelegationError,
  waitForModelCapacity,
} from '@globalUtils/jobExecutionHelpers.js';
import { getAvailableMemoryKB } from '@globalUtils/memoryUtils.js';
import {
  buildModelLimiterConfig,
  getEffectiveOrder,
  validateMultiModelConfig,
} from '@globalUtils/multiModelHelpers.js';
import { Semaphore } from '@globalUtils/semaphore.js';

import type {
  ArgsWithoutModelId,
  AvailabilityChangeReason,
  JobCallbackContext,
  JobUsage,
  LLMJobResult,
  LLMRateLimiterConfig,
  LLMRateLimiterInstance,
  LLMRateLimiterStats,
  ModelsConfig,
  QueueJobOptions,
  RelativeAvailabilityAdjustment,
  UsageEntry,
  ValidatedLLMRateLimiterConfig,
} from './multiModelTypes.js';
import { createInternalLimiter } from './rateLimiter.js';
import type {
  InternalJobResult,
  InternalLimiterConfig,
  InternalLimiterInstance,
  InternalLimiterStats,
} from './types.js';

interface JobExecutionContext<T extends InternalJobResult, Args extends ArgsWithoutModelId> {
  jobId: string;
  job: QueueJobOptions<T, Args>['job'];
  args: Args | undefined;
  triedModels: Set<string>;
  usage: JobUsage;
  onComplete: ((result: LLMJobResult<T>, context: JobCallbackContext) => void) | undefined;
  onError: ((error: Error, context: JobCallbackContext) => void) | undefined;
}

const ZERO = 0;
const TOKENS_PER_MILLION = 1_000_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_FREE_MEMORY_RATIO = 0.8;
const DEFAULT_MIN_CAPACITY = 0;
const DEFAULT_RECALCULATION_INTERVAL_MS = 1000;
const DEFAULT_LABEL = 'LLMRateLimiter';

class LLMRateLimiter implements LLMRateLimiterInstance {
  private readonly config: LLMRateLimiterConfig;
  private readonly label: string;
  private readonly order: readonly string[];
  private readonly modelLimiters: Map<string, InternalLimiterInstance>;
  private memorySemaphore: Semaphore | null = null;
  private memoryRecalculationIntervalId: NodeJS.Timeout | null = null;
  private readonly estimatedUsedMemoryKB: number;
  private readonly estimatedUsedTokens: number;
  private readonly estimatedNumberOfRequests: number;
  private readonly availabilityTracker: AvailabilityTracker | null;

  constructor(config: LLMRateLimiterConfig) {
    validateMultiModelConfig(config);
    this.config = config;
    this.label = config.label ?? DEFAULT_LABEL;
    this.order = getEffectiveOrder(config);
    this.modelLimiters = new Map();
    const { models } = config;
    this.estimatedUsedMemoryKB = calculateMaxEstimatedResource(
      models,
      (m) => m.resourcesPerEvent?.estimatedUsedMemoryKB
    );
    this.estimatedUsedTokens = calculateMaxEstimatedResource(
      models,
      (m) => m.resourcesPerEvent?.estimatedUsedTokens
    );
    this.estimatedNumberOfRequests = calculateMaxEstimatedResource(
      models,
      (m) => m.resourcesPerEvent?.estimatedNumberOfRequests
    );
    this.initializeMemoryLimiter();
    this.initializeModelLimiters();
    this.availabilityTracker = this.initializeAvailabilityTracker();
    this.log('Initialized', { models: this.order });
  }

  private log(message: string, data?: Record<string, unknown>): void {
    if (this.config.onLog !== undefined) {
      this.config.onLog(`${this.label}| ${message}`, data);
    }
  }

  private initializeAvailabilityTracker(): AvailabilityTracker | null {
    if (this.config.onAvailableSlotsChange === undefined) return null;
    const tracker = new AvailabilityTracker({
      callback: this.config.onAvailableSlotsChange,
      getStats: () => this.getStats(),
      estimatedResources: {
        estimatedUsedTokens: this.estimatedUsedTokens,
        estimatedNumberOfRequests: this.estimatedNumberOfRequests,
        estimatedUsedMemoryKB: this.estimatedUsedMemoryKB,
      },
    });
    tracker.initialize();
    return tracker;
  }

  private emitAvailabilityChange(reason: AvailabilityChangeReason): void {
    this.availabilityTracker?.checkAndEmit(reason);
  }
  private emitAdjustment(adjustment: RelativeAvailabilityAdjustment): void {
    this.availabilityTracker?.emitAdjustment(adjustment);
  }

  private emitJobAdjustment(modelId: string, result: InternalJobResult): void {
    if (this.availabilityTracker === null) return;
    const resources = this.config.models[modelId]?.resourcesPerEvent;
    const { usage, requestCount } = result;
    const tokenDiff = usage.input + usage.output - (resources?.estimatedUsedTokens ?? ZERO);
    const requestDiff = requestCount - (resources?.estimatedNumberOfRequests ?? ZERO);
    if (tokenDiff === ZERO && requestDiff === ZERO) return;
    this.emitAdjustment({
      tokensPerMinute: tokenDiff,
      tokensPerDay: tokenDiff,
      requestsPerMinute: requestDiff,
      requestsPerDay: requestDiff,
      memoryKB: ZERO,
      concurrentRequests: ZERO,
    });
  }

  private initializeMemoryLimiter(): void {
    if (this.config.memory === undefined) return;
    if (this.estimatedUsedMemoryKB === ZERO) {
      throw new Error(
        'resourcesPerEvent.estimatedUsedMemoryKB is required in at least one model when memory limits are configured'
      );
    }
    const initialCapacity = this.calculateMemoryCapacityKB();
    const semaphore = new Semaphore(initialCapacity, `${this.label}/Memory`, this.config.onLog);
    this.memorySemaphore = semaphore;
    const intervalMs = this.config.memory.recalculationIntervalMs ?? DEFAULT_RECALCULATION_INTERVAL_MS;
    this.memoryRecalculationIntervalId = setInterval(() => {
      const { max: currentMax } = semaphore.getStats();
      const newCapacity = this.calculateMemoryCapacityKB();
      if (newCapacity !== currentMax) {
        semaphore.resize(newCapacity);
        this.emitAvailabilityChange('memory');
      }
    }, intervalMs);
  }

  private calculateMemoryCapacityKB(): number {
    const { config } = this;
    const { memory, minCapacity, maxCapacity } = config;
    const calculated = Math.floor(
      getAvailableMemoryKB() * (memory?.freeMemoryRatio ?? DEFAULT_FREE_MEMORY_RATIO)
    );
    let clamped = Math.max(minCapacity ?? DEFAULT_MIN_CAPACITY, calculated);
    if (maxCapacity !== undefined) clamped = Math.min(clamped, maxCapacity);
    return clamped;
  }

  private initializeModelLimiters(): void {
    for (const [modelId, modelConfig] of Object.entries(this.config.models)) {
      const limiterConfig = buildModelLimiterConfig(
        modelId,
        modelConfig as InternalLimiterConfig,
        this.label,
        this.config.onLog
      );
      this.modelLimiters.set(modelId, createInternalLimiter(limiterConfig));
    }
  }

  private getModelLimiter(modelId: string): InternalLimiterInstance {
    const limiter = this.modelLimiters.get(modelId);
    if (limiter === undefined) throw new Error(`Unknown model: ${modelId}`);
    return limiter;
  }

  private getEstimatedMemoryForModel(modelId: string): number {
    return this.config.models[modelId]?.resourcesPerEvent?.estimatedUsedMemoryKB ?? ZERO;
  }

  private calculateCost(modelId: string, usage: UsageEntry): number {
    const p = this.config.models[modelId]?.pricing;
    if (p === undefined) return ZERO;
    return (
      (usage.inputTokens * p.input + usage.cachedTokens * p.cached + usage.outputTokens * p.output) /
      TOKENS_PER_MILLION
    );
  }

  private addUsageWithCost(ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry): void {
    ctx.usage.push({ ...usage, cost: this.calculateCost(modelId, usage) });
  }

  private hasMemoryCapacity(modelId: string): boolean {
    return (
      this.memorySemaphore === null ||
      this.memorySemaphore.getAvailablePermits() >= this.getEstimatedMemoryForModel(modelId)
    );
  }

  hasCapacity(): boolean {
    return this.getAvailableModel() !== null;
  }
  hasCapacityForModel(modelId: string): boolean {
    return this.getModelLimiter(modelId).hasCapacity() && this.hasMemoryCapacity(modelId);
  }
  getAvailableModel(): string | null {
    return this.order.find((m) => this.hasCapacityForModel(m)) ?? null;
  }

  private getAvailableModelExcluding(excludeModels: ReadonlySet<string>): string | null {
    return this.order.find((m) => !excludeModels.has(m) && this.hasCapacityForModel(m)) ?? null;
  }

  private async acquireMemory(modelId: string): Promise<void> {
    const mem = this.getEstimatedMemoryForModel(modelId);
    if (this.memorySemaphore !== null && mem > ZERO) {
      await this.memorySemaphore.acquire(mem);
      this.emitAvailabilityChange('memory');
    }
  }

  private releaseMemory(modelId: string): void {
    const mem = this.getEstimatedMemoryForModel(modelId);
    if (this.memorySemaphore !== null && mem > ZERO) {
      this.memorySemaphore.release(mem);
      this.emitAvailabilityChange('memory');
    }
  }

  async queueJob<T extends InternalJobResult, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
    options: QueueJobOptions<T, Args>
  ): Promise<LLMJobResult<T>> {
    const ctx: JobExecutionContext<T, Args> = {
      jobId: options.jobId,
      job: options.job,
      args: options.args,
      triedModels: new Set<string>(),
      usage: [],
      onComplete: options.onComplete,
      onError: options.onError,
    };
    return await this.executeJobWithDelegation(ctx);
  }

  private async executeJobWithDelegation<T extends InternalJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>
  ): Promise<LLMJobResult<T>> {
    const selectedModel =
      this.getAvailableModelExcluding(ctx.triedModels) ??
      (await waitForModelCapacity(
        (exclude) => this.getAvailableModelExcluding(exclude),
        ctx.triedModels,
        DEFAULT_POLL_INTERVAL_MS
      ));
    ctx.triedModels.add(selectedModel);
    await this.acquireMemory(selectedModel);
    try {
      return await this.executeJobOnModel(ctx, selectedModel);
    } catch (error) {
      this.releaseMemory(selectedModel);
      if (isDelegationError(error)) {
        return await this.handleDelegation(ctx);
      }
      const callbackContext: JobCallbackContext = {
        jobId: ctx.jobId,
        totalCost: calculateTotalCost(ctx.usage),
        usage: ctx.usage,
      };
      if (ctx.onError !== undefined) {
        ctx.onError(error instanceof Error ? error : new Error(String(error)), callbackContext);
      }
      throw error;
    }
  }

  private async executeJobOnModel<T extends InternalJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>,
    modelId: string
  ): Promise<LLMJobResult<T>> {
    const limiter = this.getModelLimiter(modelId);
    let callbackCalled = false;
    let shouldDelegate = false;
    let rejectedWithoutDelegation = false;
    const handleResolve = (usage: UsageEntry): void => {
      callbackCalled = true;
      this.addUsageWithCost(ctx, modelId, usage);
    };
    const handleReject = (usage: UsageEntry, opts?: { delegate?: boolean }): void => {
      callbackCalled = true;
      this.addUsageWithCost(ctx, modelId, usage);
      shouldDelegate = opts?.delegate !== false;
      if (!shouldDelegate) rejectedWithoutDelegation = true;
    };
    this.emitAvailabilityChange('tokensMinute');
    const result = await limiter.queueJob(async () => {
      const jobResult = await ctx.job(buildJobArgs<Args>(modelId, ctx.args), handleResolve, handleReject);
      if (!callbackCalled) throw new Error('Job must call resolve() or reject()');
      if (rejectedWithoutDelegation) throw new Error('Job rejected without delegation');
      if (shouldDelegate) throw new DelegationError();
      return jobResult;
    });
    this.emitJobAdjustment(modelId, result);
    this.releaseMemory(modelId);
    const finalResult = { ...result, modelUsed: modelId };
    const callbackContext: JobCallbackContext = {
      jobId: ctx.jobId,
      totalCost: calculateTotalCost(ctx.usage),
      usage: ctx.usage,
    };
    if (ctx.onComplete !== undefined) ctx.onComplete(finalResult, callbackContext);
    return finalResult;
  }

  private async handleDelegation<T extends InternalJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>
  ): Promise<LLMJobResult<T>> {
    const nextModel = this.getAvailableModelExcluding(ctx.triedModels);
    if (nextModel === null) ctx.triedModels.clear();
    return await this.executeJobWithDelegation(ctx);
  }

  async queueJobForModel<T extends InternalJobResult>(
    modelId: string,
    job: () => Promise<T> | T
  ): Promise<T> {
    const limiter = this.getModelLimiter(modelId);
    await this.acquireMemory(modelId);
    try {
      return await limiter.queueJob(job);
    } finally {
      this.releaseMemory(modelId);
    }
  }

  private getMemoryStats(): InternalLimiterStats['memory'] | undefined {
    if (this.memorySemaphore === null) return undefined;
    const { inUse, max, available } = this.memorySemaphore.getStats();
    return {
      activeKB: inUse,
      maxCapacityKB: max,
      availableKB: available,
      systemAvailableKB: Math.round(getAvailableMemoryKB()),
    };
  }

  getStats(): LLMRateLimiterStats {
    const modelStats: Record<string, InternalLimiterStats> = {};
    for (const [modelId, limiter] of this.modelLimiters) modelStats[modelId] = limiter.getStats();
    return { models: modelStats, memory: this.getMemoryStats() };
  }

  getModelStats(modelId: string): InternalLimiterStats {
    const mem = this.getMemoryStats();
    return mem === undefined
      ? this.getModelLimiter(modelId).getStats()
      : { ...this.getModelLimiter(modelId).getStats(), memory: mem };
  }

  stop(): void {
    if (this.memoryRecalculationIntervalId !== null) {
      clearInterval(this.memoryRecalculationIntervalId);
      this.memoryRecalculationIntervalId = null;
    }
    for (const limiter of this.modelLimiters.values()) limiter.stop();
    this.log('Stopped');
  }
}

/** Create a new LLM Rate Limiter. Order is optional for single model, required for multiple. */
export const createLLMRateLimiter = <T extends ModelsConfig>(
  config: ValidatedLLMRateLimiterConfig<T>
): LLMRateLimiterInstance => new LLMRateLimiter(config as LLMRateLimiterConfig);
