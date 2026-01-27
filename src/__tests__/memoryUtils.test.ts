import {
  BYTES_PER_KB,
  BYTES_PER_MB,
  calculateAvailableMemory,
  getAvailableMemoryBytes,
  getAvailableMemoryMB,
  getMemoryStats,
  getUsedMemoryBytes,
  getUsedMemoryMB,
  initDevHeapLimit,
  parseMaxOldSpaceSize,
} from '@globalUtils/memoryUtils.js';

const BYTES_IN_KB = 1024;
const EXPECTED_KB = BYTES_IN_KB;
const EXPECTED_MB = BYTES_IN_KB * BYTES_IN_KB;
const MAX_REASONABLE_GB = 100;
const MAX_REASONABLE_BYTES = MAX_REASONABLE_GB * EXPECTED_MB * BYTES_IN_KB;
const MIN_EXPECTED_BYTES = 1024;
const TOLERANCE = 10;
const ZERO = 0;
const PRECISION = 1;
const TEST_HEAP_SIZE_MB_LARGE = 4096;
const TEST_HEAP_SIZE_MB_MEDIUM = 2048;
const TEST_HEAP_SIZE_MB_SMALL = 1024;

describe('memoryUtils - parseMaxOldSpaceSize', () => {
  it('should return null when NODE_OPTIONS is empty', () => {
    const result = parseMaxOldSpaceSize('');
    expect(result).toBeNull();
  });

  it('should return null when NODE_OPTIONS does not contain max-old-space-size', () => {
    const result = parseMaxOldSpaceSize('--experimental-vm-modules');
    expect(result).toBeNull();
  });

  it('should parse max-old-space-size correctly', () => {
    const result = parseMaxOldSpaceSize(`--max-old-space-size=${TEST_HEAP_SIZE_MB_LARGE}`);
    const EXPECTED_BYTES = TEST_HEAP_SIZE_MB_LARGE * EXPECTED_MB;
    expect(result).toBe(EXPECTED_BYTES);
  });

  it('should parse max-old-space-size when mixed with other options', () => {
    const result = parseMaxOldSpaceSize(
      `--experimental-vm-modules --max-old-space-size=${TEST_HEAP_SIZE_MB_MEDIUM} --other`
    );
    const EXPECTED_BYTES = TEST_HEAP_SIZE_MB_MEDIUM * EXPECTED_MB;
    expect(result).toBe(EXPECTED_BYTES);
  });
});

describe('memoryUtils - calculateAvailableMemory', () => {
  it('should return totalAvailable when devHeapLimit is null', () => {
    const USED = 1000;
    const TOTAL_AVAILABLE = 5000;
    const result = calculateAvailableMemory(null, USED, TOTAL_AVAILABLE);
    expect(result).toBe(TOTAL_AVAILABLE);
  });

  it('should return devHeapLimit minus used when devHeapLimit is set', () => {
    const DEV_LIMIT = 10000;
    const USED = 3000;
    const TOTAL_AVAILABLE = 5000;
    const result = calculateAvailableMemory(DEV_LIMIT, USED, TOTAL_AVAILABLE);
    const EXPECTED = DEV_LIMIT - USED;
    expect(result).toBe(EXPECTED);
  });
});

describe('memoryUtils - initDevHeapLimit', () => {
  it('should return null in production environment', () => {
    const result = initDevHeapLimit('production', `--max-old-space-size=${TEST_HEAP_SIZE_MB_LARGE}`);
    expect(result).toBeNull();
  });

  it('should parse NODE_OPTIONS in non-production environment', () => {
    const result = initDevHeapLimit('development', `--max-old-space-size=${TEST_HEAP_SIZE_MB_MEDIUM}`);
    const EXPECTED_BYTES = TEST_HEAP_SIZE_MB_MEDIUM * EXPECTED_MB;
    expect(result).toBe(EXPECTED_BYTES);
  });

  it('should return null in non-production when NODE_OPTIONS has no max-old-space-size', () => {
    const result = initDevHeapLimit('test', '--experimental-vm-modules');
    expect(result).toBeNull();
  });

  it('should parse NODE_OPTIONS when NODE_ENV is undefined', () => {
    const result = initDevHeapLimit(undefined, `--max-old-space-size=${TEST_HEAP_SIZE_MB_SMALL}`);
    const EXPECTED_BYTES = TEST_HEAP_SIZE_MB_SMALL * EXPECTED_MB;
    expect(result).toBe(EXPECTED_BYTES);
  });

  it('should return null when NODE_OPTIONS is undefined', () => {
    const result = initDevHeapLimit('development', undefined);
    expect(result).toBeNull();
  });
});

describe('memoryUtils - constants', () => {
  it('should have correct BYTES_PER_KB', () => {
    expect(BYTES_PER_KB).toBe(EXPECTED_KB);
  });

  it('should have correct BYTES_PER_MB', () => {
    expect(BYTES_PER_MB).toBe(EXPECTED_MB);
  });
});

describe('memoryUtils - getAvailableMemoryBytes', () => {
  it('should return a positive number', () => {
    const available = getAvailableMemoryBytes();
    expect(available).toBeGreaterThan(ZERO);
  });

  it('should return a reasonable value (less than 100GB)', () => {
    const available = getAvailableMemoryBytes();
    expect(available).toBeLessThan(MAX_REASONABLE_BYTES);
  });
});

describe('memoryUtils - getAvailableMemoryMB', () => {
  it('should return a positive number', () => {
    const availableMB = getAvailableMemoryMB();
    expect(availableMB).toBeGreaterThan(ZERO);
  });

  it('should return bytes divided by BYTES_PER_MB', () => {
    const bytes = getAvailableMemoryBytes();
    const mb = getAvailableMemoryMB();
    expect(mb).toBeCloseTo(bytes / BYTES_PER_MB, PRECISION);
  });
});

describe('memoryUtils - getUsedMemoryBytes', () => {
  it('should return a positive number', () => {
    const used = getUsedMemoryBytes();
    expect(used).toBeGreaterThan(ZERO);
  });

  it('should return a reasonable value', () => {
    const used = getUsedMemoryBytes();
    expect(used).toBeGreaterThan(MIN_EXPECTED_BYTES);
  });
});

describe('memoryUtils - getUsedMemoryMB', () => {
  it('should return a positive number', () => {
    const usedMB = getUsedMemoryMB();
    expect(usedMB).toBeGreaterThan(ZERO);
  });

  it('should return bytes divided by BYTES_PER_MB', () => {
    const bytes = getUsedMemoryBytes();
    const mb = getUsedMemoryMB();
    expect(mb).toBeCloseTo(bytes / BYTES_PER_MB, PRECISION);
  });
});

describe('memoryUtils - getMemoryStats', () => {
  it('should return object with usedMB and availableMB', () => {
    const stats = getMemoryStats();
    expect(stats).toHaveProperty('usedMB');
    expect(stats).toHaveProperty('availableMB');
  });

  it('should return positive values for both properties', () => {
    const stats = getMemoryStats();
    expect(stats.usedMB).toBeGreaterThan(ZERO);
    expect(stats.availableMB).toBeGreaterThan(ZERO);
  });

  it('should return consistent values with individual functions', () => {
    const stats = getMemoryStats();
    const usedMB = getUsedMemoryMB();
    const availableMB = getAvailableMemoryMB();

    expect(Math.abs(stats.usedMB - usedMB)).toBeLessThan(TOLERANCE);
    expect(Math.abs(stats.availableMB - availableMB)).toBeLessThan(TOLERANCE);
  });
});
