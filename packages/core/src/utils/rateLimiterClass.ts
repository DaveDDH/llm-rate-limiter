/** LLM Rate Limiter class implementation. */
import type { BackendFactoryInstance, DistributedBackendFactory } from '../backendFactoryTypes.js';
import type { JobTypeStats, ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type {
  ActiveJobInfo,
  AllocationInfo,
  ArgsWithoutModelId,
  AvailabilityChangeReason,
  BackendConfig,
  DistributedAvailability,
  LLMJobResult,
  LLMRateLimiterConfig,
  LLMRateLimiterInstance,
  LLMRateLimiterStats,
  QueueJobOptions,
  Unsubscribe,
} from '../multiModelTypes.js';
import type { InternalJobResult, InternalLimiterInstance, InternalLimiterStats } from '../types.js';
import {
  applyLimitsToLimiter,
  calculatePerInstanceLimits,
  shouldSkipAllocation,
} from './allocationHelpers.js';
import type { AvailabilityTracker } from './availabilityTracker.js';
import type { BackendOperationContext } from './backendHelpers.js';
import { toFullAvailability } from './costHelpers.js';
import { buildDelegationContext } from './delegationContextBuilder.js';
import {
  calculateEstimatedResources,
  calculateJobTypeCapacity,
  createAvailabilityTracker,
  getModelLimiterById,
  initializeModelLimiters,
} from './initializationHelpers.js';
import type { JobTypeManager } from './jobTypeManager.js';
import { type MemoryManagerInstance, createMemoryManager } from './memoryManager.js';
import {
  getEffectiveOrder,
  getEffectiveResourceEstimationsPerJob,
  validateMultiModelConfig,
} from './multiModelHelpers.js';
import { executeQueueJob, executeQueueJobForModel } from './rateLimiterJobQueue.js';
import {
  DEFAULT_LABEL,
  buildBackendContext,
  buildCombinedStats,
  checkJobTypeCapacity,
  createOptionalJobTypeManager,
  generateInstanceId,
  getJobTypeKeysFromConfig,
  getJobTypeStatsFromManager,
  getModelStatsWithMemory,
  initializeBackendFactory,
  initializeJobTypeCapacity,
  registerWithBackend,
  stopAllResources,
  stopBackendFactory,
  unregisterFromBackend,
} from './rateLimiterOperations.js';

const INITIAL_INSTANCE_COUNT = 0;

/** Internal LLM Rate Limiter class. Use createLLMRateLimiter factory instead. */
export class LLMRateLimiter implements LLMRateLimiterInstance<string> {
  private readonly config: LLMRateLimiterConfig;
  private readonly label: string;
  private readonly escalationOrder: readonly string[];
  private readonly resourceEstimationsPerJob: ResourceEstimationsPerJob;
  private readonly modelLimiters: Map<string, InternalLimiterInstance>;
  private readonly memoryManager: MemoryManagerInstance | null;
  private readonly jobTypeManager: JobTypeManager | null;
  private readonly availabilityTracker: AvailabilityTracker | null;
  private readonly backendOrFactory: BackendConfig | DistributedBackendFactory | undefined;
  private readonly instanceId: string;
  private readonly activeJobs = new Map<string, ActiveJobInfo>();
  private backendUnsubscribe: Unsubscribe | null = null;
  private backendFactoryInstance: BackendFactoryInstance | null = null;
  private resolvedBackend: BackendConfig | undefined;
  private currentInstanceCount = INITIAL_INSTANCE_COUNT;

  constructor(config: LLMRateLimiterConfig) {
    validateMultiModelConfig(config);
    this.config = config;
    this.label = DEFAULT_LABEL;
    this.escalationOrder = getEffectiveOrder(config);
    this.resourceEstimationsPerJob = getEffectiveResourceEstimationsPerJob(config);
    this.instanceId = generateInstanceId();
    const { backend } = config;
    this.backendOrFactory = backend;
    const estimated = calculateEstimatedResources(this.resourceEstimationsPerJob);
    this.modelLimiters = initializeModelLimiters({
      models: config.models,
      label: this.label,
      onLog: config.onLog,
      estimatedResources: estimated,
      onOverage: config.onOverage,
    });
    this.memoryManager = this.createMemoryManagerInstance(config);
    this.availabilityTracker = createAvailabilityTracker(config, estimated, () => this.getStats());
    this.jobTypeManager = this.createJobTypeManagerInstance(config);
    const jobTypeCapacity = calculateJobTypeCapacity(config.models, this.resourceEstimationsPerJob);
    initializeJobTypeCapacity(this.jobTypeManager, jobTypeCapacity);
    this.log('Initialized', {
      models: this.escalationOrder,
      jobTypes: getJobTypeKeysFromConfig(this.resourceEstimationsPerJob),
      jobTypeCapacity,
    });
  }

  private createMemoryManagerInstance(config: LLMRateLimiterConfig): MemoryManagerInstance | null {
    return createMemoryManager({
      config,
      resourceEstimationsPerJob: this.resourceEstimationsPerJob,
      label: this.label,
      onLog: config.onLog,
      onAvailabilityChange: (r, modelId) => {
        this.emitAvailabilityChange(r, modelId);
      },
    });
  }

  private createJobTypeManagerInstance(config: LLMRateLimiterConfig): JobTypeManager | null {
    return createOptionalJobTypeManager({
      resourceEstimationsPerJob: this.resourceEstimationsPerJob,
      ratioAdjustmentConfig: config.ratioAdjustmentConfig,
      label: this.label,
      onLog: config.onLog,
      onRatioChange: (ratios) => {
        this.memoryManager?.setRatios(ratios);
      },
    });
  }

  private log(message: string, data?: Record<string, unknown>): void {
    this.config.onLog?.(`${this.label}| ${message}`, data);
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  async start(): Promise<void> {
    const { factoryInstance, resolvedBackend } = await initializeBackendFactory(
      this.backendOrFactory,
      this.config.models,
      this.resourceEstimationsPerJob,
      this.escalationOrder
    );
    this.backendFactoryInstance = factoryInstance;
    this.resolvedBackend = resolvedBackend;
    const { unsubscribe, allocation } = await registerWithBackend(
      this.resolvedBackend,
      this.instanceId,
      this.availabilityTracker,
      (alloc) => {
        this.applyAllocationToLimiters(alloc);
      }
    );
    this.backendUnsubscribe = unsubscribe;
    if (allocation !== null) {
      this.applyAllocationToLimiters(allocation);
      this.log('Registered with backend', {
        instanceId: this.instanceId,
        instanceCount: allocation.instanceCount,
      });
    }
  }

  private applyAllocationToLimiters(allocation: AllocationInfo): void {
    const { instanceCount, dynamicLimits } = allocation;
    if (shouldSkipAllocation(instanceCount, this.currentInstanceCount)) {
      return;
    }
    this.currentInstanceCount = instanceCount;
    this.log('Applying distributed allocation', {
      instanceCount,
      hasDynamicLimits: dynamicLimits !== undefined,
    });
    for (const [modelId, modelConfig] of Object.entries(this.config.models)) {
      const limiter = this.modelLimiters.get(modelId);
      if (limiter !== undefined) {
        const limits = calculatePerInstanceLimits({ modelId, modelConfig, allocation });
        this.log(`Model ${modelId} limits`, { ...limits });
        applyLimitsToLimiter(limiter, limits);
      }
    }
  }

  private emitAvailabilityChange(reason: AvailabilityChangeReason, modelId: string): void {
    this.availabilityTracker?.checkAndEmit(reason, modelId);
  }

  private getModelLimiter(modelId: string): InternalLimiterInstance {
    return getModelLimiterById(this.modelLimiters, modelId);
  }

  private backendCtx(modelId: string, jobId: string, jobType: string): BackendOperationContext {
    return buildBackendContext({
      backend: this.resolvedBackend,
      resourceEstimationsPerJob: this.resourceEstimationsPerJob,
      instanceId: this.instanceId,
      modelId,
      jobId,
      jobType,
    });
  }

  hasCapacity(): boolean {
    return this.getAvailableModel() !== null;
  }
  hasCapacityForModel(modelId: string): boolean {
    return this.getModelLimiter(modelId).hasCapacity();
  }
  getAvailableModel(): string | null {
    return this.escalationOrder.find((m) => this.hasCapacityForModel(m)) ?? null;
  }
  private getAvailableModelExcluding(exclude: ReadonlySet<string>): string | null {
    return this.escalationOrder.find((m) => !exclude.has(m) && this.hasCapacityForModel(m)) ?? null;
  }

  async queueJob<T, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
    options: QueueJobOptions<T, Args>
  ): Promise<LLMJobResult<T>> {
    return await executeQueueJob(options, {
      activeJobs: this.activeJobs,
      jobTypeManager: this.jobTypeManager,
      resourceEstimationsPerJob: this.resourceEstimationsPerJob,
      buildDelegationContext: () =>
        buildDelegationContext({
          escalationOrder: this.escalationOrder,
          resourceEstimationsPerJob: this.resourceEstimationsPerJob,
          activeJobs: this.activeJobs,
          memoryManager: this.memoryManager,
          availabilityTracker: this.availabilityTracker,
          models: this.config.models,
          hasCapacityForModel: (m) => this.hasCapacityForModel(m),
          tryReserveForModel: (m) => this.getModelLimiter(m).tryReserve(),
          releaseReservationForModel: (m, ctx) => {
            this.getModelLimiter(m).releaseReservation(ctx);
          },
          getAvailableModelExcluding: (e) => this.getAvailableModelExcluding(e),
          backendCtx: (m, j, t) => this.backendCtx(m, j, t),
          getModelLimiter: (m) => this.getModelLimiter(m),
        }),
    });
  }

  async queueJobForModel<T extends InternalJobResult>(
    modelId: string,
    job: () => Promise<T> | T
  ): Promise<T> {
    return await executeQueueJobForModel(modelId, job, {
      memoryManager: this.memoryManager,
      getModelLimiter: (m) => this.getModelLimiter(m),
    });
  }

  getStats(): LLMRateLimiterStats {
    return buildCombinedStats(this.modelLimiters, this.memoryManager, this.jobTypeManager);
  }

  hasCapacityForJobType(jobType: string): boolean {
    return checkJobTypeCapacity(this.jobTypeManager, jobType);
  }

  getJobTypeStats(): JobTypeStats | undefined {
    return getJobTypeStatsFromManager(this.jobTypeManager);
  }

  getModelStats(modelId: string): InternalLimiterStats {
    return getModelStatsWithMemory(this.getModelLimiter(modelId), this.memoryManager);
  }

  getActiveJobs(): ActiveJobInfo[] {
    return Array.from(this.activeJobs.values());
  }

  getAllocation(): AllocationInfo | null {
    return this.availabilityTracker?.getDistributedAllocation() ?? null;
  }

  setDistributedAvailability(availability: DistributedAvailability): void {
    if (this.config.onAvailableSlotsChange !== undefined) {
      this.config.onAvailableSlotsChange(toFullAvailability(availability), 'distributed', '*', undefined);
    }
  }

  stop(): void {
    this.backendUnsubscribe?.();
    this.backendUnsubscribe = null;
    unregisterFromBackend(this.resolvedBackend, this.instanceId);
    stopAllResources(this.modelLimiters, this.memoryManager, this.jobTypeManager);
    this.backendFactoryInstance = stopBackendFactory(this.backendFactoryInstance);
    this.log('Stopped');
  }
}
