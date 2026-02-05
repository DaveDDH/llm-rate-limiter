/**
 * Test suite: Pool-Based Slot Calculation - Additional Tests
 *
 * This file contains additional slot calculation tests that complement
 * the main slotCalculation.test.ts tests.
 */
import {
  INSTANCE_A_URL,
  INSTANCE_B_URL,
  TWENTY_FIVE_SLOTS,
  TWO_INSTANCES,
  ZERO_COUNT,
  fetchAllocation,
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

/**
 * Additional Tests: Multiple Models with Different Limit Types
 */
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

  it('should have different pool slots for different models', async () => {
    const response = await fetchAllocation(INSTANCE_A_URL);
    const tpmSlots = getPoolSlots(response, 'model-tpm');
    const concurrentSlots = getPoolSlots(response, 'model-concurrent');

    expect(tpmSlots).toBeDefined();
    expect(concurrentSlots).toBeDefined();
  });
});

/**
 * Additional Tests: Instance Count Verification
 */
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

/**
 * Additional Tests: Separate TPD and RPD Tests
 */
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

/**
 * Additional Tests: Pool Slots Scale with Instance Count (Combined)
 */
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
