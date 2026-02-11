/**
 * Test suite: Flexible Ratio Adjustment Additional 2 (Tests 17.5-17.9)
 *
 * Verifies donor/receiver classification rules and edge cases:
 * - Only types with load > 70% are receivers
 * - Only types with load < 30% are donors
 * - When all types are high load: no adjustment (no donors)
 * - When all types are low load: no adjustment (no receivers)
 *
 * Config: flexibleRatio (single model flex-model, 100K TPM)
 * Single instance: totalSlots = floor(100K / 10K / 1) = 10
 * Per-type: floor(10 * 0.33) = 3 slots
 */
import { sleep } from '../testUtils.js';
import {
  ADJUSTMENT_WAIT_MS,
  FLEX_CONFIG,
  INITIAL_RATIO,
  INSTANCE_URL,
  RATIO_TOLERANCE,
  fetchStats,
  getCurrentRatio,
  getJobTypeStats,
  killAllInstances,
  setupSingleInstance,
  submitLongRunningJobs,
  waitForNoActiveJobs,
} from './flexibleRatioAdjustmentAdditionalHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;
const WAIT_FOR_JOBS_TIMEOUT_MS = 60000;
const JOB_START_DELAY_MS = 500;

// With 3 allocated slots per type:
// 3 inFlight / 3 slots = 100% load (> 70%, receiver)
// 2 inFlight / 3 slots = 67% load (middle zone, neither)
// 1 inFlight / 3 slots = 33% load (middle zone, neither)
// 0 inFlight / 3 slots = 0% load (< 30%, donor)
const FULL_LOAD_JOB_COUNT = 3;
const MIDDLE_HIGH_JOB_COUNT = 2;

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('17.5 Only High Load Types Are Receivers', () => {
  beforeAll(async () => {
    await setupSingleInstance(FLEX_CONFIG);
    // flexJobA at 67% (2/3) - NOT a receiver (< 70%)
    await submitLongRunningJobs(INSTANCE_URL, 'flexJobA', MIDDLE_HIGH_JOB_COUNT, 'recv-a');
    // flexJobB at 100% (3/3) - IS a receiver (> 70%)
    await submitLongRunningJobs(INSTANCE_URL, 'flexJobB', FULL_LOAD_JOB_COUNT, 'recv-b');
    // flexJobC at 0% - IS a donor (< 30%)
    await sleep(JOB_START_DELAY_MS);
    await sleep(ADJUSTMENT_WAIT_MS);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should NOT increase flexJobA ratio (60% load is not receiver)', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobA');
    // 67% is not a receiver so ratio should not increase
    expect(current).toBeLessThanOrEqual(INITIAL_RATIO + RATIO_TOLERANCE);
  });

  it('should increase flexJobB ratio (100% load is receiver)', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobB');
    expect(current).toBeGreaterThan(INITIAL_RATIO);
  });

  it('should clean up jobs', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, WAIT_FOR_JOBS_TIMEOUT_MS);
  });
});

describe('17.6 Only Low Load Types Are Donors', () => {
  beforeAll(async () => {
    await setupSingleInstance(FLEX_CONFIG);
    // flexJobA at 0% (0/3) - IS a donor (< 30%)
    // flexJobB at 67% (2/3) - NOT a donor (> 30%)
    await submitLongRunningJobs(INSTANCE_URL, 'flexJobB', MIDDLE_HIGH_JOB_COUNT, 'donor-b');
    // flexJobC at 100% (3/3) - IS a receiver (> 70%)
    await submitLongRunningJobs(INSTANCE_URL, 'flexJobC', FULL_LOAD_JOB_COUNT, 'donor-c');
    await sleep(JOB_START_DELAY_MS);
    await sleep(ADJUSTMENT_WAIT_MS);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should decrease flexJobA ratio (0% load is donor)', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobA');
    expect(current).toBeLessThan(INITIAL_RATIO);
  });

  it('should NOT decrease flexJobB ratio (67% load is not donor)', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobB');
    // 67% is between thresholds, should not donate
    expect(current).toBeGreaterThanOrEqual(INITIAL_RATIO - RATIO_TOLERANCE);
  });

  it('should clean up jobs', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, WAIT_FOR_JOBS_TIMEOUT_MS);
  });
});

describe('17.8 All Job Types High Load - No Adjustment', () => {
  beforeAll(async () => {
    await setupSingleInstance(FLEX_CONFIG);
    // All three types at 100% load (all receivers, no donors)
    await submitLongRunningJobs(INSTANCE_URL, 'flexJobA', FULL_LOAD_JOB_COUNT, 'allhigh-a');
    await submitLongRunningJobs(INSTANCE_URL, 'flexJobB', FULL_LOAD_JOB_COUNT, 'allhigh-b');
    await submitLongRunningJobs(INSTANCE_URL, 'flexJobC', FULL_LOAD_JOB_COUNT, 'allhigh-c');
    await sleep(JOB_START_DELAY_MS);
    await sleep(ADJUSTMENT_WAIT_MS);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should keep flexJobA ratio unchanged', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobA');
    expect(Math.abs(current - INITIAL_RATIO)).toBeLessThan(RATIO_TOLERANCE);
  });

  it('should keep flexJobB ratio unchanged', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobB');
    expect(Math.abs(current - INITIAL_RATIO)).toBeLessThan(RATIO_TOLERANCE);
  });

  it('should keep flexJobC ratio unchanged', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobC');
    expect(Math.abs(current - INITIAL_RATIO)).toBeLessThan(RATIO_TOLERANCE);
  });

  it('should clean up jobs', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, WAIT_FOR_JOBS_TIMEOUT_MS);
  });
});

describe('17.9 All Job Types Low Load - No Adjustment', () => {
  beforeAll(async () => {
    await setupSingleInstance(FLEX_CONFIG);
    // All three types at 0% load (all donors, no receivers)
    // Do NOT submit any jobs
    await sleep(ADJUSTMENT_WAIT_MS);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should keep flexJobA ratio unchanged', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobA');
    expect(Math.abs(current - INITIAL_RATIO)).toBeLessThan(RATIO_TOLERANCE);
  });

  it('should keep flexJobB ratio unchanged', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobB');
    expect(Math.abs(current - INITIAL_RATIO)).toBeLessThan(RATIO_TOLERANCE);
  });

  it('should keep flexJobC ratio unchanged', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobC');
    expect(Math.abs(current - INITIAL_RATIO)).toBeLessThan(RATIO_TOLERANCE);
  });
});
