/**
 * Test suite: Single Job Operations (Test 4)
 *
 * Verifies single job acquire/release operations work correctly.
 *
 * Test 4.1: Acquire decrements pool slot (in-flight increases)
 * Test 4.2: Release increments pool slot (in-flight decreases)
 * Test 4.3: Single job updates global counter exactly
 * Test 4.4: Concurrent slots released immediately
 *
 * Config presets used:
 * - slotCalc-tpm-single: model-alpha TPM=100K, jobTypeA 10K tokens
 *   2 instances → floor(100K/10K/2) = 5 slots per instance
 * - slotCalc-concurrent: model-gamma maxConcurrent=100
 *   2 instances → floor(100/2) = 50 slots per instance
 */
import { sleep } from '../testUtils.js';
import {
  AVAILABLE_AFTER_RELEASE,
  CONCURRENT_AFTER_ACQUIRE,
  CONCURRENT_CONFIG,
  CONCURRENT_SLOTS_PER_INSTANCE,
  HTTP_ACCEPTED,
  INITIAL_IN_FLIGHT,
  INSTANCE_A_URL,
  JOB_COMPLETE_WAIT_MS,
  JOB_SETTLE_MS,
  LONG_JOB_DURATION_MS,
  MOCK_REQUEST_COUNT,
  MOCK_TOTAL_TOKENS,
  ONE_IN_FLIGHT,
  POOL_SLOTS_PER_INSTANCE,
  SHORT_JOB_DURATION_MS,
  TPM_CONFIG,
  ZERO_COUNT,
  fetchStats,
  getAllocatedSlots,
  getConcurrency,
  getInFlight,
  getRequestsPerMinute,
  getTokensPerMinute,
  killAllInstances,
  setupInstances,
  submitJob,
  waitForJobComplete,
} from './singleJobOperationsHelpers.js';

const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;
const CONCURRENT_WAIT_MULTIPLIER = 2;

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('4.1 Acquire Decrements Pool Slot', () => {
  beforeAll(async () => {
    await setupInstances(TPM_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should start with correct allocated slots', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const allocated = getAllocatedSlots(stats, 'jobTypeA');
    expect(allocated).toBe(POOL_SLOTS_PER_INSTANCE);
  });

  it('should start with zero in-flight jobs', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const inFlight = getInFlight(stats, 'jobTypeA');
    expect(inFlight).toBe(INITIAL_IN_FLIGHT);
  });

  it('should show in-flight=1 after submitting a job', async () => {
    const timestamp = Date.now();
    const jobId = `acquire-test-${timestamp}`;

    const status = await submitJob(INSTANCE_A_URL, jobId, 'jobTypeA', LONG_JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);

    // Wait for job to start processing
    await sleep(JOB_SETTLE_MS);

    const stats = await fetchStats(INSTANCE_A_URL);
    const inFlight = getInFlight(stats, 'jobTypeA');
    expect(inFlight).toBe(ONE_IN_FLIGHT);
  });
});

describe('4.2 Release Increments Pool Slot', () => {
  beforeAll(async () => {
    await setupInstances(TPM_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should return to zero in-flight after job completes', async () => {
    const timestamp = Date.now();
    const jobId = `release-test-${timestamp}`;

    await submitJob(INSTANCE_A_URL, jobId, 'jobTypeA', SHORT_JOB_DURATION_MS);

    // Wait for job to complete
    await waitForJobComplete(INSTANCE_A_URL, JOB_COMPLETE_WAIT_MS);

    const stats = await fetchStats(INSTANCE_A_URL);
    const inFlight = getInFlight(stats, 'jobTypeA');
    expect(inFlight).toBe(INITIAL_IN_FLIGHT);
  });

  it('should have full slots available after release', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const allocated = getAllocatedSlots(stats, 'jobTypeA');
    const inFlight = getInFlight(stats, 'jobTypeA');
    const available = allocated - inFlight;
    expect(available).toBe(AVAILABLE_AFTER_RELEASE);
  });
});

describe('4.3 Single Job Updates Global Counter', () => {
  beforeAll(async () => {
    await setupInstances(TPM_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should update token counter after job completes', async () => {
    const timestamp = Date.now();
    const jobId = `counter-test-${timestamp}`;

    await submitJob(INSTANCE_A_URL, jobId, 'jobTypeA', SHORT_JOB_DURATION_MS);

    await waitForJobComplete(INSTANCE_A_URL, JOB_COMPLETE_WAIT_MS);

    const stats = await fetchStats(INSTANCE_A_URL);
    const tpm = getTokensPerMinute(stats, 'model-alpha');
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(MOCK_TOTAL_TOKENS);
  });

  it('should update request counter after job completes', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const rpm = getRequestsPerMinute(stats, 'model-alpha');
    expect(rpm).toBeDefined();
    expect(rpm?.current).toBe(MOCK_REQUEST_COUNT);
  });
});

describe('4.4 Concurrent Slots Released Immediately', () => {
  beforeAll(async () => {
    await setupInstances(CONCURRENT_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should show full concurrent capacity initially', async () => {
    const stats = await fetchStats(INSTANCE_A_URL);
    const concurrency = getConcurrency(stats, 'model-gamma');
    expect(concurrency).toBeDefined();
    expect(concurrency?.available).toBe(CONCURRENT_SLOTS_PER_INSTANCE);
  });

  it('should decrement available concurrent slots while job runs', async () => {
    const timestamp = Date.now();
    const jobId = `concurrent-test-${timestamp}`;

    await submitJob(INSTANCE_A_URL, jobId, 'jobTypeA', LONG_JOB_DURATION_MS);

    // Wait for job to start processing
    await sleep(JOB_SETTLE_MS);

    const stats = await fetchStats(INSTANCE_A_URL);
    const concurrency = getConcurrency(stats, 'model-gamma');
    expect(concurrency?.active).toBe(ONE_IN_FLIGHT);
    expect(concurrency?.available).toBe(CONCURRENT_AFTER_ACQUIRE);
  });

  it('should restore concurrent slots after job completes', async () => {
    await waitForJobComplete(INSTANCE_A_URL, LONG_JOB_DURATION_MS * CONCURRENT_WAIT_MULTIPLIER);

    const stats = await fetchStats(INSTANCE_A_URL);
    const concurrency = getConcurrency(stats, 'model-gamma');
    expect(concurrency?.active).toBe(ZERO_COUNT);
    expect(concurrency?.available).toBe(CONCURRENT_SLOTS_PER_INSTANCE);
  });
});
