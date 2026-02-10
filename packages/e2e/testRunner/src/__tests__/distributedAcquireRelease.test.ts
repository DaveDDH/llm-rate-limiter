/**
 * Test suite: Distributed Acquire/Release (Test 39)
 *
 * Verifies Redis coordination for acquire/release operations.
 *
 * Uses two config presets:
 * - highest-distributedAcquire: TPM=20K, 2 instances → 1 slot each
 * - highest-acquireAtomicity: concurrent=100, 1 instance
 *
 * Key behaviors to verify:
 * 1. Acquire still goes to Redis for global coordination
 * 2. Acquire/release atomicity under concurrency
 */
import { sleep } from '../testUtils.js';
import {
  CONCURRENT_100,
  CONFIG_ACQUIRE_ATOMICITY,
  CONFIG_DISTRIBUTED_ACQUIRE,
  HTTP_ACCEPTED,
  JOB_TYPE,
  MEDIUM_JOB_DURATION_MS,
  MODEL_ID,
  ONE_SLOT,
  PORT_A,
  PORT_B,
  PORT_SINGLE,
  SHORT_JOB_DURATION_MS,
  TWO_INSTANCES,
  fetchAllocation,
  getActiveJobCount,
  getInFlightCount,
  getModelPoolSlots,
  killAllInstances,
  setupSingleInstance,
  setupTwoInstances,
  submitJob,
  waitForActiveJobCount,
} from './distributedAcquireReleaseHelpers.js';

const AFTER_ALL_TIMEOUT_MS = 30000;
const BEFORE_ALL_TIMEOUT_MS = 60000;

const ZERO_ACTIVE = 0;
const TWO_ACTIVE = 2;
const CONCURRENT_REQUEST_COUNT = 200;
const ACTIVE_JOB_SETTLE_MS = 500;

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Acquire Release - Acquire Still Goes to Redis', () => {
  beforeAll(async () => {
    await setupTwoInstances(CONFIG_DISTRIBUTED_ACQUIRE);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('39.1: should coordinate acquires across instances via Redis', async () => {
    const allocA = await fetchAllocation(PORT_A);
    const allocB = await fetchAllocation(PORT_B);

    expect(allocA.allocation?.instanceCount).toBe(TWO_INSTANCES);
    expect(allocB.allocation?.instanceCount).toBe(TWO_INSTANCES);

    const slotsA = getModelPoolSlots(allocA, MODEL_ID);
    const slotsB = getModelPoolSlots(allocB, MODEL_ID);

    expect(slotsA).toBe(ONE_SLOT);
    expect(slotsB).toBe(ONE_SLOT);

    const statusA = await submitJob(PORT_A, 'job-a-1', JOB_TYPE, MEDIUM_JOB_DURATION_MS);
    const statusB = await submitJob(PORT_B, 'job-b-1', JOB_TYPE, MEDIUM_JOB_DURATION_MS);

    expect(statusA).toBe(HTTP_ACCEPTED);
    expect(statusB).toBe(HTTP_ACCEPTED);

    await waitForActiveJobCount(PORT_A, ONE_SLOT);
    await waitForActiveJobCount(PORT_B, ONE_SLOT);

    const activeA = await getActiveJobCount(PORT_A);
    const activeB = await getActiveJobCount(PORT_B);

    expect(activeA + activeB).toBe(TWO_ACTIVE);

    const statusC = await submitJob(PORT_A, 'job-a-2', JOB_TYPE, SHORT_JOB_DURATION_MS);
    expect(statusC).toBe(HTTP_ACCEPTED);
  });
});

describe('Distributed Acquire Release - Atomicity Under Concurrency', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_ACQUIRE_ATOMICITY);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('39.2: should handle concurrent acquire requests atomically', async () => {
    const allocSingle = await fetchAllocation(PORT_SINGLE);
    expect(allocSingle.allocation?.pools[MODEL_ID]?.totalSlots).toBeGreaterThanOrEqual(CONCURRENT_100);

    const concurrentJobPromises = Array.from(
      { length: CONCURRENT_REQUEST_COUNT },
      async (_, i) => await submitJob(PORT_SINGLE, `concurrent-${i}`, JOB_TYPE, MEDIUM_JOB_DURATION_MS)
    );

    const results = await Promise.all(concurrentJobPromises);

    const { length: acceptedCount } = results.filter((status) => status === HTTP_ACCEPTED);
    expect(acceptedCount).toBe(CONCURRENT_REQUEST_COUNT);

    await sleep(ACTIVE_JOB_SETTLE_MS);

    const inFlight = await getInFlightCount(PORT_SINGLE, JOB_TYPE);
    expect(inFlight).toBeLessThanOrEqual(CONCURRENT_100);

    await waitForActiveJobCount(PORT_SINGLE, ZERO_ACTIVE, BEFORE_ALL_TIMEOUT_MS);

    const finalActive = await getActiveJobCount(PORT_SINGLE);
    expect(finalActive).toBe(ZERO_ACTIVE);
  });
});
