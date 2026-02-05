/**
 * Redis cleanup utility for server reset.
 */
import { Redis } from 'ioredis';

/** Default key prefixes used by the rate limiter */
const KEY_PREFIXES = ['llm-rl:', 'llm-rate-limiter:'];

const ZERO = 0;
const BATCH_SIZE = 100;
const INITIAL_CURSOR = '0';

/** Result of a single scan iteration */
interface ScanResult {
  cursor: string;
  keys: string[];
}

/** Perform a single scan iteration */
const scanIteration = async (redis: Redis, pattern: string, cursor: string): Promise<ScanResult> => {
  const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', BATCH_SIZE);
  return { cursor: nextCursor, keys };
};

/** Recursively collect all keys matching a pattern using SCAN */
const collectAllKeys = async (
  redis: Redis,
  pattern: string,
  cursor: string,
  accumulated: string[]
): Promise<string[]> => {
  const result = await scanIteration(redis, pattern, cursor);
  const allKeys = [...accumulated, ...result.keys];

  if (result.cursor === INITIAL_CURSOR) {
    return allKeys;
  }

  return await collectAllKeys(redis, pattern, result.cursor, allKeys);
};

/**
 * Delete keys matching a pattern using SCAN.
 */
const deleteKeysByPattern = async (redis: Redis, pattern: string): Promise<number> => {
  const keys = await collectAllKeys(redis, pattern, INITIAL_CURSOR, []);

  if (keys.length === ZERO) {
    return ZERO;
  }

  await redis.del(...keys);
  return keys.length;
};

/**
 * Clean all rate limiter keys from Redis.
 */
export const cleanupRedisKeys = async (redisUrl: string): Promise<number> => {
  const redis = new Redis(redisUrl);

  try {
    const deletionPromises = KEY_PREFIXES.map(
      async (prefix) => await deleteKeysByPattern(redis, `${prefix}*`)
    );
    const results = await Promise.all(deletionPromises);
    return results.reduce((sum, count) => sum + count, ZERO);
  } finally {
    await redis.quit();
  }
};
