/**
 * Test suite: Error Handling (Tests 12.1-12.3)
 *
 * Verifies error scenarios where jobs throw without calling reject().
 *
 * 12.1: Error Without Reject - No Time-Window Release
 *   TPM counter retains reserved amount (10K) because windowed capacity
 *   is NOT released when a job throws without reject.
 *
 * 12.2: Error Without Reject - Concurrency Released
 *   Concurrency IS released even without reject (always cleaned up).
 *
 * 12.3: Error Without Reject - Memory Released
 *   Memory IS released even without reject (always cleaned up).
 */
import { sleep } from '../testUtils.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CONCURRENT_CONFIG,
  ERROR_MEMORY_CONFIG,
  ESTIMATED_TOKENS,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_DURATION_MS,
  JOB_SETTLE_MS,
  MODEL_ALPHA,
  MODEL_GAMMA,
  TPM_CONFIG,
  ZERO_ACTIVE_KB,
  ZERO_COUNT,
  fetchStats,
  getConcurrency,
  getMemoryStats,
  getTokensPerMinute,
  killAllInstances,
  setupSingleInstance,
  submitThrowJob,
  waitForNoActiveJobs,
} from './errorHandlingHelpers.js';

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('12.1 Error Without Reject - No Time-Window Release', () => {
  beforeAll(async () => {
    await setupSingleInstance(TPM_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the error job', async () => {
    const jobId = `error-no-reject-tpm-${Date.now()}`;
    const status = await submitThrowJob(INSTANCE_URL, jobId, JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);
  });

  it('should retain reserved TPM after error without reject', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
    await sleep(JOB_SETTLE_MS);
    const stats = await fetchStats(INSTANCE_URL);
    const tpm = getTokensPerMinute(stats, MODEL_ALPHA);
    expect(tpm).toBeDefined();
    expect(tpm?.current).toBe(ESTIMATED_TOKENS);
  });
});

describe('12.2 Error Without Reject - Concurrency Released', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONCURRENT_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the error job', async () => {
    const jobId = `error-no-reject-conc-${Date.now()}`;
    const status = await submitThrowJob(INSTANCE_URL, jobId, JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);
  });

  it('should release concurrency after error without reject', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
    await sleep(JOB_SETTLE_MS);
    const stats = await fetchStats(INSTANCE_URL);
    const concurrency = getConcurrency(stats, MODEL_GAMMA);
    expect(concurrency).toBeDefined();
    expect(concurrency?.active).toBe(ZERO_COUNT);
  });
});

describe('12.3 Error Without Reject - Memory Released', () => {
  beforeAll(async () => {
    await setupSingleInstance(ERROR_MEMORY_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept the error job', async () => {
    const jobId = `error-no-reject-mem-${Date.now()}`;
    const status = await submitThrowJob(INSTANCE_URL, jobId, JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);
  });

  it('should release memory after error without reject', async () => {
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);
    await sleep(JOB_SETTLE_MS);
    const stats = await fetchStats(INSTANCE_URL);
    const memory = getMemoryStats(stats, MODEL_ALPHA);
    expect(memory).toBeDefined();
    expect(memory?.activeKB).toBe(ZERO_ACTIVE_KB);
  });
});
