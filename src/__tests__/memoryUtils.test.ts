import {
  BYTES_PER_KB,
  BYTES_PER_MB,
  getAvailableMemoryBytes,
  getAvailableMemoryMB,
  getMemoryStats,
  getUsedMemoryBytes,
  getUsedMemoryMB,
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
