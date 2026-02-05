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
  DAILY_LIMITS_SLOTS,
  INSTANCE_A_URL,
  INSTANCE_B_URL,
  MIXED_LIMITS_SLOTS,
  RPD_PER_INSTANCE,
  RPM_LIMITING_SLOTS,
  RPM_PER_INSTANCE_SPLIT,
  RPM_SLOTS_TWO_INSTANCES,
  TPD_PER_INSTANCE,
  TPM_AVERAGED_SLOTS,
  TPM_PER_INSTANCE_SPLIT,
  TWO_INSTANCES,
  ZERO_COUNT,
  fetchAllocation,
  getPool,
  getPoolSlots,
  killAllInstances,
  setupAndVerifyFourInstances,
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
const PORT_D = 4014;

/**
 * Test 1.1: Single Instance Gets Full Capacity
 *
 * Config: model-alpha: TPM = 100,000, jobType: estimatedTokens = 10,000, instanceCount = 1
 * Expected: pools['scale-model'].totalSlots = 10
 */
describe('Slot Calculation - 1.1 Single Instance Gets Full Capacity', () => {
  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'single instance should get full capacity of 10 slots',
    async () => {
      await setupAndVerifySingleInstance(PORT_A, 'instanceScaling');
    },
    INSTANCE_SCALE_TIMEOUT
  );
});

/**
 * Test 1.2: TPM-Only Model - Exact Slot Calculation (Averaged Estimates)
 *
 * Config: model-alpha: TPM = 100,000
 *         jobTypeA: estimatedTokens = 10,000, ratio = 0.6
 *         jobTypeB: estimatedTokens = 5,000, ratio = 0.4
 *         instanceCount = 2
 *
 * avgTokens = (10,000 + 5,000) / 2 = 7,500
 * Expected: floor((100K / 7,500) / 2) = floor(6.67) = 6 slots
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
 * Test 1.3: RPM-Only Model - Exact Slot Calculation
 *
 * Config: model-beta: RPM = 500
 *         jobTypeA: estimatedRequests = 1, ratio = 0.6
 *         jobTypeB: estimatedRequests = 5, ratio = 0.4
 *         instanceCount = 2
 *
 * avgRequests = (1 + 5) / 2 = 3
 * Expected: floor((500 / 3) / 2) = floor(83.33) = 83 slots
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

/**
 * Test 1.4: Concurrent-Only Model - Exact Slot Calculation
 *
 * Config: model-gamma: maxConcurrentRequests = 100
 *         instanceCount = 2
 *
 * Expected: floor(100 / 2) = 50 slots
 */
describe('Slot Calculation - 1.4 Concurrent-Only Model', () => {
  const CONCURRENT_SLOTS_TWO_INSTANCES = 50;

  beforeAll(async () => {
    await setupInstances('slotCalc-concurrent');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should calculate correct pool slots for concurrent-based model', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const slots = getPoolSlots(response, 'model-gamma');
    expect(slots).toBe(CONCURRENT_SLOTS_TWO_INSTANCES);
  });
});

/**
 * Test 1.5: Mixed Limits - Limiting Factor Selection
 *
 * Config: model-delta: TPM = 100,000, RPM = 50, maxConcurrentRequests = 200
 *         jobTypeA: estimatedTokens = 10,000, estimatedRequests = 1
 *         instanceCount = 2
 *
 * TPM-based slots: floor((100K / 10K) / 2) = 5
 * RPM-based slots: floor((50 / 1) / 2) = 25
 * Concurrent-based slots: floor(200 / 2) = 100
 *
 * Expected: min(5, 25, 100) = 5 (TPM is limiting)
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
 *
 * Config: model-epsilon: TPD = 1,000,000, RPD = 10,000
 *         jobTypeA: estimatedTokens = 10,000, estimatedRequests = 1
 *         instanceCount = 2
 *
 * Expected: totalSlots = 50 (TPD limiting: floor((1M / 10K) / 2))
 *           tokensPerDay = 500,000
 *           requestsPerDay = 5,000
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
 * Test 1.7: Two Instances Split Capacity Exactly
 *
 * Config: model-alpha: TPM = 100,000
 *         jobTypeA: estimatedTokens = 10,000
 *         instanceCount = 2
 *
 * Expected: pools['scale-model'].totalSlots = 5
 *           tokensPerMinute = 50,000
 */
describe('Slot Calculation - 1.7 Two Instances Split Capacity', () => {
  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should calculate 5 pool slots each with 2 instances',
    async () => {
      await setupAndVerifyTwoInstances(PORT_A, PORT_B, 'instanceScaling');
    },
    INSTANCE_SCALE_TIMEOUT
  );
});

/**
 * Test 1.8: Three Instances with Remainder
 *
 * Config: model-alpha: TPM = 100,000
 *         jobTypeA: estimatedTokens = 10,000
 *         instanceCount = 3
 *
 * Expected: pools['scale-model'].totalSlots = 3 (floor(10/3))
 *           tokensPerMinute = 33,333
 */
describe('Slot Calculation - 1.8 Three Instances with Remainder', () => {
  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should calculate 3 pool slots each with 3 instances',
    async () => {
      await setupAndVerifyThreeInstances(PORT_A, PORT_B, PORT_C, 'instanceScaling');
    },
    INSTANCE_SCALE_TIMEOUT
  );
});

/**
 * Test 1.9: Zero Slots After Floor Division
 *
 * Config: model-alpha: TPM = 15,000
 *         jobType: estimatedTokens = 10,000
 *         instanceCount = 4
 *
 * Expected: floor((15K / 10K) / 4) = floor(0.375) = 0 slots
 */
describe('Slot Calculation - 1.9 Zero Slots After Floor Division', () => {
  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should calculate 0 pool slots when capacity is too low for instance count',
    async () => {
      await setupAndVerifyFourInstances(
        [PORT_A, PORT_B, PORT_C, PORT_D],
        'slotCalc-zero-slots',
        'model-alpha',
        ZERO_COUNT
      );
    },
    INSTANCE_SCALE_TIMEOUT
  );
});

/**
 * Test 1.10: RPM as Limiting Factor Over TPM
 *
 * Config: model-alpha: TPM = 100,000, RPM = 6
 *         jobTypeA: estimatedTokens = 10,000, estimatedRequests = 1
 *         instanceCount = 2
 *
 * TPM-based slots: floor((100K / 10K) / 2) = 5
 * RPM-based slots: floor((6 / 1) / 2) = 3
 *
 * Expected: min(5, 3) = 3 (RPM is limiting)
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
