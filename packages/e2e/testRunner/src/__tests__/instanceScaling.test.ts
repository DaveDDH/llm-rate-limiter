/**
 * Test suite: Instance Scaling with Pool-Based Allocation
 *
 * Verifies that pool slots are properly redistributed when instances join and leave.
 * With pool-based allocation, Redis tracks per-model capacity and distributes
 * evenly across instances.
 *
 * Uses the instanceScaling config preset:
 * - scale-model: 100K TPM
 * - scaleJob: 10K tokens (used for local distribution, not Redis calculation)
 *
 * Expected pool slots:
 * - With 1 instance: floor((100K/10K) / 1) = 10 slots
 * - With 2 instances: floor((100K/10K) / 2) = 5 slots per instance
 * - With 3 instances: floor((100K/10K) / 3) = 3 slots per instance
 *
 * Key behaviors to verify:
 * 1. When instance B joins after A, A's pool slots halve (from 10 to 5)
 * 2. When instance B disconnects, A's pool slots double (back to 10)
 * 3. Total pool capacity across all instances stays constant
 *
 * Note: This test uses programmatic instance boot/kill for precise control.
 */
import {
  bootInstance,
  cleanRedis,
  fetchAllocation,
  killAllInstances,
  killInstance,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

const PORT_A = 4001; // Use different ports to avoid conflict with other tests
const PORT_B = 4002;
const PORT_C = 4003;

const CONFIG_PRESET: ConfigPresetName = 'instanceScaling';
const ALLOCATION_PROPAGATION_MS = 2000;
const INSTANCE_CLEANUP_TIMEOUT_MS = 20000; // Time for heartbeat timeout + cleanup
const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;
const BEFORE_ALL_TIMEOUT_MULTIPLIER = 2;
const BEFORE_ALL_TIMEOUT_TRIPLE = 3;

// Instance and slot counts
const SINGLE_INSTANCE = 1;
const TWO_INSTANCES = 2;
const THREE_INSTANCES = 3;
const TEN_SLOTS = 10;
const FIVE_SLOTS = 5;
const THREE_SLOTS = 3;

/**
 * Get scale model slots from response
 */
const getScaleModelSlots = (response: Awaited<ReturnType<typeof fetchAllocation>>): number | undefined => {
  const pools = response.allocation?.pools;
  if (pools === undefined) {
    return undefined;
  }
  return pools['scale-model']?.totalSlots;
};

/**
 * Verify pool slots for an instance
 */
const verifyPoolSlots = async (port: number, expectedSlots: number): Promise<void> => {
  const response = await fetchAllocation(port);
  const slots = getScaleModelSlots(response);
  expect(slots).toBe(expectedSlots);
};

/**
 * Verify instance count for an allocation response
 */
const verifyInstanceCount = async (port: number, expectedCount: number): Promise<void> => {
  const response = await fetchAllocation(port);
  expect(response.allocation?.instanceCount).toBe(expectedCount);
};

/**
 * Setup single instance test
 */
const setupSingleInstanceTest = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/**
 * Setup two instance test with verification
 */
const setupTwoInstanceTest = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();

  // Start Instance A first
  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);

  // Verify A has full capacity initially
  const initialAlloc = await fetchAllocation(PORT_A);
  expect(initialAlloc.allocation?.instanceCount).toBe(SINGLE_INSTANCE);
  expect(getScaleModelSlots(initialAlloc)).toBe(TEN_SLOTS);

  // Now boot Instance B
  await bootInstance(PORT_B, CONFIG_PRESET);

  // Wait for A to receive the updated allocation
  await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === TWO_INSTANCES);
};

/**
 * Setup instance leave test
 */
const setupInstanceLeaveTest = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();

  // Start both instances
  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(PORT_B, CONFIG_PRESET);
  await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === TWO_INSTANCES);

  // Verify both have 5 pool slots
  const allocA = await fetchAllocation(PORT_A);
  expect(getScaleModelSlots(allocA)).toBe(FIVE_SLOTS);

  // Kill ONLY Instance B while A continues running
  await killInstance(PORT_B);

  // Wait for A to detect B's departure via heartbeat timeout + reallocation
  await waitForAllocationUpdate(
    PORT_A,
    (alloc) => alloc.instanceCount === SINGLE_INSTANCE,
    INSTANCE_CLEANUP_TIMEOUT_MS
  );
};

/**
 * Run the multiple join/leave cycle test
 */
const runJoinLeaveCycleTest = async (): Promise<void> => {
  // Step 1: A starts alone with 10 pool slots
  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await verifyPoolSlots(PORT_A, TEN_SLOTS);

  // Step 2: B joins, both have 5 pool slots
  await bootInstance(PORT_B, CONFIG_PRESET);
  await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === TWO_INSTANCES);
  await verifyPoolSlots(PORT_A, FIVE_SLOTS);
  await verifyPoolSlots(PORT_B, FIVE_SLOTS);

  // Step 3: C joins, all have 3 pool slots
  await bootInstance(PORT_C, CONFIG_PRESET);
  await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === THREE_INSTANCES);
  await verifyPoolSlots(PORT_A, THREE_SLOTS);
  await verifyPoolSlots(PORT_B, THREE_SLOTS);
  await verifyPoolSlots(PORT_C, THREE_SLOTS);

  // Step 4: C leaves, A and B each have 5 pool slots
  await killInstance(PORT_C);
  await waitForAllocationUpdate(
    PORT_A,
    (alloc) => alloc.instanceCount === TWO_INSTANCES,
    INSTANCE_CLEANUP_TIMEOUT_MS
  );
  await verifyPoolSlots(PORT_A, FIVE_SLOTS);
  await verifyPoolSlots(PORT_B, FIVE_SLOTS);

  // Step 5: B leaves, A has 10 pool slots
  await killInstance(PORT_B);
  await waitForAllocationUpdate(
    PORT_A,
    (alloc) => alloc.instanceCount === SINGLE_INSTANCE,
    INSTANCE_CLEANUP_TIMEOUT_MS
  );
  await verifyPoolSlots(PORT_A, TEN_SLOTS);
};

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Instance Scaling - Instance A Starts Alone', () => {
  beforeAll(async () => {
    await setupSingleInstanceTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('should report 1 instance', async () => {
    await verifyInstanceCount(PORT_A, SINGLE_INSTANCE);
  });

  it('should have 10 pool slots as single instance', async () => {
    await verifyPoolSlots(PORT_A, TEN_SLOTS);
  });
});

describe('Instance Scaling - Instance B Joins Pool Slots Halve', () => {
  beforeAll(async () => {
    await setupTwoInstanceTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('should report 2 instances on Instance A', async () => {
    await verifyInstanceCount(PORT_A, TWO_INSTANCES);
  });

  it('should report 2 instances on Instance B', async () => {
    await verifyInstanceCount(PORT_B, TWO_INSTANCES);
  });

  it('should have 5 pool slots on Instance A after B joins', async () => {
    await verifyPoolSlots(PORT_A, FIVE_SLOTS);
  });

  it('should have 5 pool slots on Instance B', async () => {
    await verifyPoolSlots(PORT_B, FIVE_SLOTS);
  });

  it('should have consistent pool allocation on both instances', async () => {
    const responseA = await fetchAllocation(PORT_A);
    const responseB = await fetchAllocation(PORT_B);

    expect(responseA.allocation?.instanceCount).toBe(responseB.allocation?.instanceCount);
    expect(getScaleModelSlots(responseA)).toBe(getScaleModelSlots(responseB));
  });
});

describe('Instance Scaling - Instance B Leaves Pool Slots Double', () => {
  beforeAll(async () => {
    await setupInstanceLeaveTest();
  }, BEFORE_ALL_TIMEOUT_MS * BEFORE_ALL_TIMEOUT_MULTIPLIER);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('should report 1 instance on Instance A after B leaves', async () => {
    await verifyInstanceCount(PORT_A, SINGLE_INSTANCE);
  });

  it('should have 10 pool slots on Instance A after B leaves', async () => {
    await verifyPoolSlots(PORT_A, TEN_SLOTS);
  });

  it('should have A running continuously (not restarted)', async () => {
    const response = await fetchAllocation(PORT_A);
    expect(response.allocation).not.toBeNull();
    expect(response.instanceId).toBeDefined();
  });
});

describe('Instance Scaling - Multiple Join Leave Cycles', () => {
  beforeAll(async () => {
    await killAllInstances();
    await cleanRedis();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should redistribute pool slots through multiple join/leave cycles',
    async () => {
      await runJoinLeaveCycleTest();
    },
    BEFORE_ALL_TIMEOUT_MS * BEFORE_ALL_TIMEOUT_TRIPLE
  );
});
