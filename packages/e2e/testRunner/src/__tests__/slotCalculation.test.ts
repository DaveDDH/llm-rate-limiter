/**
 * Test suite: Pool-Based Slot Calculation
 *
 * Verifies that the pool-based slot calculation works correctly.
 * Tests do NOT queue any jobs - they only verify pool allocation math.
 *
 * Formula: pools[model].totalSlots = floor((modelCapacity / avgEstimatedResource) / instanceCount)
 */
import {
  CONCURRENT_THREE_INSTANCES_SLOTS,
  DAILY_LIMITS_SLOTS,
  INSTANCE_A_URL,
  INSTANCE_B_URL,
  INSTANCE_C_URL,
  MIXED_LIMITS_SLOTS,
  RPD_PER_INSTANCE,
  RPM_LIMITING_SLOTS,
  RPM_PER_INSTANCE_SPLIT,
  RPM_SLOTS_TWO_INSTANCES,
  THREE_INSTANCES,
  TPD_PER_INSTANCE,
  TPM_AVERAGED_SLOTS,
  TPM_PER_INSTANCE_SPLIT,
  TWO_INSTANCES,
  fetchAllocation,
  getPool,
  getPoolSlots,
  killAllInstances,
  setupInstances,
  setupThreeInstances,
  verifyInstanceCount,
  verifyPoolExists,
} from './slotCalculationHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 1.2: TPM-Only Model - Exact Slot Calculation (Averaged Estimates)
 * avgTokens = (10K + 5K) / 2 = 7,500 → floor((100K / 7,500) / 2) = 6 slots
 */
describe('Slot Calculation - 1.2 TPM-Only Model (Averaged Estimates)', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-tpm');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should have pool allocation for model-alpha', async () => {
    await verifyPoolExists(INSTANCE_A_URL, 'model-alpha');
  });

  it('should calculate correct pool slots using averaged estimates', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const slots = getPoolSlots(response, 'model-alpha');
    expect(slots).toBe(TPM_AVERAGED_SLOTS);
  });

  it('should report tokensPerMinute split per instance', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-alpha');
    expect(pool?.tokensPerMinute).toBe(TPM_PER_INSTANCE_SPLIT);
  });

  it('should have consistent allocation across both instances', async () => {
    const responseA = await fetchAllocation(INSTANCE_A_URL);
    const responseB = await fetchAllocation(INSTANCE_B_URL);

    const slotsA = getPoolSlots(responseA, 'model-alpha');
    const slotsB = getPoolSlots(responseB, 'model-alpha');

    expect(slotsA).toBe(slotsB);
  });
});

/**
 * Test 1.3: RPM-Only Model
 * avgRequests = (1 + 5) / 2 = 3 → floor((500 / 3) / 2) = 83 slots
 */
describe('Slot Calculation - 1.3 RPM-Only Model', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-rpm');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should have pool allocation for model-beta', async () => {
    await verifyPoolExists(INSTANCE_A_URL, 'model-beta');
  });

  it('should calculate correct pool slots for RPM-based model', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const slots = getPoolSlots(response, 'model-beta');
    expect(slots).toBe(RPM_SLOTS_TWO_INSTANCES);
  });

  it('should report requestsPerMinute split per instance', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-beta');
    expect(pool?.requestsPerMinute).toBe(RPM_PER_INSTANCE_SPLIT);
  });
});

/** Test 1.4: Concurrent-Only Model → floor(100 / 3) = 33 slots */
describe('Slot Calculation - 1.4 Concurrent-Only Model', () => {
  beforeAll(async () => {
    await setupThreeInstances('slotCalc-concurrent');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 3 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, THREE_INSTANCES);
  });

  it('should calculate correct pool slots for concurrent-based model', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const slots = getPoolSlots(response, 'model-gamma');
    expect(slots).toBe(CONCURRENT_THREE_INSTANCES_SLOTS);
  });

  it('should have consistent allocation across all three instances', async () => {
    const responseA = await fetchAllocation(INSTANCE_A_URL);
    const responseB = await fetchAllocation(INSTANCE_B_URL);
    const responseC = await fetchAllocation(INSTANCE_C_URL);

    const slotsA = getPoolSlots(responseA, 'model-gamma');
    const slotsB = getPoolSlots(responseB, 'model-gamma');
    const slotsC = getPoolSlots(responseC, 'model-gamma');

    expect(slotsA).toBe(slotsB);
    expect(slotsB).toBe(slotsC);
  });
});

/**
 * Test 1.5: Mixed Limits - Limiting Factor Selection
 * TPM→5, RPM→25, Concurrent→100 → min(5,25,100) = 5 (TPM limiting)
 */
describe('Slot Calculation - 1.5 Mixed Limits (Limiting Factor)', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-tpm-rpm');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should have pool allocation using limiting factor', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-delta');
    expect(pool).toBeDefined();
    expect(pool?.totalSlots).toBe(MIXED_LIMITS_SLOTS);
  });

  it('should report both TPM and RPM in pool', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-delta');
    expect(pool?.tokensPerMinute).toBeDefined();
    expect(pool?.requestsPerMinute).toBeDefined();
  });
});

/**
 * Test 1.6: Daily Limits - TPD/RPD Calculation
 * TPD=1M, RPD=10K, tokens=10K → slots=50, tpd=500K, rpd=5K per instance
 */
describe('Slot Calculation - 1.6 Daily Limits (TPD/RPD)', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-tpd-rpd');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should have pool allocation for model-epsilon', async () => {
    await verifyPoolExists(INSTANCE_A_URL, 'model-epsilon');
  });

  it('should calculate correct pool slots for daily limits', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const slots = getPoolSlots(response, 'model-epsilon');
    expect(slots).toBe(DAILY_LIMITS_SLOTS);
  });

  it('should report tokensPerDay split per instance', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-epsilon');
    expect(pool?.tokensPerDay).toBe(TPD_PER_INSTANCE);
  });

  it('should report requestsPerDay split per instance', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-epsilon');
    expect(pool?.requestsPerDay).toBe(RPD_PER_INSTANCE);
  });
});

/**
 * Test 1.10: RPM as Limiting Factor Over TPM
 * TPM→5 slots, RPM→3 slots → min(5,3) = 3 (RPM limiting)
 */
describe('Slot Calculation - 1.10 RPM as Limiting Factor Over TPM', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-rpm-limiting');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should calculate RPM as limiting factor, not TPM', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const slots = getPoolSlots(response, 'model-alpha');
    expect(slots).toBe(RPM_LIMITING_SLOTS);
  });
});
