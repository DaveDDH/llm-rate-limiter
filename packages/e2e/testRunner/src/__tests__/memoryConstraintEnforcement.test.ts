/**
 * Test suite: Memory Constraint Enforcement (Test 18)
 *
 * Verifies memory constraints block/release jobs correctly.
 *
 * Tests 18.1-18.5:
 * - 18.1: Jobs blocked when memory exhausted
 * - 18.2: Memory released on job completion
 * - 18.3: Memory and ratio interaction after adjustment
 * - 18.4: Different memory estimates per job type
 * - 18.5: All limit types simultaneously
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  EFFECTIVE_SLOTS,
  FILL_JOB_DURATION_MS,
  HEAVY_JOB_SLOTS,
  HEAVY_JOB_TYPE,
  HTTP_ACCEPTED,
  INCREMENT,
  INSTANCE_URL,
  JOBS_TO_FILL_MEMORY,
  JOBS_TO_OVERFLOW_MEMORY,
  JOB_START_MAX_MS,
  JOB_TYPE_A,
  JOB_TYPE_B,
  LIGHT_JOB_SLOTS,
  LIGHT_JOB_TYPE,
  MEMORY_50MB,
  MEMORY_100MB,
  MEMORY_ALL_LIMITS_CONFIG,
  MEMORY_CONSTRAIN_CONFIG,
  MEMORY_DIFF_ESTIMATES_CONFIG,
  MEMORY_RATIO_INTERACT_CONFIG,
  MODEL_ALPHA,
  POLL_TIMEOUT_MS,
  QUICK_JOB_DURATION_MS,
  SETTLE_MS,
  ZERO_COUNT,
  fetchActiveJobs,
  fetchStats,
  getMemoryStats,
  getModelStats,
  killAllInstances,
  setupSingleInstance,
  sleep,
  submitJob,
  submitJobsSequentially,
  waitForNoActiveJobs,
} from './memoryConstraintEnforcementHelpers.js';

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/** Verify jobs are accepted up to memory limit and memory is active */
const verifyFillMemoryAccepted = async (): Promise<void> => {
  const timestamp = Date.now();
  const submitPromises = Array.from(
    { length: JOBS_TO_FILL_MEMORY },
    async (_, i) =>
      await submitJob(INSTANCE_URL, `mem-fill-${timestamp}-${i}`, JOB_TYPE_A, FILL_JOB_DURATION_MS)
  );
  const statuses = await Promise.all(submitPromises);
  statuses.forEach((status) => {
    expect(status).toBe(HTTP_ACCEPTED);
  });
  await sleep(SETTLE_MS);
  const stats = await fetchStats(INSTANCE_URL);
  const memoryStats = getMemoryStats(stats);
  expect(memoryStats).toBeDefined();
  expect(memoryStats?.activeKB).toBeGreaterThan(ZERO_COUNT);
  await waitForNoActiveJobs(INSTANCE_URL, POLL_TIMEOUT_MS);
};

/** Verify queued job starts after memory is released */
const verifyQueuedJobStartsAfterRelease = async (): Promise<void> => {
  const timestamp = Date.now();
  const fillPrefix = `mem-release-fill-${timestamp}`;
  const fillStatuses = await submitJobsSequentially({
    baseUrl: INSTANCE_URL,
    count: JOBS_TO_FILL_MEMORY,
    prefix: fillPrefix,
    jobType: JOB_TYPE_A,
    durationMs: FILL_JOB_DURATION_MS,
  });
  fillStatuses.forEach((status) => {
    expect(status).toBe(HTTP_ACCEPTED);
  });
  const queuedJobId = `mem-release-queued-${timestamp}`;
  const status = await submitJob(INSTANCE_URL, queuedJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
  expect(status).toBe(HTTP_ACCEPTED);
  await sleep(SETTLE_MS);
  const beforeStats = await fetchStats(INSTANCE_URL);
  const beforeMemory = getMemoryStats(beforeStats);
  expect(beforeMemory?.activeKB).toBeGreaterThan(ZERO_COUNT);
  await waitForNoActiveJobs(INSTANCE_URL, POLL_TIMEOUT_MS);
  const afterStats = await fetchStats(INSTANCE_URL);
  const afterMemory = getMemoryStats(afterStats);
  expect(afterMemory?.activeKB).toBe(ZERO_COUNT);
};

describe('18.1 Jobs Blocked When Memory Exhausted', () => {
  beforeAll(async () => {
    await setupSingleInstance(MEMORY_CONSTRAIN_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should accept all jobs up to memory limit', async () => {
    await verifyFillMemoryAccepted();
  });

  it('should queue 6th job when memory exhausted', async () => {
    const timestamp = Date.now();
    const prefix = `mem-overflow-${timestamp}`;
    const statuses = await submitJobsSequentially({
      baseUrl: INSTANCE_URL,
      count: JOBS_TO_OVERFLOW_MEMORY,
      prefix,
      jobType: JOB_TYPE_A,
      durationMs: FILL_JOB_DURATION_MS,
    });
    statuses.forEach((status) => {
      expect(status).toBe(HTTP_ACCEPTED);
    });
    await sleep(SETTLE_MS);
    const stats = await fetchStats(INSTANCE_URL);
    const memoryStats = getMemoryStats(stats);
    expect(memoryStats?.activeKB).toBe(MEMORY_50MB);
    expect(memoryStats?.availableKB).toBe(ZERO_COUNT);

    // Assert running count: exactly 5 jobs actively using memory (6th is queued)
    const activeJobs = await fetchActiveJobs(INSTANCE_URL);
    expect(activeJobs.count).toBe(JOBS_TO_OVERFLOW_MEMORY);

    await waitForNoActiveJobs(INSTANCE_URL, POLL_TIMEOUT_MS);
  });
});

describe('18.2 Memory Released on Job Completion', () => {
  beforeAll(async () => {
    await setupSingleInstance(MEMORY_CONSTRAIN_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should start queued job when memory frees', async () => {
    await verifyQueuedJobStartsAfterRelease();
  });

  it('should process queued job quickly after release', async () => {
    const timestamp = Date.now();
    const quickFillPrefix = `mem-quick-fill-${timestamp}`;
    await submitJobsSequentially({
      baseUrl: INSTANCE_URL,
      count: JOBS_TO_FILL_MEMORY,
      prefix: quickFillPrefix,
      jobType: JOB_TYPE_A,
      durationMs: QUICK_JOB_DURATION_MS,
    });
    const queuedJobId = `mem-quick-queued-${timestamp}`;
    const queueTime = Date.now();
    await submitJob(INSTANCE_URL, queuedJobId, JOB_TYPE_A, QUICK_JOB_DURATION_MS);
    await waitForNoActiveJobs(INSTANCE_URL, POLL_TIMEOUT_MS);
    const totalTime = Date.now() - queueTime;
    expect(totalTime).toBeLessThan(QUICK_JOB_DURATION_MS + JOB_START_MAX_MS);
  });
});

describe('18.3 Memory and Ratio Interaction After Adjustment', () => {
  beforeAll(async () => {
    await setupSingleInstance(MEMORY_RATIO_INTERACT_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should have correct memory capacity configured', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const memoryStats = getMemoryStats(stats);
    expect(memoryStats).toBeDefined();
    expect(memoryStats?.maxCapacityKB).toBe(MEMORY_100MB);
  });

  it('should allow both job types to use memory', async () => {
    const timestamp = Date.now();
    const statusA = await submitJob(INSTANCE_URL, `ratio-a-${timestamp}`, JOB_TYPE_A, FILL_JOB_DURATION_MS);
    const statusB = await submitJob(INSTANCE_URL, `ratio-b-${timestamp}`, JOB_TYPE_B, FILL_JOB_DURATION_MS);
    expect(statusA).toBe(HTTP_ACCEPTED);
    expect(statusB).toBe(HTTP_ACCEPTED);
    await sleep(SETTLE_MS);
    const stats = await fetchStats(INSTANCE_URL);
    const memoryStats = getMemoryStats(stats);
    expect(memoryStats?.activeKB).toBeGreaterThan(ZERO_COUNT);

    // Assert memory-limited slot count: available capacity decreased with 2 active jobs
    expect(memoryStats?.availableKB).toBeLessThan(MEMORY_100MB);

    await waitForNoActiveJobs(INSTANCE_URL, POLL_TIMEOUT_MS);
  });
});

describe('18.4 Different Memory Estimates Per Job Type', () => {
  beforeAll(async () => {
    await setupSingleInstance(MEMORY_DIFF_ESTIMATES_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should allocate slots based on memory estimates', async () => {
    const timestamp = Date.now();
    const heavyJobId = `heavy-${timestamp}`;

    const heavyStatus = await submitJob(INSTANCE_URL, heavyJobId, HEAVY_JOB_TYPE, FILL_JOB_DURATION_MS);
    expect(heavyStatus).toBe(HTTP_ACCEPTED);

    const lightSubmitPromises = [];
    for (let i = 0; i < LIGHT_JOB_SLOTS; i += INCREMENT) {
      const lightJobId = `light-${timestamp}-${i}`;
      lightSubmitPromises.push(submitJob(INSTANCE_URL, lightJobId, LIGHT_JOB_TYPE, FILL_JOB_DURATION_MS));
    }
    const lightStatuses = await Promise.all(lightSubmitPromises);
    lightStatuses.forEach((status) => {
      expect(status).toBe(HTTP_ACCEPTED);
    });

    await sleep(SETTLE_MS);

    const activeJobs = await fetchActiveJobs(INSTANCE_URL);
    expect(activeJobs.count).toBe(HEAVY_JOB_SLOTS + LIGHT_JOB_SLOTS);

    await waitForNoActiveJobs(INSTANCE_URL, POLL_TIMEOUT_MS);
  });
});

describe('18.5 All Limit Types Applied Simultaneously', () => {
  beforeAll(async () => {
    await setupSingleInstance(MEMORY_ALL_LIMITS_CONFIG);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should respect most restrictive limit', async () => {
    const timestamp = Date.now();
    const allLimitsPrefix = `all-limits-${timestamp}`;
    const statuses = await submitJobsSequentially({
      baseUrl: INSTANCE_URL,
      count: EFFECTIVE_SLOTS + INCREMENT,
      prefix: allLimitsPrefix,
      jobType: JOB_TYPE_A,
      durationMs: FILL_JOB_DURATION_MS,
    });
    statuses.forEach((status) => {
      expect(status).toBe(HTTP_ACCEPTED);
    });

    await sleep(SETTLE_MS);

    const stats = await fetchStats(INSTANCE_URL);
    const memoryStats = getMemoryStats(stats);
    expect(memoryStats?.activeKB).toBe(MEMORY_100MB);
    expect(memoryStats?.availableKB).toBe(ZERO_COUNT);

    await waitForNoActiveJobs(INSTANCE_URL, POLL_TIMEOUT_MS);
  });

  it('should show all limit types in stats', async () => {
    const stats = await fetchStats(INSTANCE_URL);
    const modelStats = getModelStats(stats, MODEL_ALPHA);
    const memoryStats = getMemoryStats(stats);

    expect(modelStats?.tokensPerMinute).toBeDefined();
    expect(modelStats?.requestsPerMinute).toBeDefined();
    expect(modelStats?.concurrency).toBeDefined();
    expect(memoryStats).toBeDefined();

    // Assert memory max capacity reflects the config (100MB = 102400KB)
    expect(memoryStats?.maxCapacityKB).toBe(MEMORY_100MB);

    // Assert concurrency limit is configured
    expect(modelStats?.concurrency?.limit).toBeGreaterThan(ZERO_COUNT);
  });
});
