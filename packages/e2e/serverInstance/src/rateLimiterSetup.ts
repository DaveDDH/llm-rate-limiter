import {
  type LLMRateLimiterInstance,
  type MemoryLimitConfig,
  type OnAvailableSlotsChange,
  createLLMRateLimiter,
} from '@llm-rate-limiter/core';
import { createRedisBackend } from '@llm-rate-limiter/redis';

import { logger } from './logger.js';
import { type ConfigPresetName, getConfigPreset } from './rateLimiterConfigs.js';

/** No-op callback to enable the availability tracker (required for debug allocation endpoint) */
const noopSlotsChange: OnAvailableSlotsChange = (_availability, _reason, _modelId) => undefined;

const KB_PER_MB = 1024;
const RADIX_DECIMAL = 10;

/** Parse --max-old-space-size from NODE_OPTIONS and convert to KB */
const getMaxMemoryKBFromNodeOptions = (): number | undefined => {
  const nodeOptions = process.env.NODE_OPTIONS ?? '';
  const match = /--max-old-space-size=(?<size>\d+)/v.exec(nodeOptions);
  if (match?.groups?.size !== undefined) {
    return parseInt(match.groups.size, RADIX_DECIMAL) * KB_PER_MB;
  }
  return undefined;
};

/** Build memory config by merging preset with auto-detected maxMemoryKB */
const buildMemoryConfig = (presetMemory: MemoryLimitConfig | undefined): MemoryLimitConfig | undefined => {
  if (presetMemory === undefined) return undefined;
  const maxMemoryKB = getMaxMemoryKBFromNodeOptions();
  if (maxMemoryKB === undefined) return presetMemory;
  return { ...presetMemory, maxMemoryKB };
};

/** Overage callback type matching the rate limiter's OverageFn */
type OverageCallback = (event: {
  resourceType: string;
  estimated: number;
  actual: number;
  overage: number;
  timestamp: number;
}) => void;

export const createRateLimiterInstance = (
  redisUrl: string,
  configPreset: ConfigPresetName = 'default',
  onOverage?: OverageCallback
): LLMRateLimiterInstance<string> => {
  const config = getConfigPreset(configPreset);

  logger.info('Creating rate limiter with config', {
    preset: configPreset,
    models: Object.keys(config.models),
    jobTypes: Object.keys(config.resourceEstimations),
  });

  return createLLMRateLimiter({
    models: config.models,
    escalationOrder: config.escalationOrder,
    resourceEstimationsPerJob: config.resourceEstimations,
    ratioAdjustmentConfig: config.ratioAdjustmentConfig,
    memory: buildMemoryConfig(config.memory),
    backend: createRedisBackend(redisUrl),
    onLog: (message, data) => logger.info(message, data),
    onAvailableSlotsChange: noopSlotsChange,
    onOverage,
  });
};

export type ServerRateLimiter = LLMRateLimiterInstance<string>;
