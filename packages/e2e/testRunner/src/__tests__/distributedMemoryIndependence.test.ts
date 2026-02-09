/**
 * Test suite: Distributed Memory Independence (Test 38)
 *
 * Verifies that memory constraints are LOCAL only and NOT shared via Redis.
 * Each instance has its own memory limit that constrains final slot allocation.
 *
 * Uses the highest-memoryDistributed config preset:
 * - model-alpha: 1M TPM (very high, not limiting)
 * - jobTypeA: estimatedMemoryKB=10MB
 * - Instance A: 100MB memory = 10 memory slots
 * - Instance B: 200MB memory = 20 memory slots
 *
 * Key behaviors to verify:
 * 1. Memory not shared via Redis
 * 2. Redis allocation unaware of memory
 * 3. Different memory yields different final slots
 */
import {
  DISTRIBUTED_POOL_SLOTS,
  HTTP_ACCEPTED,
  JOB_TYPE,
  MEMORY_SLOTS_A,
  MEMORY_SLOTS_B,
  MODEL_ID,
  PORT_A,
  PORT_B,
  SHORT_JOB_DURATION_MS,
  TWO_INSTANCES,
  fetchAllocation,
  getActiveJobCount,
  getModelPoolSlots,
  killAllInstances,
  setupTwoInstancesWithMemory,
  submitJob,
} from './distributedMemoryIndependenceHelpers.js';

const AFTER_ALL_TIMEOUT_MS = 30000;
const BEFORE_ALL_TIMEOUT_MS = 60000;

// Extra slot to overfill memory
const OVERFILL_EXTRA = 1;

// Loop increment
const LOOP_INCREMENT = 1;

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Memory Independence - Memory Not Shared Via Redis', () => {
  beforeAll(async () => {
    await setupTwoInstancesWithMemory();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('38.1: should have different memory-based slots on each instance', async () => {
    const allocA = await fetchAllocation(PORT_A);
    const allocB = await fetchAllocation(PORT_B);

    expect(allocA.allocation?.instanceCount).toBe(TWO_INSTANCES);
    expect(allocB.allocation?.instanceCount).toBe(TWO_INSTANCES);

    const jobsAPromises = [];
    for (let i = 0; i < MEMORY_SLOTS_A; i += LOOP_INCREMENT) {
      jobsAPromises.push(submitJob(PORT_A, `job-a-${i}`, JOB_TYPE, SHORT_JOB_DURATION_MS));
    }
    const resultsA = await Promise.all(jobsAPromises);

    resultsA.forEach((status) => {
      expect(status).toBe(HTTP_ACCEPTED);
    });

    const activeA = await getActiveJobCount(PORT_A);
    expect(activeA).toBeLessThanOrEqual(MEMORY_SLOTS_A);

    const jobsBPromises = [];
    for (let i = 0; i < MEMORY_SLOTS_B; i += LOOP_INCREMENT) {
      jobsBPromises.push(submitJob(PORT_B, `job-b-${i}`, JOB_TYPE, SHORT_JOB_DURATION_MS));
    }
    const resultsB = await Promise.all(jobsBPromises);

    resultsB.forEach((status) => {
      expect(status).toBe(HTTP_ACCEPTED);
    });

    const activeB = await getActiveJobCount(PORT_B);
    expect(activeB).toBeLessThanOrEqual(MEMORY_SLOTS_B);
  });
});

describe('Distributed Memory Independence - Redis Allocation Unaware of Memory', () => {
  beforeAll(async () => {
    await setupTwoInstancesWithMemory();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('38.2: should show same Redis pool slots despite different memory limits', async () => {
    const allocA = await fetchAllocation(PORT_A);
    const allocB = await fetchAllocation(PORT_B);

    const poolSlotsA = getModelPoolSlots(allocA, MODEL_ID);
    const poolSlotsB = getModelPoolSlots(allocB, MODEL_ID);

    expect(poolSlotsA).toBe(DISTRIBUTED_POOL_SLOTS);
    expect(poolSlotsB).toBe(DISTRIBUTED_POOL_SLOTS);
  });
});

describe('Distributed Memory Independence - Different Memory Yields Different Final Slots', () => {
  beforeAll(async () => {
    await setupTwoInstancesWithMemory();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('38.3: should constrain final slots by local memory', async () => {
    const fillJobsA = [];
    for (let i = 0; i < MEMORY_SLOTS_A + OVERFILL_EXTRA; i += LOOP_INCREMENT) {
      fillJobsA.push(submitJob(PORT_A, `fill-a-${i}`, JOB_TYPE, SHORT_JOB_DURATION_MS));
    }
    await Promise.all(fillJobsA);

    const activeA = await getActiveJobCount(PORT_A);
    expect(activeA).toBeLessThanOrEqual(MEMORY_SLOTS_A);

    const fillJobsB = [];
    for (let i = 0; i < MEMORY_SLOTS_B + OVERFILL_EXTRA; i += LOOP_INCREMENT) {
      fillJobsB.push(submitJob(PORT_B, `fill-b-${i}`, JOB_TYPE, SHORT_JOB_DURATION_MS));
    }
    await Promise.all(fillJobsB);

    const activeB = await getActiveJobCount(PORT_B);
    expect(activeB).toBeLessThanOrEqual(MEMORY_SLOTS_B);

    expect(activeB).toBeGreaterThan(activeA);
  });
});
