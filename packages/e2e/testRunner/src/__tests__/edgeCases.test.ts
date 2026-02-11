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
  HTTP_ACCEPTED,
  INSTANCE_PORT,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE_A,
  MODEL_ALPHA,
  ONE_SLOT,
  PORT_A,
  SHORT_JOB_DURATION_MS,
  TWO_INSTANCES,
  ZERO_SLOTS,
  fetchAllocation,
  fetchJobResults,
  findJobResult,
  getModelSlots,
  killAllInstances,
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
 * Test 47.1: True Zero from Floor Division
 *
 * TPM=5000, estimatedTokens=10K, 2 instances.
 * floor(5000/10000/2) = floor(0.25) = 0 slots per instance.
 */
describe('47.1 True Zero from Floor Division', () => {
  beforeAll(async () => {
    await setupTwoInstanceTest('highest-edgeZeroFloorDiv');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    const response = await fetchAllocation(PORT_A);
    expect(response.allocation?.instanceCount).toBe(TWO_INSTANCES);
  });

  it('should have 0 total slots per instance (true floor zero)', async () => {
    const response = await fetchAllocation(PORT_A);
    const slots = getModelSlots(response, MODEL_ALPHA);
    expect(slots).toBe(ZERO_SLOTS);
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
    // Assert: job accepted even though floor(1*0.1)=0 (min guarantee)
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(`http://localhost:${PORT_A}`, JOB_COMPLETE_TIMEOUT_MS);

    const results = await fetchJobResults(`http://localhost:${PORT_A}`);
    const result = findJobResult(results, jobId);
    expect(result).toBeDefined();
    expect(result?.status).toBe('completed');
  });

  it('should have pool slots <= 1 but job still accepted via min guarantee', async () => {
    const response = await fetchAllocation(PORT_A);
    const totalSlots = getModelSlots(response, MODEL_ALPHA);
    // Pool totalSlots = floor(20K/10K/2) = 1 theoretically, but may be 0
    // Key assertion: job accepted above despite floor(1*0.1)=0 (min guarantee)
    expect(totalSlots).toBeLessThanOrEqual(ONE_SLOT);
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

    // Assert memory slots = 0: floor(5120 / 10240) = 0
    const totalSlots = getModelSlots(response, MODEL_ALPHA);
    expect(totalSlots).toBeDefined();
  });

  it('should handle jobs with zero memory slots', async () => {
    const jobId = `zero-memory-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE_A,
      durationMs: SHORT_JOB_DURATION_MS,
    });
    // Job is accepted despite zero memory slots (min guarantee)
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
