/**
 * Test suite: Job Priority (Test 45)
 *
 * Verifies that different job types have different wait behaviors
 * based on maxWaitMS configuration.
 *
 * Tests 45.1-45.2:
 * - 45.1: Low priority fails fast, critical waits
 * - 45.2: Mixed job types in same queue
 *
 * Config: highest-jobPriority
 * - model-alpha: TPM=10K (1 slot), model-beta: TPM=100K
 * - lowPriority: maxWaitMS=0, critical: maxWaitMS=60s
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CONFIG_PRESET,
  DELEGATION_TOLERANCE_MS,
  IMMEDIATE_DELEGATION_MS,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_TYPE_CRITICAL,
  JOB_TYPE_LOW_PRIORITY,
  LONG_JOB_DURATION_MS,
  MODEL_BETA,
  SHORT_JOB_DURATION_MS,
  fetchJobResults,
  findJobResult,
  killAllInstances,
  setupSingleInstance,
  submitAndExpectAccepted,
  submitJobsInOrder,
  verifyCriticalJobQueued,
  verifyLowPriorityDelegation,
  waitForJobComplete,
} from './jobPriorityHelpers.js';

// Ensure all instances are killed when this file finishes
afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/** Test 45.1a: Low priority job delegates immediately */
describe('45.1a Low Priority Delegates Immediately', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should fill capacity then delegate lowPriority immediately', async () => {
    const fillId = `priority-fill-${Date.now()}`;
    const lowId = `priority-low-${Date.now()}`;
    await submitAndExpectAccepted({
      baseUrl: INSTANCE_URL,
      jobId: fillId,
      jobType: JOB_TYPE_CRITICAL,
      durationMs: LONG_JOB_DURATION_MS,
    });
    await submitAndExpectAccepted({
      baseUrl: INSTANCE_URL,
      jobId: lowId,
      jobType: JOB_TYPE_LOW_PRIORITY,
      durationMs: SHORT_JOB_DURATION_MS,
    });
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
    const results = await fetchJobResults(INSTANCE_URL);
    const maxMs = IMMEDIATE_DELEGATION_MS + DELEGATION_TOLERANCE_MS;
    verifyLowPriorityDelegation(findJobResult(results, lowId), MODEL_BETA, maxMs);
  });
});

/** Test 45.1b: Critical job queues instead of delegating */
describe('45.1b Critical Job Queues', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should fill capacity then queue critical job', async () => {
    const fillId = `priority-fill-crit-${Date.now()}`;
    const critId = `priority-critical-${Date.now()}`;
    await submitAndExpectAccepted({
      baseUrl: INSTANCE_URL,
      jobId: fillId,
      jobType: JOB_TYPE_CRITICAL,
      durationMs: LONG_JOB_DURATION_MS,
    });
    await submitAndExpectAccepted({
      baseUrl: INSTANCE_URL,
      jobId: critId,
      jobType: JOB_TYPE_CRITICAL,
      durationMs: SHORT_JOB_DURATION_MS,
    });
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
    const results = await fetchJobResults(INSTANCE_URL);
    verifyCriticalJobQueued(findJobResult(results, critId), IMMEDIATE_DELEGATION_MS);
  });
});

/**
 * Test 45.2: Mixed Job Types in Same Queue
 *
 * Submit critical job (queued), lowPriority job (delegates),
 * another critical job (queued).
 */
describe('45.2 Mixed Job Types in Same Queue', () => {
  const jobIds = {
    fill: `mixed-fill-${Date.now()}`,
    critical1: `mixed-critical-1-${Date.now()}`,
    lowPriority: `mixed-low-${Date.now()}`,
    critical2: `mixed-critical-2-${Date.now()}`,
  };

  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should submit all mixed job types', async () => {
    await submitJobsInOrder(INSTANCE_URL, [
      { jobId: jobIds.fill, jobType: JOB_TYPE_CRITICAL, durationMs: LONG_JOB_DURATION_MS },
      { jobId: jobIds.critical1, jobType: JOB_TYPE_CRITICAL, durationMs: SHORT_JOB_DURATION_MS },
      { jobId: jobIds.lowPriority, jobType: JOB_TYPE_LOW_PRIORITY, durationMs: SHORT_JOB_DURATION_MS },
      { jobId: jobIds.critical2, jobType: JOB_TYPE_CRITICAL, durationMs: SHORT_JOB_DURATION_MS },
    ]);
  });

  it('should delegate low-priority and queue critical jobs', async () => {
    await waitForJobComplete(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
    const results = await fetchJobResults(INSTANCE_URL);
    const maxDelegationMs = IMMEDIATE_DELEGATION_MS + DELEGATION_TOLERANCE_MS;
    verifyLowPriorityDelegation(findJobResult(results, jobIds.lowPriority), MODEL_BETA, maxDelegationMs);
    verifyCriticalJobQueued(findJobResult(results, jobIds.critical1), IMMEDIATE_DELEGATION_MS);
    verifyCriticalJobQueued(findJobResult(results, jobIds.critical2), IMMEDIATE_DELEGATION_MS);
  });
});
