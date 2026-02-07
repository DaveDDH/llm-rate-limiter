/**
 * Test suite: Queue Behavior Additional (Test 13, cases 13.3, 13.5)
 *
 * 13.3: FIFO Queue Order Preserved
 * 13.5: Job Completion Wakes Queue
 *
 * Config: medium-queue-concurrent
 * model-alpha: maxConcurrent=5, maxWaitMS=60000
 * 1 instance → 5 concurrent slots
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  CONFIG_PRESET,
  FIFO_EXTRA_JOBS,
  FIFO_GAP_MS,
  FIFO_SETTLE_MS,
  FILL_CAPACITY_COUNT,
  HTTP_ACCEPTED,
  INSTANCE_URL,
  JOB_COMPLETE_TIMEOUT_MS,
  JOB_SETTLE_MS,
  MEDIUM_JOB_DURATION_MS,
  ONE_EXTRA_JOB,
  SHORT_JOB_DURATION_MS,
  WAKE_JOB_DURATION_MS,
  fetchJobHistory,
  killAllInstances,
  setupSingleInstance,
  sleep,
  submitJob,
  submitJobBatch,
  waitForNoActiveJobs,
} from './queueBehaviorHelpers.js';

// Array index constants for FIFO ordering
const FIRST_QUEUED_INDEX = 0;
const SECOND_QUEUED_INDEX = 1;
const THIRD_QUEUED_INDEX = 2;

// Fallback timestamp for missing jobs
const FALLBACK_TIMESTAMP = 0;

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/** Find a job in history by exact jobId */
const findJobInHistory = (
  history: Array<{ jobId: string; completedAt: number }>,
  jobId: string
): { jobId: string; completedAt: number } | undefined => history.find((j) => j.jobId === jobId);

/** Submit FIFO jobs sequentially with gaps between them */
const submitFifoJobs = async (prefix: string, count: number): Promise<string[]> => {
  const timestamp = Date.now();
  const jobIds: string[] = [];

  // Submit first job
  const firstJobId = `${prefix}-${timestamp}-${FIRST_QUEUED_INDEX}`;
  jobIds.push(firstJobId);
  await submitJob(INSTANCE_URL, firstJobId, 'jobTypeA', SHORT_JOB_DURATION_MS);
  await sleep(FIFO_GAP_MS);

  // Submit remaining jobs
  const remainingCount = count - ONE_EXTRA_JOB;
  const remainingIds = await submitRemainingFifoJobs(prefix, timestamp, remainingCount);
  jobIds.push(...remainingIds);

  return jobIds;
};

/** Submit remaining FIFO jobs after the first one */
const submitRemainingFifoJobs = async (
  prefix: string,
  timestamp: number,
  count: number
): Promise<string[]> => {
  const jobIds: string[] = [];
  const startIndex = ONE_EXTRA_JOB;

  const submissions = Array.from({ length: count }, async (_, offset) => {
    const index = startIndex + offset;
    const jobId = `${prefix}-${timestamp}-${index}`;
    jobIds.push(jobId);
    await sleep(FIFO_GAP_MS * (index - startIndex));
    const status = await submitJob(INSTANCE_URL, jobId, 'jobTypeA', SHORT_JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);
    return jobId;
  });

  await Promise.all(submissions);
  return jobIds;
};

/** Verify FIFO ordering of completion timestamps */
const verifyFifoOrder = (completionTimes: number[]): void => {
  const first = completionTimes[FIRST_QUEUED_INDEX] ?? FALLBACK_TIMESTAMP;
  const second = completionTimes[SECOND_QUEUED_INDEX] ?? FALLBACK_TIMESTAMP;
  const third = completionTimes[THIRD_QUEUED_INDEX] ?? FALLBACK_TIMESTAMP;

  expect(first).toBeLessThanOrEqual(second);
  expect(second).toBeLessThanOrEqual(third);
};

describe('13.3 FIFO Queue Order Preserved', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should process queued jobs in FIFO order', async () => {
    // Fill all 5 slots with medium-duration jobs
    await submitJobBatch(INSTANCE_URL, 'fifo-fill', FILL_CAPACITY_COUNT, MEDIUM_JOB_DURATION_MS);
    await sleep(FIFO_SETTLE_MS);

    // Submit 3 more jobs sequentially with small gaps
    const fifoJobIds = await submitFifoJobs('fifo-queued', FIFO_EXTRA_JOBS);

    // Wait for all jobs to complete
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    // Verify FIFO order via completion timestamps
    const { history } = await fetchJobHistory(INSTANCE_URL);
    const fifoResults = fifoJobIds.map((id) => findJobInHistory(history, id));

    // All queued jobs should be found
    for (const result of fifoResults) {
      expect(result).toBeDefined();
    }

    const completionTimes = fifoResults.map((r) => r?.completedAt ?? FALLBACK_TIMESTAMP);
    verifyFifoOrder(completionTimes);
  });
});

describe('13.5 Job Completion Wakes Queue', () => {
  beforeAll(async () => {
    await setupSingleInstance(CONFIG_PRESET);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should wake queued job when capacity frees up', async () => {
    const timestamp = Date.now();

    // Fill 5 slots with 1s-duration jobs
    await submitJobBatch(INSTANCE_URL, 'wake-fill', FILL_CAPACITY_COUNT, WAKE_JOB_DURATION_MS);
    await sleep(JOB_SETTLE_MS);

    // Submit one more job that gets queued
    const queuedJobId = `wake-queued-${timestamp}`;
    const status = await submitJob(INSTANCE_URL, queuedJobId, 'jobTypeA', SHORT_JOB_DURATION_MS);
    expect(status).toBe(HTTP_ACCEPTED);

    // Wait for all to complete
    await waitForNoActiveJobs(INSTANCE_URL, JOB_COMPLETE_TIMEOUT_MS);

    // Verify all 6 jobs completed
    const { history, summary } = await fetchJobHistory(INSTANCE_URL);
    const totalJobs = FILL_CAPACITY_COUNT + ONE_EXTRA_JOB;
    expect(summary.completed).toBe(totalJobs);

    // Verify the queued job completed
    const queuedJob = history.find((j) => j.jobId === queuedJobId);
    expect(queuedJob).toBeDefined();
    expect(queuedJob?.status).toBe('completed');
  });
});
