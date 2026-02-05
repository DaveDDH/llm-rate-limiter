/**
 * Initialization helpers for the internal rate limiter.
 */
import type {
  InternalJobResult,
  InternalLimiterConfig,
  InternalLimiterStats,
  JobWindowStarts,
} from '../types.js';
import { getAvailableMemoryKB } from './memoryUtils.js';
import {
  type CapacityEstimates,
  type CountersSet,
  captureWindowStarts,
  getMinTimeUntilCapacity,
} from './rateLimiterCapacityHelpers.js';
import { Semaphore } from './semaphore.js';
import { TimeWindowCounter } from './timeWindowCounter.js';

const ZERO = 0;
const ONE = 1;
const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_FREE_MEMORY_RATIO = 0.8;
const DEFAULT_RECALCULATION_INTERVAL_MS = 1000;

/** Calculate memory capacity in KB based on available system memory */
export const calculateMemoryCapacityKB = (freeMemoryRatio: number): number =>
  Math.round(getAvailableMemoryKB() * freeMemoryRatio);

/** Memory initialization result */
export interface MemoryInitResult {
  memorySemaphore: Semaphore;
  memoryRecalculationIntervalId: NodeJS.Timeout;
}

/** Initialize memory limiter from config */
export const initializeMemoryLimiterFromConfig = (
  config: InternalLimiterConfig,
  label: string
): MemoryInitResult | null => {
  const { memory: memoryConfig } = config;
  if (memoryConfig === undefined) return null;
  const freeMemoryRatio = memoryConfig.freeMemoryRatio ?? DEFAULT_FREE_MEMORY_RATIO;
  const recalculationIntervalMs = memoryConfig.recalculationIntervalMs ?? DEFAULT_RECALCULATION_INTERVAL_MS;
  const initialCapacity = calculateMemoryCapacityKB(freeMemoryRatio);
  const memorySemaphore = new Semaphore(initialCapacity, `${label}/Memory`);
  const memoryRecalculationIntervalId = setInterval(() => {
    const newCapacity = calculateMemoryCapacityKB(freeMemoryRatio);
    memorySemaphore.setMax(newCapacity);
  }, recalculationIntervalMs);
  return { memorySemaphore, memoryRecalculationIntervalId };
};

/** Initialize concurrency limiter from config */
export const initializeConcurrencyFromConfig = (
  config: InternalLimiterConfig,
  label: string
): Semaphore | null => {
  const { maxConcurrentRequests: maxConcurrency } = config;
  if (maxConcurrency === undefined || maxConcurrency <= ZERO) return null;
  return new Semaphore(maxConcurrency, `${label}/Concurrency`);
};

/** Time window counters result */
export interface TimeWindowCountersResult {
  rpmCounter: TimeWindowCounter | null;
  rpdCounter: TimeWindowCounter | null;
  tpmCounter: TimeWindowCounter | null;
  tpdCounter: TimeWindowCounter | null;
}

/** Create a single time window counter */
const createSingleCounter = (
  limit: number | undefined,
  windowMs: number,
  name: string
): TimeWindowCounter | null => {
  if (limit === undefined || limit <= ZERO) return null;
  return new TimeWindowCounter(limit, windowMs, name);
};

/** Initialize all time window counters from config */
export const initializeTimeWindowCountersFromConfig = (
  config: InternalLimiterConfig,
  label: string
): TimeWindowCountersResult => ({
  rpmCounter: createSingleCounter(config.requestsPerMinute, MS_PER_MINUTE, `${label}/RPM`),
  rpdCounter: createSingleCounter(config.requestsPerDay, MS_PER_DAY, `${label}/RPD`),
  tpmCounter: createSingleCounter(config.tokensPerMinute, MS_PER_MINUTE, `${label}/TPM`),
  tpdCounter: createSingleCounter(config.tokensPerDay, MS_PER_DAY, `${label}/TPD`),
});

/** Create estimates from config */
export const createEstimatesFromConfig = (config: InternalLimiterConfig): CapacityEstimates => ({
  estimatedNumberOfRequests: config.estimatedNumberOfRequests ?? ZERO,
  estimatedUsedTokens: config.estimatedUsedTokens ?? ZERO,
});

/** Parameters for the capacity waiting loop */
export interface WaitCapacityLoopParams {
  estimates: CapacityEstimates;
  counters: CountersSet;
  tryReserveCapacity: () => JobWindowStarts | null;
  log: (message: string, data?: Record<string, unknown>) => void;
  tpmCounter: TimeWindowCounter | null;
}

/** Wait for time window capacity with polling */
export const waitForTimeWindowCapacityLoop = async (
  params: WaitCapacityLoopParams
): Promise<JobWindowStarts> => {
  const { estimates, counters, tryReserveCapacity, log, tpmCounter } = params;
  const { estimatedNumberOfRequests, estimatedUsedTokens } = estimates;
  if (estimatedNumberOfRequests === ZERO && estimatedUsedTokens === ZERO) {
    log('Skipping capacity wait - estimates are 0');
    return captureWindowStarts(counters);
  }
  const { promise, resolve } = Promise.withResolvers<JobWindowStarts>();
  let waitCount = ZERO;
  const checkCapacity = (): void => {
    const windowStarts = tryReserveCapacity();
    if (windowStarts !== null) {
      if (waitCount > ZERO) {
        log('Capacity available after waiting', { waitCount });
      }
      resolve(windowStarts);
      return;
    }
    waitCount += ONE;
    if (waitCount === ONE) {
      const stats = tpmCounter?.getStats();
      log('Waiting for capacity', {
        tpmCurrent: stats?.current,
        tpmLimit: stats?.limit,
        tpmRemaining: stats?.remaining,
        estimatedTokens: estimatedUsedTokens,
      });
    }
    const waitTime = getMinTimeUntilCapacity(counters);
    setTimeout(checkCapacity, Math.min(waitTime, DEFAULT_POLL_INTERVAL_MS));
  };
  checkCapacity();
  return await promise;
};

/** Build stats object from limiter state */
export const buildLimiterStats = (
  memorySemaphore: Semaphore | null,
  concurrencySemaphore: Semaphore | null,
  counters: TimeWindowCountersResult
): InternalLimiterStats => {
  const stats: InternalLimiterStats = {};
  if (memorySemaphore !== null) {
    const memStats = memorySemaphore.getStats();
    stats.memory = {
      activeKB: memStats.inUse,
      maxCapacityKB: memStats.max,
      availableKB: memStats.available,
      systemAvailableKB: Math.round(getAvailableMemoryKB()),
    };
  }
  if (concurrencySemaphore !== null) {
    const concStats = concurrencySemaphore.getStats();
    stats.concurrency = {
      active: concStats.inUse,
      limit: concStats.max,
      available: concStats.available,
      waiting: concStats.waiting,
    };
  }
  if (counters.rpmCounter !== null) stats.requestsPerMinute = counters.rpmCounter.getStats();
  if (counters.rpdCounter !== null) stats.requestsPerDay = counters.rpdCounter.getStats();
  if (counters.tpmCounter !== null) stats.tokensPerMinute = counters.tpmCounter.getStats();
  if (counters.tpdCounter !== null) stats.tokensPerDay = counters.tpdCounter.getStats();
  return stats;
};

/** Create delegation result from error usage */
export const createDelegationResult = (usage: {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}): InternalJobResult => ({
  requestCount: usage.requests,
  usage: {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cached: usage.cachedTokens,
  },
});
