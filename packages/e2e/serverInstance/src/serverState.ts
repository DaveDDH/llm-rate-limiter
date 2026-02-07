/**
 * Mutable server state that can be reset during E2E tests.
 */
import { DebugEventEmitter, JobHistoryTracker } from './debug/index.js';
import { logger } from './logger.js';
import type { ConfigPresetName } from './rateLimiterConfigs.js';
import { type ServerRateLimiter, createRateLimiterInstance } from './rateLimiterSetup.js';
import { cleanupRedisKeys } from './redisCleanup.js';

/** Overage event recorded from the rate limiter callback */
export interface RecordedOverageEvent {
  resourceType: string;
  estimated: number;
  actual: number;
  overage: number;
  timestamp: number;
}

/** Mutable server state */
export interface ServerState {
  rateLimiter: ServerRateLimiter;
  eventEmitter: DebugEventEmitter;
  jobHistoryTracker: JobHistoryTracker;
  currentConfigPreset: ConfigPresetName;
  overageEvents: RecordedOverageEvent[];
}

/** Create initial server state */
export const createServerState = (
  redisUrl: string,
  configPreset: ConfigPresetName = 'default'
): ServerState => {
  const jobHistoryTracker = new JobHistoryTracker();
  const overageEvents: RecordedOverageEvent[] = [];
  const onOverage = createOverageHandler(overageEvents);
  const rateLimiter = createRateLimiterInstance(redisUrl, configPreset, onOverage);
  const eventEmitter = new DebugEventEmitter(rateLimiter.getInstanceId());

  return { rateLimiter, eventEmitter, jobHistoryTracker, currentConfigPreset: configPreset, overageEvents };
};

const ARRAY_START = 0;

/** Clear all elements from an array in place */
const clearArray = (arr: unknown[]): void => {
  arr.splice(ARRAY_START);
};

/** Create an overage handler that pushes events to the array */
const createOverageHandler =
  (events: RecordedOverageEvent[]) =>
  (event: RecordedOverageEvent): void => {
    events.push(event);
  };

/** Result of a reset operation */
export interface ResetResult {
  success: boolean;
  keysDeleted: number;
  newInstanceId: string;
}

/** Options for resetting server state */
export interface ResetOptions {
  /** Whether to clean Redis keys (default: true). Set to false when multiple instances share Redis. */
  cleanRedis?: boolean;
  /** Configuration preset to use after reset (default: keep current) */
  configPreset?: ConfigPresetName;
}

/** Parameters for creating new state after reset */
interface NewStateParams {
  rateLimiter: ServerRateLimiter;
  eventEmitter: DebugEventEmitter;
  configPreset: ConfigPresetName;
}

/** Update server state with new components (atomic update to avoid race conditions) */
const updateServerState = (state: ServerState, params: NewStateParams): void => {
  // Use Object.assign to perform atomic property updates
  Object.assign(state, {
    rateLimiter: params.rateLimiter,
    eventEmitter: params.eventEmitter,
    currentConfigPreset: params.configPreset,
  });
};

/**
 * Reset server state: optionally clean Redis, stop old rate limiter, create new one.
 * Mutates the state object in place.
 */
export const resetServerState = async (
  state: ServerState,
  redisUrl: string,
  options: ResetOptions = {}
): Promise<ResetResult> => {
  const { cleanRedis = true, configPreset } = options;
  // Use specified preset or keep current
  const presetToUse = configPreset ?? state.currentConfigPreset;

  logger.info('Resetting server state...', { cleanRedis, configPreset: presetToUse });

  // Stop the old rate limiter
  state.rateLimiter.stop();
  logger.info('Old rate limiter stopped');

  // Clean Redis keys only if requested
  let keysDeleted = 0;
  if (cleanRedis) {
    keysDeleted = await cleanupRedisKeys(redisUrl);
    logger.info(`Cleaned ${keysDeleted} Redis keys`);
  }

  // Clear job history and overage events
  state.jobHistoryTracker.clear();
  clearArray(state.overageEvents);
  logger.info('Job history and overage events cleared');

  // Close old SSE connections
  state.eventEmitter.closeAll();
  logger.info('SSE connections closed');

  // Create new rate limiter with specified preset and overage tracking
  const onOverage = createOverageHandler(state.overageEvents);
  const newRateLimiter = createRateLimiterInstance(redisUrl, presetToUse, onOverage);
  await newRateLimiter.start();
  logger.info('New rate limiter started', { configPreset: presetToUse });

  // Create new event emitter with new instance ID
  const newEventEmitter = new DebugEventEmitter(newRateLimiter.getInstanceId());

  // Update state references atomically
  updateServerState(state, {
    rateLimiter: newRateLimiter,
    eventEmitter: newEventEmitter,
    configPreset: presetToUse,
  });

  logger.info(`Server reset complete. New instance ID: ${newRateLimiter.getInstanceId()}`);

  return {
    success: true,
    keysDeleted,
    newInstanceId: newRateLimiter.getInstanceId(),
  };
};
