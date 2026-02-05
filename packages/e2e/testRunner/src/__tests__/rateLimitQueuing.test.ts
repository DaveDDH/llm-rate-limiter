import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  INSTANCE_URLS,
  PROXY_URL,
  bootInfrastructure,
  teardownInfrastructure,
} from './infrastructureHelpers.js';
import { ZERO_COUNT, createEmptyTestData } from './testHelpers.js';

const NUM_JOBS = 20;
const JOB_DURATION_MS = 100;
const WAIT_TIMEOUT_MS = 60000;
const BEFORE_ALL_TIMEOUT_MS = 120000;

/**
 * Run the rate limit queuing test suite
 */
const runRateLimitQueuingTest = async (): Promise<TestData> => {
  const jobs = generateJobsOfType(NUM_JOBS, 'summary', {
    prefix: 'queuing-test',
    durationMs: JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'rate-limit-queuing',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: '1:1',
  });
};

describe('Rate Limit Queuing', () => {
  let data: TestData = createEmptyTestData();

  beforeAll(async () => {
    await bootInfrastructure();
    data = await runRateLimitQueuingTest();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await teardownInfrastructure();
  }, AFTER_ALL_TIMEOUT_MS);

  it('should not reject any jobs immediately', () => {
    const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(ZERO_COUNT);
  });

  it('should eventually complete all jobs', () => {
    const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
    expect(completedJobs.length).toBe(NUM_JOBS);
  });

  it('should show jobs waiting in snapshots when rate limit is reached', () => {
    const { snapshots } = data;
    const [, postSendSnapshot] = snapshots;
    expect(postSendSnapshot).toBeDefined();

    const totalActiveJobs = Object.values(postSendSnapshot?.instances ?? {}).reduce(
      (sum, inst) => sum + inst.activeJobs,
      ZERO_COUNT
    );
    expect(totalActiveJobs).toBe(NUM_JOBS);
  });

  it('should record all job lifecycle events', () => {
    for (const job of Object.values(data.jobs)) {
      const hasQueued = job.events.some((e) => e.type === 'queued');
      const hasStarted = job.events.some((e) => e.type === 'started');
      const hasCompleted = job.events.some((e) => e.type === 'completed');

      expect(hasQueued).toBe(true);
      expect(hasStarted).toBe(true);
      expect(hasCompleted).toBe(true);
    }
  });
});
