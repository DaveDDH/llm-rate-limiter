/**
 * Memory Utilities
 *
 * Provides accurate memory availability measurement that works correctly in:
 * - Production (Docker containers with cgroup memory limits)
 * - Development with --max-old-space-size flag
 * - Development without memory limits
 *
 * IMPORTANT: This is the ONLY method that should be used to check available memory.
 * Do NOT use os.freemem(), os.totalmem(), or raw process.memoryUsage() for
 * determining available heap memory - they don't account for V8 heap limits.
 */
import v8 from 'node:v8';

/** Bytes in a kilobyte */
export const BYTES_PER_KB = 1024;

/** Bytes in a megabyte */
export const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;

const TEN = 10;

/**
 * Parse --max-old-space-size from NODE_OPTIONS.
 * Returns the limit in bytes, or null if not set.
 * Exported for testing purposes.
 */
export const parseMaxOldSpaceSize = (nodeOptions: string): number | null => {
  const match = /--max-old-space-size=(?<size>\d+)/v.exec(nodeOptions);
  if (match?.groups?.size !== undefined) {
    return parseInt(match.groups.size, TEN) * BYTES_PER_MB;
  }
  return null;
};

/**
 * Calculate available memory based on dev heap limit.
 * Exported for testing purposes.
 */
export const calculateAvailableMemory = (
  devHeapLimit: number | null,
  usedHeapSize: number,
  totalAvailableSize: number
): number => {
  if (devHeapLimit !== null) {
    return devHeapLimit - usedHeapSize;
  }
  return totalAvailableSize;
};

/**
 * Initialize dev heap limit based on environment.
 * In production, returns null (use V8's total_available_size).
 * In dev, parses --max-old-space-size from NODE_OPTIONS.
 * Exported for testing purposes.
 */
export const initDevHeapLimit = (nodeEnv: string | undefined, nodeOptions: string | undefined): number | null => {
  if (nodeEnv === 'production') {
    return null;
  }
  return parseMaxOldSpaceSize(nodeOptions ?? '');
};

// Initialize devHeapLimitBytes at module load time
const devHeapLimitBytes = initDevHeapLimit(process.env.NODE_ENV, process.env.NODE_OPTIONS);

/**
 * Get the available heap memory in bytes.
 *
 * This is the correct way to measure available memory that approaches 0 before OOM:
 * - In production (Docker): uses V8's total_available_size which respects cgroup limits
 * - In dev with --max-old-space-size: calculates (limit - used) for accurate measurement
 * - In dev without limits: uses V8's total_available_size
 *
 * @returns Available heap memory in bytes
 */
export const getAvailableMemoryBytes = (): number => {
  const { total_available_size: available, used_heap_size: used } = v8.getHeapStatistics();
  return calculateAvailableMemory(devHeapLimitBytes, used, available);
};

/**
 * Get the available heap memory in kilobytes.
 *
 * @returns Available heap memory in KB
 */
export const getAvailableMemoryKB = (): number => getAvailableMemoryBytes() / BYTES_PER_KB;

/**
 * Get the available heap memory in megabytes.
 *
 * @returns Available heap memory in MB
 */
export const getAvailableMemoryMB = (): number => getAvailableMemoryBytes() / BYTES_PER_MB;

/**
 * Get the used heap memory in bytes.
 *
 * @returns Used heap memory in bytes
 */
export const getUsedMemoryBytes = (): number => {
  const { used_heap_size: used } = v8.getHeapStatistics();
  return used;
};

/**
 * Get the used heap memory in megabytes.
 *
 * @returns Used heap memory in MB
 */
export const getUsedMemoryMB = (): number => getUsedMemoryBytes() / BYTES_PER_MB;

/**
 * Get comprehensive memory statistics.
 *
 * @returns Object with used and available memory in MB
 */
export const getMemoryStats = (): {
  usedMB: number;
  availableMB: number;
} => ({
  usedMB: getUsedMemoryMB(),
  availableMB: getAvailableMemoryMB(),
});
