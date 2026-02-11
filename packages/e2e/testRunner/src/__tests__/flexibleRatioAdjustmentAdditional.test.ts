/**
 * Test suite: Flexible Ratio Adjustment Additional (Tests 17.1-17.4)
 *
 * Verifies the donor/receiver ratio adjustment mechanism:
 * - Receivers (load > 70%) get more capacity
 * - Donors (load < 30%) give capacity
 * - Ratios always sum to ~1.0
 * - maxAdjustment caps per-cycle changes
 *
 * Config: flexibleRatio (single model flex-model, 100K TPM)
 * Single instance: totalSlots = floor(100K / 10K / 1) = 10
 * Per-type: floor(10 * 0.33) = 3 slots
 */
import { sleep } from '../testUtils.js';
import {
  ADJUSTMENT_WAIT_MS,
  EXPECTED_RATIO_SUM,
  FLEX_CONFIG,
  INITIAL_RATIO,
  INSTANCE_URL,
  MAX_ADJUSTMENT,
  MAX_CYCLES_IN_WAIT,
  MIN_RATIO,
  RATIO_SUM_TOLERANCE,
  RATIO_TOLERANCE,
  fetchStats,
  getCurrentRatio,
  getInitialRatio,
  getJobTypeStats,
  killAllInstances,
  setupSingleInstance,
  submitLongRunningJobs,
  sumCurrentRatios,
  waitForNoActiveJobs,
} from './flexibleRatioAdjustmentAdditionalHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;
const WAIT_FOR_JOBS_TIMEOUT_MS = 60000;
const JOB_START_DELAY_MS = 500;

// Load targets: >70% of 3 slots means >= 3 inFlight (100% load)
// Load < 30% of 3 slots means 0 inFlight (0% load)
const HIGH_LOAD_JOB_COUNT = 3;

// Precision for toBeCloseTo (1 decimal place)
const CLOSE_TO_PRECISION = 1;

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Submit high-load jobs for a job type (fill all slots)
 */
const submitHighLoadJobs = async (jobType: string, prefix: string): Promise<void> => {
  await submitLongRunningJobs(INSTANCE_URL, jobType, HIGH_LOAD_JOB_COUNT, prefix);
};

describe('17.1 High Load Receiver Gets More Slots', () => {
  beforeAll(async () => {
    await setupSingleInstance(FLEX_CONFIG);
    // flexJobA: high load (fill all 3 slots = 100% load > 70%)
    await submitHighLoadJobs('flexJobA', 'high-a');
    // flexJobB and flexJobC: low load (0 inFlight = 0% < 30%)
    await sleep(JOB_START_DELAY_MS);
    // Wait for periodic adjustment cycle (default 5s interval)
    await sleep(ADJUSTMENT_WAIT_MS);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should increase flexJobA ratio (receiver)', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobA');
    const initial = getInitialRatio(jts, 'flexJobA');
    expect(current).toBeGreaterThan(initial);
  });

  it('should decrease flexJobB ratio (donor)', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobB');
    const initial = getInitialRatio(jts, 'flexJobB');
    expect(current).toBeLessThan(initial);
  });

  it('should clean up jobs', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, WAIT_FOR_JOBS_TIMEOUT_MS);
  });
});

describe('17.4 Ratios Always Sum to ~1.0', () => {
  beforeAll(async () => {
    await setupSingleInstance(FLEX_CONFIG);
    // Create load imbalance to trigger adjustment
    await submitHighLoadJobs('flexJobA', 'sum-a');
    await sleep(JOB_START_DELAY_MS);
    await sleep(ADJUSTMENT_WAIT_MS);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should have ratios summing to approximately 1.0', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const sum = sumCurrentRatios(jts);
    expect(sum).toBeCloseTo(EXPECTED_RATIO_SUM, CLOSE_TO_PRECISION);
    expect(Math.abs(sum - EXPECTED_RATIO_SUM)).toBeLessThan(RATIO_SUM_TOLERANCE);
  });

  it('should clean up jobs', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, WAIT_FOR_JOBS_TIMEOUT_MS);
  });
});

describe('17.7 Middle Load Types Neither Donate Nor Receive', () => {
  beforeAll(async () => {
    await setupSingleInstance(FLEX_CONFIG);
    // Load flexJobA to ~50% of 3 slots: submit 1-2 jobs
    // 1 inFlight out of 3 = 33%, which is between 30% and 70%
    // Actually, 2 out of 3 = 67%, still below 70%
    // Use 2 inFlight for ~67% which is between 30% and 70%
    const middleLoadJobCount = 2;
    await submitLongRunningJobs(INSTANCE_URL, 'flexJobA', middleLoadJobCount, 'mid-a');
    // Keep flexJobB at similar middle load
    await submitLongRunningJobs(INSTANCE_URL, 'flexJobB', middleLoadJobCount, 'mid-b');
    // Keep flexJobC at similar middle load
    await submitLongRunningJobs(INSTANCE_URL, 'flexJobC', middleLoadJobCount, 'mid-c');
    await sleep(JOB_START_DELAY_MS);
    await sleep(ADJUSTMENT_WAIT_MS);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should keep flexJobA ratio unchanged at middle load', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const current = getCurrentRatio(jts, 'flexJobA');
    expect(Math.abs(current - INITIAL_RATIO)).toBeLessThan(RATIO_TOLERANCE);
  });

  it('should clean up jobs', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, WAIT_FOR_JOBS_TIMEOUT_MS);
  });
});

describe('17.2 Adjustment Respects maxAdjustment', () => {
  beforeAll(async () => {
    await setupSingleInstance(FLEX_CONFIG);
    // Extreme imbalance: flexJobA at 100%, B and C at 0%
    await submitHighLoadJobs('flexJobA', 'max-a');
    await sleep(JOB_START_DELAY_MS);
    await sleep(ADJUSTMENT_WAIT_MS);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should not change ratio by more than maxAdjustment per cycle', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const currentA = getCurrentRatio(jts, 'flexJobA');
    const initialA = getInitialRatio(jts, 'flexJobA');
    const change = Math.abs(currentA - initialA);
    const maxTotalChange = MAX_ADJUSTMENT * MAX_CYCLES_IN_WAIT;
    expect(change).toBeLessThanOrEqual(maxTotalChange + RATIO_TOLERANCE);
  });

  it('should clean up jobs', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, WAIT_FOR_JOBS_TIMEOUT_MS);
  });
});

describe('17.3 minRatio Prevents Complete Starvation', () => {
  beforeAll(async () => {
    await setupSingleInstance(FLEX_CONFIG);
    // Create extreme imbalance: flexJobA high load
    await submitHighLoadJobs('flexJobA', 'min-a');
    await sleep(JOB_START_DELAY_MS);
    // Wait for multiple adjustment cycles
    const multipleAdjustmentCyclesMs = 15000;
    await sleep(multipleAdjustmentCyclesMs);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should not let any ratio fall below minRatio', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const jts = getJobTypeStats(stats);
    const ratioB = getCurrentRatio(jts, 'flexJobB');
    const ratioC = getCurrentRatio(jts, 'flexJobC');
    expect(ratioB).toBeGreaterThanOrEqual(MIN_RATIO);
    expect(ratioC).toBeGreaterThanOrEqual(MIN_RATIO);
  });

  it('should clean up jobs', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, WAIT_FOR_JOBS_TIMEOUT_MS);
  });
});
