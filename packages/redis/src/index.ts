/**
 * Redis distributed backend for the LLM Rate Limiter.
 *
 * This module provides a ready-to-use distributed backend that implements
 * the V2 DistributedBackendConfig interface with fair slot distribution.
 *
 * @example
 * ```typescript
 * import { createLLMRateLimiter } from 'llm-rate-limiter';
 * import { createRedisBackend } from 'llm-rate-limiter/redis';
 *
 * // Create Redis backend
 * const redisBackend = await createRedisBackend({
 *   redis: { host: 'localhost', port: 6379 },
 *   totalCapacity: 100,
 * });
 *
 * // Create rate limiter with Redis backend
 * const limiter = createLLMRateLimiter({
 *   backend: redisBackend.getBackendConfig(),
 *   models: {
 *     'gpt-4': {
 *       requestsPerMinute: 500,
 *       pricing: { input: 0.03, output: 0.06, cached: 0.015 },
 *     },
 *   },
 * });
 *
 * // Start (registers with Redis)
 * await limiter.start();
 *
 * // Use normally...
 *
 * // Stop (unregisters from Redis)
 * limiter.stop();
 * await redisBackend.stop();
 * ```
 *
 * @packageDocumentation
 */

export { createRedisBackend } from './redisBackend.js';
export type {
  RedisBackendConfig,
  RedisBackendInstance,
  RedisBackendStats,
  RedisConnectionOptions,
  RedisInstanceStats,
} from './types.js';
