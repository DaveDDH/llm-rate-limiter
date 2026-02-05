/**
 * Helper functions for Redis backend configuration initialization.
 */
import type { Redis as RedisType } from 'ioredis';

import { ONE, ZERO } from './constants.js';
import { INIT_CONFIG_SCRIPT } from './luaScripts.js';
import type { RedisKeys } from './redisHelpers.js';
import { evalScript } from './redisHelpers.js';
import type { RedisBackendInternalConfig } from './types.js';

/**
 * Resource configuration with ratio for a job type.
 */
export interface JobTypeResourceConfig {
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
  ratio: number;
}

/**
 * Calculate the ratio for job types that don't have a specified ratio.
 * Distributes remaining capacity evenly among unspecified job types.
 */
const calculateEvenShare = (remainingRatio: number, unspecifiedCount: number): number =>
  unspecifiedCount > ZERO ? remainingRatio / unspecifiedCount : ZERO;

/**
 * Process a single job type configuration and extract its specified ratio.
 */
const processJobTypeRatio = (
  config:
    | { ratio?: { initialValue?: number }; estimatedUsedTokens?: number; estimatedNumberOfRequests?: number }
    | undefined,
  specifiedRatios: Map<string, number>,
  id: string
): number => {
  if (config?.ratio?.initialValue !== undefined) {
    specifiedRatios.set(id, config.ratio.initialValue);
    return config.ratio.initialValue;
  }
  return ZERO;
};

/**
 * Build the job type resources object with ratios calculated.
 */
export const buildJobTypeResources = (
  resourceEstimationsPerJob: RedisBackendInternalConfig['resourceEstimationsPerJob']
): Record<string, JobTypeResourceConfig> => {
  if (resourceEstimationsPerJob === undefined) {
    return {};
  }

  const jobTypeResources: Record<string, JobTypeResourceConfig> = {};
  const jobTypeIds = Object.keys(resourceEstimationsPerJob);

  // First pass: collect specified ratios
  let specifiedTotal = ZERO;
  const specifiedRatios = new Map<string, number>();

  for (const id of jobTypeIds) {
    const { [id]: config } = resourceEstimationsPerJob;
    specifiedTotal += processJobTypeRatio(config, specifiedRatios, id);
  }

  // Calculate even share for unspecified job types
  const remainingRatio = ONE - specifiedTotal;
  const unspecifiedCount = jobTypeIds.length - specifiedRatios.size;
  const evenShare = calculateEvenShare(remainingRatio, unspecifiedCount);

  // Second pass: build final resources object
  for (const id of jobTypeIds) {
    const { [id]: config } = resourceEstimationsPerJob;
    jobTypeResources[id] = {
      estimatedUsedTokens: config?.estimatedUsedTokens ?? ONE,
      estimatedNumberOfRequests: config?.estimatedNumberOfRequests ?? ONE,
      ratio: specifiedRatios.get(id) ?? evenShare,
    };
  }

  return jobTypeResources;
};

/**
 * Initialize config in Redis (model capacities and job type resources).
 */
export const initConfigInRedis = async (
  redis: RedisType,
  keys: RedisKeys,
  modelCapacities: RedisBackendInternalConfig['modelCapacities'],
  resourceEstimationsPerJob: RedisBackendInternalConfig['resourceEstimationsPerJob']
): Promise<void> => {
  if (modelCapacities === undefined || resourceEstimationsPerJob === undefined) {
    return;
  }

  const jobTypeResources = buildJobTypeResources(resourceEstimationsPerJob);

  await evalScript(
    redis,
    INIT_CONFIG_SCRIPT,
    [keys.modelCapacities, keys.jobTypeResources],
    [JSON.stringify(modelCapacities), JSON.stringify(jobTypeResources)]
  );
};
