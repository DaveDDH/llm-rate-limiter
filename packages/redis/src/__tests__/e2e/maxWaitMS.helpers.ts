/**
 * Helper functions for maxWaitMS e2e tests.
 * Provides utilities for creating rate limiters, controlled jobs, and test assertions.
 */
import { createLLMRateLimiter } from '@llm-rate-limiter/core';
import type { LLMRateLimiterInstance } from '@llm-rate-limiter/core';
import { Redis } from 'ioredis';
import { setTimeout as sleep } from 'node:timers/promises';

import { createRedisBackend } from '../../redisBackendFactory.js';
import type { RedisBackendFactory } from '../../types.js';
import { getRedisUrl } from './e2eConfigs.js';

// =============================================================================
// Constants
// =============================================================================

const ZERO = 0;
const RADIX_BASE = 36;
const SLICE_START = 2;
const KEEPALIVE_MS = 30000;
const SETTLE_DELAY_MS = 100;

// Pricing constants
const INPUT_PRICE = 0.01;
const CACHED_PRICE = 0.005;
const OUTPUT_PRICE = 0.02;

// Test-specific model/job type names
export type TestModelName = 'fastModel' | 'slowModel' | 'backupModel';
export type TestJobType = 'critical' | 'lowPriority' | 'standard' | 'background';

// =============================================================================
// Test State Management
// =============================================================================

/** State for a single rate limiter instance */
export interface InstanceState {
  limiter: LLMRateLimiterInstance<TestJobType>;
  backend: RedisBackendFactory;
  instanceId: string;
}

/** Global test state */
export interface E2ETestState {
  redisAvailable: boolean;
  redis: Redis | undefined;
  testPrefix: string;
  instances: InstanceState[];
}

/** Create fresh test state */
export const createTestState = (): E2ETestState => ({
  redisAvailable: false,
  redis: undefined,
  testPrefix: '',
  instances: [],
});

/** Generate unique test prefix */
export const generateTestPrefix = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(RADIX_BASE).slice(SLICE_START);
  return `e2e-maxwait-${timestamp}-${random}:`;
};

// =============================================================================
// Redis Setup
// =============================================================================

/** Check if Redis is available */
export const checkRedisAvailable = async (): Promise<boolean> => {
  try {
    const url = getRedisUrl();
    const redis = new Redis(url, { lazyConnect: true, keepAlive: KEEPALIVE_MS });
    await redis.connect();
    await redis.ping();
    await redis.quit();
    return true;
  } catch {
    return false;
  }
};

/** Setup Redis connection for tests */
export const setupRedis = async (state: E2ETestState): Promise<void> => {
  const available = await checkRedisAvailable();
  Object.assign(state, { redisAvailable: available });
  if (available) {
    const url = getRedisUrl();
    const redis = new Redis(url, { keepAlive: KEEPALIVE_MS });
    Object.assign(state, { redis });
  }
};

/** Cleanup Redis connection */
export const cleanupRedis = async (state: E2ETestState): Promise<void> => {
  if (state.redis !== undefined) {
    await state.redis.quit();
  }
};

/** Cleanup test keys from Redis */
export const cleanupTestKeys = async (state: E2ETestState): Promise<void> => {
  if (state.redis === undefined) return;
  const keys = await state.redis.keys(`${state.testPrefix}*`);
  if (keys.length > ZERO) {
    await state.redis.del(...keys);
  }
};

// =============================================================================
// Model & Job Type Configurations
// =============================================================================

/** Default pricing for all models */
const DEFAULT_PRICING = { input: INPUT_PRICE, cached: CACHED_PRICE, output: OUTPUT_PRICE };

/** Small capacity for controlled testing */
const SMALL_CAPACITY = 5;

/** Create models config with VERY limited capacity to test blocking behavior */
export const createTestModels = (): Record<TestModelName, {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  maxConcurrentRequests?: number;
  pricing: { input: number; cached: number; output: number };
}> => ({
  // Use maxConcurrentRequests to limit capacity - this creates blocking behavior
  fastModel: { maxConcurrentRequests: SMALL_CAPACITY, pricing: DEFAULT_PRICING },
  slowModel: { maxConcurrentRequests: SMALL_CAPACITY, pricing: DEFAULT_PRICING },
  backupModel: { maxConcurrentRequests: SMALL_CAPACITY, pricing: DEFAULT_PRICING },
});

/** Resource estimations - small values for fast testing */
const ESTIMATED_TOKENS = 100;
const ESTIMATED_REQUESTS = 1;

export interface MaxWaitMSPerModel {
  [modelName: string]: number | undefined;
  fastModel?: number;
  slowModel?: number;
  backupModel?: number;
}

export interface JobTypeRatioConfig {
  initialValue: number;
  flexible?: boolean;
}

export interface JobTypeConfig {
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
  maxWaitMS?: MaxWaitMSPerModel;
  ratio?: JobTypeRatioConfig;
}

/** Create job type config with specific maxWaitMS and optional ratio */
export const createJobTypeConfig = (
  maxWaitMS?: MaxWaitMSPerModel,
  ratio?: JobTypeRatioConfig
): JobTypeConfig => ({
  estimatedUsedTokens: ESTIMATED_TOKENS,
  estimatedNumberOfRequests: ESTIMATED_REQUESTS,
  maxWaitMS,
  ratio,
});

// =============================================================================
// Rate Limiter Creation
// =============================================================================

export interface CreateLimiterOptions {
  state: E2ETestState;
  jobTypes: Record<TestJobType, JobTypeConfig>;
  escalationOrder?: readonly TestModelName[];
}

/** Create and start a rate limiter instance */
export const createAndStartLimiter = async (options: CreateLimiterOptions): Promise<InstanceState> => {
  const { state, jobTypes, escalationOrder } = options;

  // Use the factory API - capacity is derived from model configs automatically
  const backend = createRedisBackend({
    url: getRedisUrl(),
    keyPrefix: state.testPrefix,
  });

  // Default to single model to ensure capacity is properly limited
  const limiter = createLLMRateLimiter({
    backend,
    models: createTestModels(),
    escalationOrder: escalationOrder ?? ['fastModel'],
    resourceEstimationsPerJob: jobTypes,
  });

  await limiter.start();

  const instanceState: InstanceState = {
    limiter,
    backend,
    instanceId: limiter.getInstanceId(),
  };

  state.instances.push(instanceState);
  return instanceState;
};

/** Stop all instances and cleanup */
export const cleanupInstances = async (state: E2ETestState): Promise<void> => {
  const promises = state.instances.map(async ({ limiter, backend }) => {
    limiter.stop();
    await backend.stop();
  });
  await Promise.all(promises);
  Object.assign(state, { instances: [] });
};

/** Wait for job to settle (either complete or be queued) */
export const settleDelay = async (): Promise<void> => {
  await sleep(SETTLE_DELAY_MS);
};

/** Re-export sleep for tests */
export { sleep };
