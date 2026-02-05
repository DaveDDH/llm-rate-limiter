import {
  type LLMRateLimiterInstance,
  type OnAvailableSlotsChange,
  createLLMRateLimiter,
} from '@llm-rate-limiter/core';
import { createRedisBackend } from '@llm-rate-limiter/redis';

import { logger } from './logger.js';
import { type ConfigPresetName, getConfigPreset } from './rateLimiterConfigs.js';

/** No-op callback to enable the availability tracker (required for debug allocation endpoint) */
const noopSlotsChange: OnAvailableSlotsChange = (_availability, _reason, _modelId) => undefined;

export const createRateLimiterInstance = (
  redisUrl: string,
  configPreset: ConfigPresetName = 'default'
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
    backend: createRedisBackend(redisUrl),
    onLog: (message, data) => logger.info(message, data),
    onAvailableSlotsChange: noopSlotsChange,
  });
};

export type ServerRateLimiter = LLMRateLimiterInstance<string>;
