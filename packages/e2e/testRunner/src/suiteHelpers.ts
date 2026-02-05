/**
 * Suite runner helper functions
 */
import type { ConfigPresetName } from './resetInstance.js';
import { resetInstance } from './resetInstance.js';
import type { TestDataCollector } from './testDataCollector.js';
import { sendJob, sleep } from './testUtils.js';

const ZERO = 0;
const ONE = 1;
const ALLOCATION_PROPAGATION_DELAY_MS = 500;

/** Job type definition */
export interface Job {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
}

/** Reset proxy job counts */
export const resetProxy = async (proxyUrl: string): Promise<void> => {
  const response = await fetch(`${proxyUrl}/proxy/reset`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Failed to reset proxy: ${response.statusText}`);
  }
};

/** Set proxy distribution ratio */
export const setProxyRatio = async (proxyUrl: string, ratio: string): Promise<void> => {
  const response = await fetch(`${proxyUrl}/proxy/ratio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ratio }),
  });
  if (!response.ok) {
    throw new Error(`Failed to set proxy ratio: ${response.statusText}`);
  }
};

/** Reset single instance */
const resetSingleInstance = async (
  url: string,
  cleanRedis: boolean,
  configPreset?: ConfigPresetName
): Promise<void> => {
  const result = await resetInstance(url, { cleanRedis, configPreset });
  if (!result.success) {
    throw new Error(`Failed to reset instance ${url}: ${result.error}`);
  }
};

/** Reset all server instances */
export const resetAllInstances = async (
  instanceUrls: string[],
  configPreset?: ConfigPresetName
): Promise<void> => {
  const [firstUrl] = instanceUrls;
  const restUrls = instanceUrls.slice(ONE);

  if (firstUrl !== undefined) {
    await resetSingleInstance(firstUrl, true, configPreset);
  }

  const createResetPromise = async (url: string): Promise<void> => {
    await resetSingleInstance(url, false, configPreset);
  };
  const resetPromises = restUrls.map(createResetPromise);
  await Promise.all(resetPromises);
  await sleep(ALLOCATION_PROPAGATION_DELAY_MS);
};

/** Record jobs as sent */
const recordJobsSent = (jobs: Job[], proxyUrl: string, collector: TestDataCollector): void => {
  for (const job of jobs) {
    collector.recordJobSent(job.jobId, job.jobType, proxyUrl);
  }
};

/** Send jobs in parallel */
export const sendJobsInParallelMode = async (
  jobs: Job[],
  proxyUrl: string,
  collector: TestDataCollector
): Promise<void> => {
  recordJobsSent(jobs, proxyUrl, collector);
  const sendPromises = jobs.map(async (job) => {
    const result = await sendJob(proxyUrl, job);
    return result;
  });
  await Promise.all(sendPromises);
};

/** Send a single job with recording */
const sendAndRecordJob = async (job: Job, proxyUrl: string, collector: TestDataCollector): Promise<void> => {
  collector.recordJobSent(job.jobId, job.jobType, proxyUrl);
  await sendJob(proxyUrl, job);
};

/** Send jobs sequentially using reduce pattern */
export const sendJobsSequentially = async (
  jobs: Job[],
  proxyUrl: string,
  collector: TestDataCollector
): Promise<void> => {
  await jobs.reduce(async (prev, job) => {
    await prev;
    await sendAndRecordJob(job, proxyUrl, collector);
  }, Promise.resolve());
};

/** Send delayed jobs */
export const sendDelayedJobs = async (
  delayedJobs: Job[],
  delayedJobsDelayMs: number,
  proxyUrl: string,
  collector: TestDataCollector
): Promise<void> => {
  if (delayedJobs.length > ZERO) {
    await sleep(delayedJobsDelayMs);
    recordJobsSent(delayedJobs, proxyUrl, collector);
    const sendPromises = delayedJobs.map(async (job) => {
      const result = await sendJob(proxyUrl, job);
      return result;
    });
    await Promise.all(sendPromises);
  }
};

/** Initialize suite (reset proxy and instances) */
export const initializeSuite = async (
  proxyUrl: string,
  instanceUrls: string[],
  proxyRatio: string | undefined,
  configPreset: ConfigPresetName | undefined
): Promise<void> => {
  await resetProxy(proxyUrl);
  if (proxyRatio !== undefined) {
    await setProxyRatio(proxyUrl, proxyRatio);
  }
  await resetAllInstances(instanceUrls, configPreset);
};
