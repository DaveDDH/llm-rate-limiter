/**
 * Helper functions for localRatioOnly tests
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { bootInstance, cleanRedis, killAllInstances, waitForAllocationUpdate } from '../instanceLifecycle.js';
import { bootProxy, killProxy } from '../proxyLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { StateAggregator } from '../stateAggregator.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import { TestDataCollector } from '../testDataCollector.js';
import { sendJob, sleep } from '../testUtils.js';

export interface ModelPoolAllocation {
  totalSlots: number;
  tokensPerMinute: number;
  requestsPerMinute: number;
  tokensPerDay: number;
  requestsPerDay: number;
}

export interface AllocationResponse {
  instanceId: string;
  timestamp: number;
  allocation: {
    instanceCount: number;
    pools: Record<string, ModelPoolAllocation>;
  } | null;
}

export const PROXY_PORT = 3000;
export const INSTANCE_PORT_A = 3001;
export const INSTANCE_PORT_B = 3002;
export const PROXY_URL = `http://localhost:${PROXY_PORT}`;
export const INSTANCE_A_URL = `http://localhost:${INSTANCE_PORT_A}`;
export const INSTANCE_B_URL = `http://localhost:${INSTANCE_PORT_B}`;
export const INSTANCE_URLS = [INSTANCE_A_URL, INSTANCE_B_URL];

export const JOB_DURATION_MS = 100;
export const LONG_JOB_DURATION_MS = 3000;
export const WAIT_TIMEOUT_MS = 120000;
export const CONFIG_PRESET: ConfigPresetName = 'flexibleRatio';

export const HEAVY_LOAD_JOBS = 6;
export const STANDARD_JOBS = 3;
export const MIXED_JOBS_PER_TYPE = 4;
export const TOTAL_MIXED_JOBS = 12;
export const ZERO_COUNT = 0;
export const MAX_QUEUE_DURATION_MS = 5000;
export const INSTANCE_COUNT = 2;

const SLEEP_AFTER_SEND_MS = 200;

/** Job definition for direct sending */
interface DirectJob {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
}

/**
 * Type guard for AllocationResponse
 */
const isAllocationResponse = (value: unknown): value is AllocationResponse =>
  typeof value === 'object' &&
  value !== null &&
  'instanceId' in value &&
  'timestamp' in value &&
  'allocation' in value;

/**
 * Fetch allocation from an instance.
 */
export const fetchAllocation = async (baseUrl: string): Promise<AllocationResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/allocation`);
  const data: unknown = await response.json();
  if (!isAllocationResponse(data)) {
    throw new Error('Invalid allocation response');
  }
  return data;
};

/**
 * Boot all infrastructure: clean Redis, start instances, start proxy.
 */
export const bootInfrastructure = async (): Promise<void> => {
  await killAllInstances();
  try {
    await killProxy();
  } catch {
    // Proxy may not be running
  }
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_A, CONFIG_PRESET);
  await bootInstance(INSTANCE_PORT_B, CONFIG_PRESET);
  await waitForAllocationUpdate(INSTANCE_PORT_A, (a) => a.instanceCount === INSTANCE_COUNT);
  await bootProxy([INSTANCE_PORT_A, INSTANCE_PORT_B], PROXY_PORT);
};

/**
 * Tear down all infrastructure: kill proxy, kill instances.
 */
export const teardownInfrastructure = async (): Promise<void> => {
  try {
    await killProxy();
  } catch {
    // Proxy may not have started
  }
  try {
    await killAllInstances();
  } catch {
    // Instances may not have started
  }
};

/**
 * Reset proxy to default state
 */
export const resetProxy = async (): Promise<void> => {
  await fetch(`${PROXY_URL}/proxy/reset`, { method: 'POST' });
};

/**
 * Reset both instances: kill, clean Redis, boot fresh.
 */
export const resetBothInstances = async (cleanRedisFlag: boolean): Promise<void> => {
  await killAllInstances();
  if (cleanRedisFlag) {
    await cleanRedis();
  }
  await bootInstance(INSTANCE_PORT_A, CONFIG_PRESET);
  await bootInstance(INSTANCE_PORT_B, CONFIG_PRESET);
  await waitForAllocationUpdate(INSTANCE_PORT_A, (a) => a.instanceCount === INSTANCE_COUNT);
};

/**
 * Get pool from allocation response
 */
export const getFlexModelPool = (alloc: AllocationResponse): ModelPoolAllocation | undefined => {
  const pools = alloc.allocation?.pools;
  if (pools === undefined) {
    return undefined;
  }
  return pools['flex-model'];
};

/**
 * Start data collection for direct-to-instance suite
 */
const startDirectCollection = async (
  instanceUrls: string[]
): Promise<{ aggregator: StateAggregator; collector: TestDataCollector }> => {
  const aggregator = new StateAggregator(instanceUrls);
  const collector = new TestDataCollector(instanceUrls);
  await collector.startEventListeners();
  return { aggregator, collector };
};

/**
 * Record jobs and send them directly to an instance
 */
const sendDirectJobs = async (
  targetUrl: string,
  jobs: DirectJob[],
  collector: TestDataCollector,
  parallel: boolean
): Promise<void> => {
  for (const job of jobs) {
    collector.recordJobSent(job.jobId, job.jobType, targetUrl);
  }
  if (parallel) {
    await Promise.all(jobs.map(async (job) => await sendJob(targetUrl, job)));
    return;
  }
  await jobs.reduce(async (prev, job) => {
    await prev;
    await sendJob(targetUrl, job);
  }, Promise.resolve());
};

/**
 * Wait for jobs to complete and return test data
 */
const finishDirectSuite = async (
  aggregator: StateAggregator,
  collector: TestDataCollector,
  waitTimeoutMs: number
): Promise<TestData> => {
  await sleep(SLEEP_AFTER_SEND_MS);
  try {
    await aggregator.waitForNoActiveJobs({ timeoutMs: waitTimeoutMs });
  } catch {
    // Timeout not fatal
  }
  collector.stopEventListeners();
  return collector.getData();
};

/**
 * Run Phase A: heavy load directly on Instance A
 */
const runPhaseA = async (): Promise<TestData> => {
  const heavyJobs = generateJobsOfType(HEAVY_LOAD_JOBS, 'flexJobA', {
    prefix: 'heavy-a',
    durationMs: LONG_JOB_DURATION_MS,
  });
  const setup = await startDirectCollection([INSTANCE_A_URL]);
  await sendDirectJobs(INSTANCE_A_URL, heavyJobs, setup.collector, true);
  return await finishDirectSuite(setup.aggregator, setup.collector, WAIT_TIMEOUT_MS);
};

/**
 * Run Phase B: standard load directly on Instance B
 */
const runPhaseB = async (): Promise<TestData> => {
  const jobs = generateJobsOfType(STANDARD_JOBS, 'flexJobB', {
    prefix: 'independent-b',
    durationMs: JOB_DURATION_MS,
  });
  const setup = await startDirectCollection([INSTANCE_B_URL]);
  await sendDirectJobs(INSTANCE_B_URL, jobs, setup.collector, false);
  return await finishDirectSuite(setup.aggregator, setup.collector, WAIT_TIMEOUT_MS);
};

/**
 * Run the independent instance test.
 * Sends jobs directly to instances (bypasses proxy) to test independent ratio management.
 */
export const runIndependentInstanceTest = async (): Promise<{
  dataA: TestData;
  dataB: TestData;
}> => {
  const dataA = await runPhaseA();
  const dataB = await runPhaseB();
  return { dataA, dataB };
};

/**
 * Run the mixed load test
 */
export const runMixedLoadTest = async (): Promise<TestData> => {
  const jobsA = generateJobsOfType(MIXED_JOBS_PER_TYPE, 'flexJobA', {
    prefix: 'mixed-a',
    durationMs: JOB_DURATION_MS,
  });

  const jobsB = generateJobsOfType(MIXED_JOBS_PER_TYPE, 'flexJobB', {
    prefix: 'mixed-b',
    durationMs: JOB_DURATION_MS,
  });

  const jobsC = generateJobsOfType(MIXED_JOBS_PER_TYPE, 'flexJobC', {
    prefix: 'mixed-c',
    durationMs: JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'local-ratio-mixed',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs: [...jobsA, ...jobsB, ...jobsC],
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    saveToFile: true,
    proxyRatio: '1:1',
  });
};

/**
 * Run the allocation verification heavy load test.
 * Sends heavy jobs directly to Instance A (bypasses proxy).
 */
export const runAllocationVerifyHeavyLoad = async (): Promise<void> => {
  const heavyJobs = generateJobsOfType(HEAVY_LOAD_JOBS, 'flexJobA', {
    prefix: 'alloc-verify',
    durationMs: LONG_JOB_DURATION_MS,
  });

  const setup = await startDirectCollection([INSTANCE_A_URL]);
  await sendDirectJobs(INSTANCE_A_URL, heavyJobs, setup.collector, true);
  await finishDirectSuite(setup.aggregator, setup.collector, WAIT_TIMEOUT_MS);
};
