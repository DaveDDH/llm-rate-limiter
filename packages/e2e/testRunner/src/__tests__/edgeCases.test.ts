/**
 * Test suite: Edge Cases Part 1 (Test 47)
 *
 * Verifies edge cases work correctly.
 *
 * Tests 47.1-47.4:
 * - 47.1: Very large instance count
 * - 47.2: Floor rounding guarantees minimum slot
 * - 47.3: Zero memory slots
 * - 47.4: Very large memory estimate
 *
 * Multiple config presets:
 * - highest-edgeZeroSlots: TPM=15K, 4 instances → 1 slot (min guarantee)
 * - highest-edgeFloor: TPM=20K, ratio=0.1 → floor=0
 * - highest-edgeZeroMemory: memory=5MB, estimated=10MB → 0 memory slots
 * - highest-edgeLargeMemory: memory=100MB, estimated=200MB → 0 memory slots
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  FOUR_INSTANCES,
  HTTP_ACCEPTED,
  INSTANCE_PORT,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE_A,
  MODEL_ALPHA,
  ONE_SLOT,
  PORT_A,
  SHORT_JOB_DURATION_MS,
  fetchAllocation,
  fetchJobResults,
  findJobResult,
  getModelSlots,
  killAllInstances,
  setupFourInstanceTest,
  setupSingleInstance,
  setupTwoInstanceTest,
  submitJob,
  waitForJobComplete,
} from './edgeCasesHelpers.js';

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 47.1: Very Large Instance Count
 *
 * TPM=15K, tokens=10K, 4 instances → floor(15K/10K/4) = 0 slots per instance.
 * Each instance gets tokensPerMinute=15K/4=3750 (fractional allocation).
 */
describe('47.1 Very Large Instance Count', () => {
  beforeAll(async () => {
    await setupFourInstanceTest('highest-edgeZeroSlots');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 4 instances', async () => {
    const response = await fetchAllocation(PORT_A);
    expect(response.allocation?.instanceCount).toBe(FOUR_INSTANCES);
  });

  it('should have 1 total slot per instance (min-1-slot guarantee)', async () => {
    const response = await fetchAllocation(PORT_A);
    const slots = getModelSlots(response, MODEL_ALPHA);
    expect(slots).toBe(ONE_SLOT);
  });
});

/**
 * Test 47.2: Floor Rounding Guarantees Minimum Slot
 *
 * TPM=20K, 2 instances, jobTypeA ratio=0.1, jobTypeB ratio=0.9.
 * Pool: floor(20K/10K/2) = 1 slot per instance.
 * jobTypeA floor slots: floor(1 x 0.1) = 0, but minJobTypeCapacity enforces >= 1.
 */
describe('47.2 Floor Rounding Guarantees Minimum Slot', () => {
  beforeAll(async () => {
    await setupTwoInstanceTest('highest-edgeFloor');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept jobTypeA job despite floor rounding to 0', async () => {
    const jobId = `floor-edge-${Date.now()}`;
    const status = await submitJob({
      baseUrl: `http://localhost:${PORT_A}`,
      jobId,
      jobType: JOB_TYPE_A,
      durationMs: SHORT_JOB_DURATION_MS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(`http://localhost:${PORT_A}`, JOB_COMPLETE_TIMEOUT_MS);

    const results = await fetchJobResults(`http://localhost:${PORT_A}`);
    const result = findJobResult(results, jobId);
    expect(result).toBeDefined();
    expect(result?.status).toBe('completed');
  });

  it('should have at least 1 slot available for jobTypeA', async () => {
    const response = await fetchAllocation(PORT_A);
    const totalSlots = getModelSlots(response, MODEL_ALPHA);
    expect(totalSlots).toBeGreaterThanOrEqual(ONE_SLOT);
  });
});

/**
 * Test 47.3: Zero Memory Slots
 *
 * Config maxMemoryKB=5MB (5120KB), estimatedUsedMemoryKB=10MB (10240KB).
 * Memory slots = floor(5120 / 10240) = 0.
 */
describe('47.3 Zero Memory Slots', () => {
  beforeAll(async () => {
    await setupSingleInstance('highest-edgeZeroMemory');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should boot instance with limited memory', async () => {
    const response = await fetchAllocation(INSTANCE_PORT);
    expect(response.allocation).toBeDefined();
  });

  it('should handle jobs with zero memory slots', async () => {
    const jobId = `zero-memory-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE_A,
      durationMs: SHORT_JOB_DURATION_MS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
  });
});

/**
 * Test 47.4: Very Large Memory Estimate
 *
 * Config maxMemoryKB=100MB (102400KB), estimatedUsedMemoryKB=200MB (204800KB).
 * Memory slots = floor(102400 / 204800) = 0.
 */
describe('47.4 Very Large Memory Estimate', () => {
  beforeAll(async () => {
    await setupSingleInstance('highest-edgeLargeMemory');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should boot instance with memory constraint', async () => {
    const response = await fetchAllocation(INSTANCE_PORT);
    expect(response.allocation).toBeDefined();
  });

  it('should handle jobs with large memory estimate', async () => {
    const jobId = `large-memory-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE_A,
      durationMs: SHORT_JOB_DURATION_MS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
  });
});
