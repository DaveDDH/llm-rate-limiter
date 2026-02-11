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
  fetchStats,
  getAllocatedSlots,
  getModelPoolSlots,
  killAllInstances,
  setupTwoInstancesWithMemory,
  setupTwoInstancesWithMemoryLowTpm,
  submitJob,
} from './distributedMemoryIndependenceHelpers.js';

const AFTER_ALL_TIMEOUT_MS = 30000;
const BEFORE_ALL_TIMEOUT_MS = 60000;

// Fallback for undefined slots
const ZERO_FALLBACK = 0;

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

    const slotsA = getAllocatedSlots(await fetchStats(PORT_A), JOB_TYPE);
    expect(slotsA).toBe(MEMORY_SLOTS_A);

    const jobsBPromises = [];
    for (let i = 0; i < MEMORY_SLOTS_B; i += LOOP_INCREMENT) {
      jobsBPromises.push(submitJob(PORT_B, `job-b-${i}`, JOB_TYPE, SHORT_JOB_DURATION_MS));
    }
    const resultsB = await Promise.all(jobsBPromises);

    resultsB.forEach((status) => {
      expect(status).toBe(HTTP_ACCEPTED);
    });

    const slotsB = getAllocatedSlots(await fetchStats(PORT_B), JOB_TYPE);
    expect(slotsB).toBe(MEMORY_SLOTS_B);
  });
});

describe('Distributed Memory Independence - Redis Allocation Unaware of Memory', () => {
  beforeAll(async () => {
    await setupTwoInstancesWithMemoryLowTpm();
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
    const statsA = await fetchStats(PORT_A);
    const statsB = await fetchStats(PORT_B);

    expect(getAllocatedSlots(statsA, JOB_TYPE)).toBeDefined();
    expect(getAllocatedSlots(statsB, JOB_TYPE)).toBeDefined();

    const slotsA = getAllocatedSlots(statsA, JOB_TYPE) ?? ZERO_FALLBACK;
    const slotsB = getAllocatedSlots(statsB, JOB_TYPE) ?? ZERO_FALLBACK;

    // Memory constrains allocated slots: A=min(50,10)=10, B=min(50,20)=20
    expect(slotsA).toBe(MEMORY_SLOTS_A);
    expect(slotsB).toBe(MEMORY_SLOTS_B);
  });
});
