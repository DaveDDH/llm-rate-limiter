/**
 * Redis cleanup utility for E2E tests.
 * Cleans all rate limiter keys before starting tests.
 */
import { Redis } from 'ioredis';

/** Default key prefixes used by the rate limiter */
const KEY_PREFIXES = ['llm-rl:', 'llm-rate-limiter:'];

/** Result of a cleanup operation */
export interface CleanupResult {
  /** Total number of keys deleted */
  totalKeysDeleted: number;
  /** Keys deleted per prefix */
  keysPerPrefix: Record<string, number>;
  /** Duration of cleanup in milliseconds */
  durationMs: number;
}

/** Configuration for Redis cleanup */
export interface RedisCleanupConfig {
  /** Redis URL (e.g., 'redis://localhost:6379') */
  url: string;
  /** Additional key prefixes to clean (optional) */
  additionalPrefixes?: string[];
}

const ZERO = 0;
const BATCH_SIZE = 100;

/**
 * Delete keys matching a pattern using SCAN (safer than KEYS for production).
 * Returns the number of keys deleted.
 */
const deleteKeysByPattern = async (redis: Redis, pattern: string): Promise<number> => {
  let cursor = '0';
  let totalDeleted = ZERO;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', BATCH_SIZE);
    cursor = nextCursor;

    if (keys.length > ZERO) {
      await redis.del(...keys);
      totalDeleted += keys.length;
    }
  } while (cursor !== '0');

  return totalDeleted;
};

/**
 * Clean all rate limiter keys from Redis.
 * Uses SCAN to safely iterate over keys without blocking.
 */
export const cleanupRedis = async (config: RedisCleanupConfig): Promise<CleanupResult> => {
  const startTime = Date.now();
  const redis = new Redis(config.url);

  const prefixes = [...KEY_PREFIXES, ...(config.additionalPrefixes ?? [])];
  const keysPerPrefix: Record<string, number> = {};
  let totalKeysDeleted = ZERO;

  try {
    for (const prefix of prefixes) {
      const pattern = `${prefix}*`;
      const deleted = await deleteKeysByPattern(redis, pattern);
      keysPerPrefix[prefix] = deleted;
      totalKeysDeleted += deleted;
    }
  } finally {
    await redis.quit();
  }

  return {
    totalKeysDeleted,
    keysPerPrefix,
    durationMs: Date.now() - startTime,
  };
};

/**
 * Create a cleanup function bound to a specific Redis URL.
 * Useful for reusing the same config across multiple cleanup calls.
 */
export const createRedisCleanup = (config: RedisCleanupConfig): (() => Promise<CleanupResult>) => {
  return () => cleanupRedis(config);
};
