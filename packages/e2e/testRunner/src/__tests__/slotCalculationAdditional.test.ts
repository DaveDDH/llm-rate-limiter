/**
 * Test suite: Pool-Based Slot Calculation - Additional Tests
 *
 * Tests 1.1, 1.7, 1.8, 1.9 (instance scaling) plus multi-model and daily limit tests.
 */
import {
  FIVE_SLOTS,
  FULL_TPM_CAPACITY,
  INSTANCE_A_URL,
  INSTANCE_B_URL,
  SINGLE_INSTANCE,
  TEN_SLOTS,
  THREE_INSTANCES,
  THREE_SLOTS,
  TPM_PER_INSTANCE_SPLIT,
  TPM_THREE_WAY_SPLIT,
  TWENTY_FIVE_SLOTS,
  TWO_INSTANCES,
  ZERO_COUNT,
  fetchAllocation,
  getPool,
  getPoolSlots,
  killAllInstances,
  setupAndVerifyFourInstances,
  setupInstances,
  setupSingleInstance,
  setupThreeInstances,
  verifyInstanceCount,
  verifyPoolExists,
} from './slotCalculationHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

// Ports for four-instance tests
const PORT_A = 4011;
const PORT_B = 4012;
const PORT_C = 4013;
const PORT_D = 4014;

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 1.1: Single Instance Gets Full Capacity
 * floor(100K / 10K / 1) = 10 slots, tokensPerMinute = 100,000
 */
describe('Slot Calculation - 1.1 Single Instance Full Capacity', () => {
  beforeAll(async () => {
    await setupSingleInstance('slotCalc-tpm-single');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 1 instance', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    expect(response.allocation?.instanceCount).toBe(SINGLE_INSTANCE);
  });

  it('should calculate 10 pool slots for single instance', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const slots = getPoolSlots(response, 'model-alpha');
    expect(slots).toBe(TEN_SLOTS);
  });

  it('should report full tokensPerMinute for single instance', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-alpha');
    expect(pool?.tokensPerMinute).toBe(FULL_TPM_CAPACITY);
  });
});

/**
 * Test 1.7: Two Instances Split Capacity Exactly
 * floor(100K / 10K / 2) = 5 slots, tokensPerMinute = 50,000
 */
describe('Slot Calculation - 1.7 Two Instances Split Capacity', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-tpm-single');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 2 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, TWO_INSTANCES);
  });

  it('should calculate 5 pool slots per instance', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const slots = getPoolSlots(response, 'model-alpha');
    expect(slots).toBe(FIVE_SLOTS);
  });

  it('should report tokensPerMinute split per instance', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-alpha');
    expect(pool?.tokensPerMinute).toBe(TPM_PER_INSTANCE_SPLIT);
  });
});

/**
 * Test 1.8: Three Instances with Remainder
 * floor(100K / 10K / 3) = 3 slots, tokensPerMinute = 33,333
 */
describe('Slot Calculation - 1.8 Three Instances with Remainder', () => {
  beforeAll(async () => {
    await setupThreeInstances('slotCalc-tpm-single');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should report 3 instances', async () => {
    await verifyInstanceCount(INSTANCE_A_URL, THREE_INSTANCES);
  });

  it('should calculate 3 pool slots per instance', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const slots = getPoolSlots(response, 'model-alpha');
    expect(slots).toBe(THREE_SLOTS);
  });

  it('should report tokensPerMinute split across three instances', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-alpha');
    expect(pool?.tokensPerMinute).toBe(TPM_THREE_WAY_SPLIT);
  });
});

/**
 * Test 1.9: Zero Slots After Floor Division (4 instances)
 * TPM=15K, tokens=10K → floor(15K / 10K / 4) = floor(0.375) = 0
 */
describe('Slot Calculation - 1.9 Zero Slots After Floor Division', () => {
  const ZERO_SLOTS = 0;
  const FOUR_INSTANCE_PORTS: [number, number, number, number] = [PORT_A, PORT_B, PORT_C, PORT_D];

  it(
    'should calculate 0 pool slots with 4 instances and low capacity',
    async () => {
      await setupAndVerifyFourInstances(
        FOUR_INSTANCE_PORTS,
        'slotCalc-zero-slots',
        'model-alpha',
        ZERO_SLOTS
      );
    },
    BEFORE_ALL_TIMEOUT_MS
  );
});

/** Additional: Multiple Models with Different Limit Types */
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
    expect(pool?.totalSlots).toBe(TWENTY_FIVE_SLOTS);
  });
});

/** Additional: Instance Count Verification */
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

/** Additional: TPD Only Model */
describe('Slot Calculation - TPD Only Model', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-tpd');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should have pool allocation for TPD model', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-tpd');
    expect(pool).toBeDefined();
    expect(pool?.totalSlots).toBeGreaterThan(ZERO_COUNT);
    expect(pool?.tokensPerDay).toBeGreaterThan(ZERO_COUNT);
  });
});

/** Additional: RPD Only Model */
describe('Slot Calculation - RPD Only Model', () => {
  beforeAll(async () => {
    await setupInstances('slotCalc-rpd');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should have pool allocation for RPD model', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const pool = getPool(response, 'model-rpd');
    expect(pool).toBeDefined();
    expect(pool?.totalSlots).toBeGreaterThan(ZERO_COUNT);
    expect(pool?.requestsPerDay).toBeGreaterThan(ZERO_COUNT);
  });
});
