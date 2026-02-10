/**
 * Test suite: Distributed Ratio Management (Test 37)
 *
 * Verifies that ratio changes are LOCAL only and NOT shared via Redis.
 * Each instance maintains its own local ratio management independent of other instances.
 *
 * Uses the flexibleRatio config preset:
 * - flex-model: 100K TPM
 * - flexJobA, flexJobB, flexJobC: 10K tokens each, ratio=0.33 each
 * - 2 instances: 5 slots per instance
 *
 * Key behaviors to verify:
 * 1. Ratio changes on instance A do NOT affect instance B
 * 2. Each instance has independent ratios
 * 3. Pool allocation stays same despite different ratios
 * 4. Local ratio changes don't affect Redis
 */
import { fetchAllocation } from '../instanceLifecycle.js';
import {
  FIVE_SLOTS,
  HTTP_ACCEPTED,
  INITIAL_RATIO,
  JOB_TYPE_A,
  JOB_TYPE_B,
  MODEL_ID,
  PORT_A,
  PORT_B,
  RATIO_TOLERANCE,
  SHORT_JOB_DURATION_MS,
  TWO_INSTANCES,
  ZERO_SLOTS,
  fetchStats,
  getJobTypeRatio,
  getModelPoolSlots,
  killAllInstances,
  setupTwoInstances,
  submitJob,
  waitForJobSettle,
} from './distributedRatioManagementHelpers.js';

const AFTER_ALL_TIMEOUT_MS = 30000;
const BEFORE_ALL_TIMEOUT_MS = 60000;

const HEAVY_LOAD_COUNT = 20;
const LIGHT_LOAD_COUNT = 3;

// Reduced count for pool-slot test: total usage must stay under 100K TPM
// (each job consumes 10K tokens in the time-window counter with no refund)
const POOL_TEST_LOAD = 5;

// Job payload constants
const SHORT_JOB = { durationMs: SHORT_JOB_DURATION_MS };
const ZERO_TOKENS = 0;
const ZERO_TOKEN_JOB = {
  durationMs: SHORT_JOB_DURATION_MS,
  actualInputTokens: ZERO_TOKENS,
  actualOutputTokens: ZERO_TOKENS,
};

// Precision for toBeCloseTo comparison
const CLOSE_TO_PRECISION = 2;

// Loop increment
const LOOP_INCREMENT = 1;

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Ratio Management - Ratio Changes Not Shared Via Redis', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('37.1: should keep ratios independent between instances after heavy load on A', async () => {
    const allocA = await fetchAllocation(PORT_A);
    const allocB = await fetchAllocation(PORT_B);

    expect(allocA.allocation?.instanceCount).toBe(TWO_INSTANCES);
    expect(allocB.allocation?.instanceCount).toBe(TWO_INSTANCES);

    const statsAInitial = await fetchStats(PORT_A);
    const statsBInitial = await fetchStats(PORT_B);
    const ratioAInitial = getJobTypeRatio(statsAInitial, MODEL_ID, JOB_TYPE_A);
    const ratioBInitial = getJobTypeRatio(statsBInitial, MODEL_ID, JOB_TYPE_A);

    expect(ratioAInitial).toBeCloseTo(INITIAL_RATIO, CLOSE_TO_PRECISION);
    expect(ratioBInitial).toBeCloseTo(INITIAL_RATIO, CLOSE_TO_PRECISION);

    const heavyLoadPromises = [];
    for (let i = 0; i < HEAVY_LOAD_COUNT; i += LOOP_INCREMENT) {
      heavyLoadPromises.push(submitJob(PORT_A, `heavy-a-${i}`, JOB_TYPE_A, SHORT_JOB));
    }
    const heavyResults = await Promise.all(heavyLoadPromises);

    heavyResults.forEach((status) => {
      expect(status).toBe(HTTP_ACCEPTED);
    });

    await waitForJobSettle();

    const statsAAfter = await fetchStats(PORT_A);
    const statsBAfter = await fetchStats(PORT_B);
    const ratioAAfter = getJobTypeRatio(statsAAfter, MODEL_ID, JOB_TYPE_A);
    const ratioBAfter = getJobTypeRatio(statsBAfter, MODEL_ID, JOB_TYPE_A);

    expect(ratioAAfter).toBeGreaterThan(INITIAL_RATIO + RATIO_TOLERANCE);
    expect(ratioBAfter).toBeCloseTo(INITIAL_RATIO, CLOSE_TO_PRECISION);
  });
});

describe('Distributed Ratio Management - Each Instance Has Independent Ratios', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('37.2: should maintain different ratios on each instance based on local load', async () => {
    const jobsAPromises = [];
    for (let i = 0; i < HEAVY_LOAD_COUNT; i += LOOP_INCREMENT) {
      jobsAPromises.push(submitJob(PORT_A, `load-a-${i}`, JOB_TYPE_A, SHORT_JOB));
    }
    await Promise.all(jobsAPromises);

    const jobsBPromises = [];
    for (let i = 0; i < HEAVY_LOAD_COUNT; i += LOOP_INCREMENT) {
      jobsBPromises.push(submitJob(PORT_B, `load-b-${i}`, JOB_TYPE_B, SHORT_JOB));
    }
    await Promise.all(jobsBPromises);

    await waitForJobSettle();

    const statsA = await fetchStats(PORT_A);
    const statsB = await fetchStats(PORT_B);

    const ratioAForJobA = getJobTypeRatio(statsA, MODEL_ID, JOB_TYPE_A);
    const ratioBForJobB = getJobTypeRatio(statsB, MODEL_ID, JOB_TYPE_B);

    expect(ratioAForJobA).toBeGreaterThan(INITIAL_RATIO + RATIO_TOLERANCE);
    expect(ratioBForJobB).toBeGreaterThan(INITIAL_RATIO + RATIO_TOLERANCE);

    const ratioAForJobB = getJobTypeRatio(statsA, MODEL_ID, JOB_TYPE_B);
    const ratioBForJobA = getJobTypeRatio(statsB, MODEL_ID, JOB_TYPE_A);

    expect(ratioAForJobB).toBeLessThan(INITIAL_RATIO);
    expect(ratioBForJobA).toBeLessThan(INITIAL_RATIO);
  });
});

describe('Distributed Ratio Management - Pool Allocation Same Despite Different Ratios', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('37.3: should have same pool allocation despite different local ratios', async () => {
    const heavyJobsA = [];
    for (let i = 0; i < POOL_TEST_LOAD; i += LOOP_INCREMENT) {
      heavyJobsA.push(submitJob(PORT_A, `heavy-${i}`, JOB_TYPE_A, SHORT_JOB));
    }
    await Promise.all(heavyJobsA);

    const lightJobsB = [];
    for (let i = 0; i < LIGHT_LOAD_COUNT; i += LOOP_INCREMENT) {
      lightJobsB.push(submitJob(PORT_B, `light-${i}`, JOB_TYPE_B, SHORT_JOB));
    }
    await Promise.all(lightJobsB);

    await waitForJobSettle();

    const allocA = await fetchAllocation(PORT_A);
    const allocB = await fetchAllocation(PORT_B);

    const slotsA = getModelPoolSlots(allocA, MODEL_ID);
    const slotsB = getModelPoolSlots(allocB, MODEL_ID);

    // Both instances should have equal pool allocation despite different local ratios
    // (remaining capacity is global, so both decrease equally)
    expect(slotsA).toBeGreaterThan(ZERO_SLOTS);
    expect(slotsB).toBeGreaterThan(ZERO_SLOTS);
    expect(slotsA).toBe(slotsB);
  });
});

describe('Distributed Ratio Management - Local Ratio Changes Dont Affect Redis', () => {
  beforeAll(async () => {
    await setupTwoInstances();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('37.4: should not propagate local ratio adjustments to Redis pool allocation', async () => {
    const allocABefore = await fetchAllocation(PORT_A);
    const allocBBefore = await fetchAllocation(PORT_B);
    const slotsABefore = getModelPoolSlots(allocABefore, MODEL_ID);
    const slotsBBefore = getModelPoolSlots(allocBBefore, MODEL_ID);

    expect(slotsABefore).toBe(FIVE_SLOTS);
    expect(slotsBBefore).toBe(FIVE_SLOTS);

    const triggerJobs = [];
    for (let i = 0; i < HEAVY_LOAD_COUNT; i += LOOP_INCREMENT) {
      triggerJobs.push(submitJob(PORT_A, `trigger-${i}`, JOB_TYPE_A, ZERO_TOKEN_JOB));
    }
    await Promise.all(triggerJobs);

    await waitForJobSettle();

    const statsA = await fetchStats(PORT_A);
    const ratioA = getJobTypeRatio(statsA, MODEL_ID, JOB_TYPE_A);
    expect(ratioA).toBeGreaterThan(INITIAL_RATIO + RATIO_TOLERANCE);

    const allocAAfter = await fetchAllocation(PORT_A);
    const allocBAfter = await fetchAllocation(PORT_B);
    const slotsAAfter = getModelPoolSlots(allocAAfter, MODEL_ID);
    const slotsBAfter = getModelPoolSlots(allocBAfter, MODEL_ID);

    // Both instances should have equal pool allocation after heavy load
    // (capacity consumption affects both equally; ratio changes are local only)
    expect(slotsAAfter).toBeGreaterThan(ZERO_SLOTS);
    expect(slotsBAfter).toBeGreaterThan(ZERO_SLOTS);
    expect(slotsAAfter).toBe(slotsBAfter);
  });
});
