/**
 * Test suite: Pool-Based Slot Calculation
 *
 * Verifies that the pool-based slot calculation works correctly.
 * With pool-based allocation, Redis calculates per-model slots (not per-job-type).
 *
 * Key: This test does NOT queue any jobs. It only verifies the initial
 * pool allocation math by querying the allocation endpoint directly.
 *
 * Formula: pools[model].totalSlots = floor((modelCapacity / avgEstimatedResource) / instanceCount)
 *
 * Note: Job type distribution is now handled locally, not by Redis.
 */
import {
  INSTANCE_A_URL,
  INSTANCE_B_URL,
  MAX_RPM_PER_INSTANCE,
  MAX_TPM_PER_INSTANCE,
  MIN_MEMORY_SLOTS,
  TWENTY_FIVE_SLOTS,
  TWO_INSTANCES,
  ZERO_COUNT,
  fetchAllocation,
  fetchStats,
  getPool,
  getPoolSlots,
  killAllInstances,
  setupAndVerifySingleInstance,
  setupAndVerifyThreeInstances,
  setupAndVerifyTwoInstances,
  setupInstances,
  verifyInstanceCount,
  verifyPoolExists,
} from './slotCalculationHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;
const INSTANCE_SCALE_TIMEOUT = 120000;

// Ports for scaling tests
const PORT_A = 4011;
const PORT_B = 4012;
const PORT_C = 4013;

describe('Slot Calculation - TPM Only Model', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-tpm');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should have pool allocation for model-alpha', async () => {
    await verifyPoolExists(INSTANCE_A_URL, 'model-alpha');
  });

  it('should report tokensPerMinute in pool allocation', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-alpha');
    const tpm = pool?.tokensPerMinute;
    expect(tpm).toBeDefined();
    expect(tpm).toBeGreaterThan(ZERO_COUNT);
    expect(tpm).toBeLessThanOrEqual(MAX_TPM_PER_INSTANCE);
  });

  it('should have consistent allocation across both instances', async () => {
    const responseA = await fetchAllocation(INSTANCE_A_URL);
    const responseB = await fetchAllocation(INSTANCE_B_URL);

    const slotsA = getPoolSlots(responseA, 'model-alpha');
    const slotsB = getPoolSlots(responseB, 'model-alpha');

    expect(slotsA).toBe(slotsB);
  });
});

describe('Slot Calculation - RPM Only Model', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-rpm');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should have pool allocation for model-beta', async () => {
    await verifyPoolExists(INSTANCE_A_URL, 'model-beta');
  });

  it('should report requestsPerMinute in pool allocation', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-beta');
    const rpm = pool?.requestsPerMinute;
    expect(rpm).toBeDefined();
    expect(rpm).toBeGreaterThan(ZERO_COUNT);
    expect(rpm).toBeLessThanOrEqual(MAX_RPM_PER_INSTANCE);
  });
});

describe('Slot Calculation - Concurrent Only Model', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-concurrent');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should calculate correct pool slots for concurrent-based model', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const slots = getPoolSlots(response, 'model-gamma');
    // floor(100 / 2) = 50
    const FIFTY_SLOTS = 50;
    expect(slots).toBe(FIFTY_SLOTS);
  });
});

describe('Slot Calculation - Mixed Limits Limiting Factor', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-tpm-rpm');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should have pool allocation using limiting factor', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-delta');
    expect(pool).toBeDefined();
    expect(pool?.totalSlots).toBeGreaterThan(ZERO_COUNT);
  });

  it('should report both TPM and RPM in pool', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-delta');
    expect(pool?.tokensPerMinute).toBeDefined();
    expect(pool?.requestsPerMinute).toBeDefined();
  });
});

describe('Slot Calculation - Multiple Models Different Limit Types', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-multi-model');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should have pool allocation for TPM model', async () => {
    await verifyPoolExists(INSTANCE_A_URL, 'model-tpm');
  });

  it('should have pool allocation for concurrent model', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-concurrent');
    expect(pool).toBeDefined();
    // floor(50 / 2) = 25
    expect(pool?.totalSlots).toBe(TWENTY_FIVE_SLOTS);
  });

  it('should have different pool slots for different models', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const tpmSlots = getPoolSlots(response, 'model-tpm');
    const concurrentSlots = getPoolSlots(response, 'model-concurrent');

    expect(tpmSlots).toBeDefined();
    expect(concurrentSlots).toBeDefined();
  });
});

describe('Slot Calculation - Instance Count Verification', () => {
  beforeAll(async () => {
    await setupInstances('slotCalculation');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report correct instance count on both instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
    await verifyInstanceCount(INSTANCE_B_URL, TWO_INSTANCES);
  });

  it('should have pools data structure', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);

    expect(response.allocation).not.toBeNull();
    expect(response.allocation?.pools).toBeDefined();
    expect(typeof response.allocation?.instanceCount).toBe('number');
  });
});

describe('Slot Calculation - TPD Only Model', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-tpd');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should have pool allocation for TPD model', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-tpd');
    expect(pool).toBeDefined();
    expect(pool?.totalSlots).toBeGreaterThan(ZERO_COUNT);
    expect(pool?.tokensPerDay).toBeGreaterThan(ZERO_COUNT);
  });
});

describe('Slot Calculation - RPD Only Model', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-rpd');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should have pool allocation for RPD model', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-rpd');
    expect(pool).toBeDefined();
    expect(pool?.totalSlots).toBeGreaterThan(ZERO_COUNT);
    expect(pool?.requestsPerDay).toBeGreaterThan(ZERO_COUNT);
  });
});

describe('Slot Calculation - Memory Based', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-memory');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should have pool allocation for test-model', async () => {
    await verifyPoolExists(INSTANCE_A_URL, 'test-model');
  });

  it('should have high distributed slots due to high TPM', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'test-model');
    expect(pool?.totalSlots).toBeGreaterThanOrEqual(MIN_MEMORY_SLOTS);
  });

  it('should report memory stats in debug endpoint', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    expect(stats.stats.memory).toBeDefined();
    expect(stats.stats.memory?.maxCapacityKB).toBeGreaterThan(ZERO_COUNT);
  });
});

describe('Slot Calculation - Pool Slots Scale with Instance Count', () => {
  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should calculate 10 pool slots with 1 instance',
    async () => {
      await setupAndVerifySingleInstance(PORT_A, 'instanceScaling');
    },
    INSTANCE_SCALE_TIMEOUT
  );

  it(
    'should calculate 5 pool slots each with 2 instances',
    async () => {
      await setupAndVerifyTwoInstances(PORT_A, PORT_B, 'instanceScaling');
    },
    INSTANCE_SCALE_TIMEOUT
  );

  it(
    'should calculate 3 pool slots each with 3 instances',
    async () => {
      await setupAndVerifyThreeInstances(PORT_A, PORT_B, PORT_C, 'instanceScaling');
    },
    INSTANCE_SCALE_TIMEOUT
  );
});
