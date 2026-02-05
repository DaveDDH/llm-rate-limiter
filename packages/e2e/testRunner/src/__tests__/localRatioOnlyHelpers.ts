/**
 * Helper functions for localRatioOnly tests
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import type { ConfigPresetName } from '../resetInstance.js';
import { resetInstance } from '../resetInstance.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import { sleep } from '../testUtils.js';

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

export const PROXY_URL = 'http://localhost:3000';
export const INSTANCE_A_URL = 'http://localhost:3001';
export const INSTANCE_B_URL = 'http://localhost:3002';
export const INSTANCE_URLS = [INSTANCE_A_URL, INSTANCE_B_URL];

export const JOB_DURATION_MS = 100;
export const LONG_JOB_DURATION_MS = 3000;
export const WAIT_TIMEOUT_MS = 120000;
export const ALLOCATION_PROPAGATION_MS = 1000;
export const CONFIG_PRESET: ConfigPresetName = 'flexibleRatio';

export const HEAVY_LOAD_JOBS = 6;
export const STANDARD_JOBS = 3;
export const MIXED_JOBS_PER_TYPE = 4;
export const TOTAL_MIXED_JOBS = 12;
export const ZERO_COUNT = 0;
export const MAX_QUEUE_DURATION_MS = 5000;
export const INSTANCE_COUNT = 2;

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
 * Reset proxy to default state
 */
export const resetProxy = async (): Promise<void> => {
  await fetch(`${PROXY_URL}/proxy/reset`, { method: 'POST' });
};

/**
 * Set proxy ratio
 */
export const setProxyRatio = async (ratio: string): Promise<void> => {
  await fetch(`${PROXY_URL}/proxy/ratio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ratio }),
  });
};

/**
 * Reset both instances with config preset
 */
export const resetBothInstances = async (cleanRedisOnFirst: boolean): Promise<void> => {
  const resultA = await resetInstance(INSTANCE_A_URL, {
    cleanRedis: cleanRedisOnFirst,
    configPreset: CONFIG_PRESET,
  });
  expect(resultA.success).toBe(true);

  const resultB = await resetInstance(INSTANCE_B_URL, {
    cleanRedis: false,
    configPreset: CONFIG_PRESET,
  });
  expect(resultB.success).toBe(true);

  await sleep(ALLOCATION_PROPAGATION_MS);
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
 * Run the independent instance test
 */
export const runIndependentInstanceTest = async (): Promise<{
  dataA: TestData;
  dataB: TestData;
}> => {
  await resetProxy();
  await resetBothInstances(true);

  await setProxyRatio('1:0');

  const heavyJobsA = generateJobsOfType(HEAVY_LOAD_JOBS, 'flexJobA', {
    prefix: 'heavy-a',
    durationMs: LONG_JOB_DURATION_MS,
  });

  const dataA = await runSuite({
    suiteName: 'local-ratio-phase-a',
    proxyUrl: PROXY_URL,
    instanceUrls: [INSTANCE_A_URL],
    jobs: heavyJobsA,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    saveToFile: true,
    sendJobsInParallel: true,
  });

  await setProxyRatio('0:1');

  const jobsB = generateJobsOfType(STANDARD_JOBS, 'flexJobB', {
    prefix: 'independent-b',
    durationMs: JOB_DURATION_MS,
  });

  const dataB = await runSuite({
    suiteName: 'local-ratio-phase-b',
    proxyUrl: PROXY_URL,
    instanceUrls: [INSTANCE_B_URL],
    jobs: jobsB,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    saveToFile: true,
  });

  return { dataA, dataB };
};

/**
 * Run the mixed load test
 */
export const runMixedLoadTest = async (): Promise<TestData> => {
  await resetProxy();
  await setProxyRatio('1:1');
  await resetBothInstances(true);

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
  });
};

/**
 * Run the allocation verification heavy load test
 */
export const runAllocationVerifyHeavyLoad = async (): Promise<void> => {
  await setProxyRatio('1:0');

  const heavyJobs = generateJobsOfType(HEAVY_LOAD_JOBS, 'flexJobA', {
    prefix: 'alloc-verify',
    durationMs: LONG_JOB_DURATION_MS,
  });

  await runSuite({
    suiteName: 'local-ratio-alloc-verify',
    proxyUrl: PROXY_URL,
    instanceUrls: [INSTANCE_A_URL],
    jobs: heavyJobs,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    sendJobsInParallel: true,
  });
};
