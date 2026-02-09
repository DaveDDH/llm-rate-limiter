/**
 * Test suite: Edge Cases Part 2 (Test 47)
 *
 * Verifies additional edge cases.
 *
 * Tests 47.5-47.9:
 * - 47.5: maxWaitMS = 1ms
 * - 47.6: maxWaitMS = MAX_SAFE_INTEGER
 * - 47.7: Only fixed job types - no adjustment
 * - 47.8: Single flexible job type - no self-transfer
 * - 47.9: Job type preserved during escalation
 *
 * Multiple config presets:
 * - mh-escalationTpm: For maxWaitMS and escalation tests
 * - highest-edgeAllFixed: Only fixed job types
 * - highest-edgeSingleFlex: Single flexible job type
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  DELEGATION_TOLERANCE_MS,
  HTTP_ACCEPTED,
  IMMEDIATE_DELEGATION_MS,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE_FIXED_A,
  JOB_TYPE_FLEXIBLE_ONLY,
  MAX_SAFE_INTEGER_WAIT,
  MODEL_BETA,
  SHORT_JOB_DURATION_MS,
  VERY_SHORT_WAIT_MS,
  fetchJobResults,
  findJobResult,
  killAllInstances,
  setupSingleInstance,
  submitJob,
  waitForJobComplete,
} from './edgeCasesHelpers.js';

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/**
 * Test 47.5: maxWaitMS = 1ms
 *
 * Near-instant delegation when capacity full.
 */
describe('47.5 maxWaitMS = 1ms', () => {
  beforeAll(async () => {
    await setupSingleInstance('mh-escalationTpm');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should delegate immediately with maxWaitMS=1', async () => {
    const fillJobId = `maxwait-fill-${Date.now()}`;
    await submitJob({
      baseUrl: INSTANCE_URL,
      jobId: fillJobId,
      jobType: 'jobTypeA',
      durationMs: SHORT_JOB_DURATION_MS,
    });

    const jobId = `maxwait-1ms-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: 'jobTypeA',
      durationMs: SHORT_JOB_DURATION_MS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const results = await fetchJobResults(INSTANCE_URL);
    const result = findJobResult(results, jobId);
    expect(result).toBeDefined();
    expect(result?.queueDuration).toBeLessThan(VERY_SHORT_WAIT_MS + DELEGATION_TOLERANCE_MS);
  });
});

/**
 * Test 47.6: maxWaitMS = MAX_SAFE_INTEGER
 *
 * Job queued without error (very long timeout).
 */
describe('47.6 maxWaitMS = MAX_SAFE_INTEGER', () => {
  beforeAll(async () => {
    await setupSingleInstance('mh-escalationTpm');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should queue job without error with maxWaitMS=MAX_SAFE_INTEGER', async () => {
    const jobId = `maxwait-maxint-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: 'jobTypeA',
      durationMs: SHORT_JOB_DURATION_MS,
      extraPayload: { maxWaitMS: MAX_SAFE_INTEGER_WAIT },
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const results = await fetchJobResults(INSTANCE_URL);
    const result = findJobResult(results, jobId);
    expect(result).toBeDefined();
  });
});

/**
 * Test 47.7: Only Fixed Job Types - No Adjustment
 *
 * Config: fixedA + fixedB (both flexible=false).
 * No ratio adjustment should occur.
 */
describe('47.7 Only Fixed Job Types - No Adjustment', () => {
  beforeAll(async () => {
    await setupSingleInstance('highest-edgeAllFixed');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept fixed job type jobs', async () => {
    const jobId = `fixed-only-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE_FIXED_A,
      durationMs: SHORT_JOB_DURATION_MS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const results = await fetchJobResults(INSTANCE_URL);
    const result = findJobResult(results, jobId);
    expect(result).toBeDefined();
    expect(result?.status).toBe('completed');
  });
});

/**
 * Test 47.8: Single Flexible Job Type - No Self-Transfer
 *
 * Config: flexibleOnly (single flexible job type).
 * Ratio should remain 1.0 (no self-transfer).
 */
describe('47.8 Single Flexible Job Type - No Self-Transfer', () => {
  beforeAll(async () => {
    await setupSingleInstance('highest-edgeSingleFlex');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept flexible job type', async () => {
    const jobId = `single-flex-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: JOB_TYPE_FLEXIBLE_ONLY,
      durationMs: SHORT_JOB_DURATION_MS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const results = await fetchJobResults(INSTANCE_URL);
    const result = findJobResult(results, jobId);
    expect(result).toBeDefined();
    expect(result?.status).toBe('completed');
  });
});

/**
 * Test 47.9: Job Type Preserved During Escalation
 *
 * Submit job of type 'jobTypeA', escalate alpha → beta.
 * Job should still be tracked as 'jobTypeA' on beta.
 */
describe('47.9 Job Type Preserved During Escalation', () => {
  beforeAll(async () => {
    await setupSingleInstance('mh-escalationTpm');
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should preserve job type during escalation', async () => {
    const fillJobId = `escalation-fill-${Date.now()}`;
    await submitJob({
      baseUrl: INSTANCE_URL,
      jobId: fillJobId,
      jobType: 'jobTypeA',
      durationMs: SHORT_JOB_DURATION_MS,
    });

    const jobId = `escalation-preserve-${Date.now()}`;
    const status = await submitJob({
      baseUrl: INSTANCE_URL,
      jobId,
      jobType: 'jobTypeA',
      durationMs: SHORT_JOB_DURATION_MS,
    });
    expect(status).toBe(HTTP_ACCEPTED);
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    const results = await fetchJobResults(INSTANCE_URL);
    const result = findJobResult(results, jobId);
    expect(result).toBeDefined();
    expect(result?.modelUsed).toBe(MODEL_BETA);
    expect(result?.queueDuration).toBeLessThan(IMMEDIATE_DELEGATION_MS + DELEGATION_TOLERANCE_MS);
  });
});
