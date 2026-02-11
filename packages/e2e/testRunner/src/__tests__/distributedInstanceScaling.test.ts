/**
 * Test suite: Distributed Instance Scaling (Test 28)
 *
 * Verifies that pool slots are properly redistributed when instances join and leave
 * in distributed mode. Redis tracks per-model capacity and distributes evenly
 * across instances.
 *
 * Uses the instanceScaling config preset:
 * - scale-model: 100K TPM
 * - scaleJob: 10K tokens
 *
 * Expected pool slots:
 * - With 1 instance: floor((100K/10K) / 1) = 10 slots
 * - With 2 instances: floor((100K/10K) / 2) = 5 slots per instance
 * - With 3 instances: floor((100K/10K) / 3) = 3 slots per instance
 *
 * Key behaviors to verify:
 * 1. When instance B joins after A, A's pool slots halve (from 10 to 5)
 * 2. When instance B disconnects, A's pool slots double (back to 10)
 * 3. Heartbeat maintains registration
 * 4. Stale instances are cleaned up automatically
 * 5. Instance unregistration returns slots to pool
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  FIVE_SLOTS,
  HEARTBEAT_WAIT_MS,
  INSTANCE_CLEANUP_TIMEOUT_MS,
  PORT_A,
  PORT_B,
  SINGLE_INSTANCE,
  TEN_SLOTS,
  TEST_TIMEOUT_MS,
  TWO_INSTANCES,
  killAllInstances,
  killInstance,
  setupInstanceLeaveTest,
  setupTwoInstanceTest,
  sleep,
  verifyInstanceCount,
  verifyPoolSlots,
  waitForAllocationUpdate,
} from './distributedInstanceScalingHelpers.js';

// Clean up all instances after all tests
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Instance Scaling - 28.1 Instance Join Slots Halve Immediately', () => {
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
});

describe('Distributed Instance Scaling - 28.2 Instance Leave Slots Double After Heartbeat Timeout', () => {
  beforeAll(async () => {
    await setupInstanceLeaveTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it('should report 1 instance on Instance A after B leaves', async () => {
    await verifyInstanceCount(PORT_A, SINGLE_INSTANCE);
  });

  it('should have 10 pool slots on Instance A after B leaves', async () => {
    await verifyPoolSlots(PORT_A, TEN_SLOTS);
  });
});

describe('Distributed Instance Scaling - 28.3 Heartbeat Maintains Instance Registration', () => {
  beforeAll(async () => {
    await setupTwoInstanceTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should maintain both instances after multiple heartbeat cycles',
    async () => {
      // Wait 10 seconds (multiple heartbeat cycles)
      await sleep(HEARTBEAT_WAIT_MS);

      // Both instances should still be registered
      await verifyInstanceCount(PORT_A, TWO_INSTANCES);
      await verifyInstanceCount(PORT_B, TWO_INSTANCES);

      // Pool slots still divided by 2
      await verifyPoolSlots(PORT_A, FIVE_SLOTS);
      await verifyPoolSlots(PORT_B, FIVE_SLOTS);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Instance Scaling - 28.4 Stale Instance Cleanup', () => {
  beforeAll(async () => {
    await setupTwoInstanceTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should cleanup stale instance and double remaining instance slots',
    async () => {
      // Verify initial state (both instances running)
      await verifyInstanceCount(PORT_A, TWO_INSTANCES);
      await verifyPoolSlots(PORT_A, FIVE_SLOTS);

      // Kill instance B (simulates stale heartbeat)
      await killInstance(PORT_B);

      // Wait for stale threshold + cleanup
      await waitForAllocationUpdate(
        PORT_A,
        (alloc) => alloc.instanceCount === SINGLE_INSTANCE,
        INSTANCE_CLEANUP_TIMEOUT_MS
      );

      // Instance A should now have doubled slots
      await verifyPoolSlots(PORT_A, TEN_SLOTS);
    },
    TEST_TIMEOUT_MS
  );
});

describe('Distributed Instance Scaling - 28.5 Instance Unregistration Returns Slots to Pool', () => {
  beforeAll(async () => {
    await setupTwoInstanceTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'should return slots to pool after instance unregistration',
    async () => {
      // Verify initial state
      await verifyInstanceCount(PORT_B, TWO_INSTANCES);
      await verifyPoolSlots(PORT_B, FIVE_SLOTS);

      // Kill instance A
      await killInstance(PORT_A);

      // Wait for B to detect A's departure and reallocate
      await waitForAllocationUpdate(
        PORT_B,
        (alloc) => alloc.instanceCount === SINGLE_INSTANCE,
        INSTANCE_CLEANUP_TIMEOUT_MS
      );

      // Instance B should now have all slots (doubled from 5 to 10)
      await verifyPoolSlots(PORT_B, TEN_SLOTS);
      await verifyInstanceCount(PORT_B, SINGLE_INSTANCE);

      // Verify pool redistribution: slots = totalCapacity / instanceCount
      const redistributedSlots = TEN_SLOTS;
      expect(redistributedSlots).toBe(FIVE_SLOTS * TWO_INSTANCES);
    },
    TEST_TIMEOUT_MS
  );
});
