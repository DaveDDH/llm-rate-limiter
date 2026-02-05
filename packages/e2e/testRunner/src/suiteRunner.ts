/**
 * Test suite runner
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ConfigPresetName } from './resetInstance.js';
import { StateAggregator } from './stateAggregator.js';
import {
  type Job,
  initializeSuite,
  sendDelayedJobs,
  sendJobsInParallelMode,
  sendJobsSequentially,
} from './suiteHelpers.js';
import { TestDataCollector } from './testDataCollector.js';
import { sleep } from './testUtils.js';

const ZERO = 0;
const SLEEP_AFTER_SEND_MS = 200;
const DEFAULT_WAIT_TIMEOUT_MS = 30000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_DELAYED_JOBS_DELAY_MS = 500;

/** Configuration for a test suite run */
export interface SuiteConfig {
  suiteName: string;
  proxyUrl: string;
  instanceUrls: string[];
  jobs: Array<{ jobId: string; jobType: string; payload: Record<string, unknown> }>;
  waitTimeoutMs?: number;
  saveToFile?: boolean;
  proxyRatio?: string;
  waitForMinuteBoundary?: boolean;
  sendJobsInParallel?: boolean;
  delayedJobs?: Array<{ jobId: string; jobType: string; payload: Record<string, unknown> }>;
  delayedJobsDelayMs?: number;
  configPreset?: ConfigPresetName;
}

/** Get the directory of this module */
const getCurrentDir = (): string => dirname(fileURLToPath(import.meta.url));

/** Get the default output directory for test results */
const getOutputDir = (): string => join(getCurrentDir(), '../../testResults/src/data');

/** Generate output file path for a suite */
const getOutputPath = (suiteName: string): string => join(getOutputDir(), `${suiteName}.json`);

/** Log message to stdout */
const logMessage = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

/** Wait until the next minute boundary */
const waitUntilNextMinute = async (): Promise<void> => {
  const now = new Date();
  const secondsUntilNextMinute = SECONDS_PER_MINUTE - now.getSeconds();
  const msUntilNextMinute = secondsUntilNextMinute * MS_PER_SECOND - now.getMilliseconds();
  if (msUntilNextMinute > ZERO) {
    logMessage(`[Suite] Waiting ${msUntilNextMinute}ms until next minute boundary...`);
    await sleep(msUntilNextMinute);
    logMessage(`[Suite] Minute boundary reached, proceeding...`);
  }
};

/** Create collector with event handler */
const createCollector = (
  instanceUrls: string[],
  aggregator: StateAggregator
): { collector: TestDataCollector; setCollectorRef: (ref: TestDataCollector) => void } => {
  let collectorRef: TestDataCollector | null = null;

  const eventHandler = (event: { type: string; jobId: string }): void => {
    if (collectorRef === null) {
      return;
    }
    aggregator
      .fetchState()
      .then((states) => {
        collectorRef?.addSnapshot(`${event.type}:${event.jobId}`, states);
      })
      .catch(() => {
        // Ignore snapshot errors
      });
  };

  const collector = new TestDataCollector(instanceUrls, { onJobEvent: eventHandler });
  collectorRef = collector;

  return {
    collector,
    setCollectorRef: (ref: TestDataCollector) => {
      collectorRef = ref;
    },
  };
};

/** Send jobs config */
interface SendJobsConfig {
  jobs: Job[];
  delayedJobs: Job[];
  delayedJobsDelayMs: number;
  proxyUrl: string;
  collector: TestDataCollector;
  sendInParallel: boolean;
}

/** Send jobs based on configuration */
const sendAllJobs = async (cfg: SendJobsConfig): Promise<void> => {
  if (cfg.sendInParallel) {
    await sendJobsInParallelMode(cfg.jobs, cfg.proxyUrl, cfg.collector);
  } else {
    await sendJobsSequentially(cfg.jobs, cfg.proxyUrl, cfg.collector);
  }
  await sendDelayedJobs(cfg.delayedJobs, cfg.delayedJobsDelayMs, cfg.proxyUrl, cfg.collector);
};

/** Wait for jobs and collect final state */
const waitAndCollectFinal = async (
  aggregator: StateAggregator,
  collector: TestDataCollector,
  waitTimeoutMs: number
): Promise<void> => {
  await sleep(SLEEP_AFTER_SEND_MS);
  const afterSendStates = await aggregator.fetchState();
  collector.addSnapshot('after-sending-jobs', afterSendStates);

  try {
    await aggregator.waitForNoActiveJobs({ timeoutMs: waitTimeoutMs });
  } catch {
    // Timeout is not fatal
  }

  const finalStates = await aggregator.fetchState();
  collector.addSnapshot('final', finalStates);
};

/** Save data to file if requested */
const saveDataIfRequested = async (
  collector: TestDataCollector,
  suiteName: string,
  saveToFile: boolean
): Promise<void> => {
  if (saveToFile) {
    const filePath = getOutputPath(suiteName);
    await mkdir(dirname(filePath), { recursive: true });
    await collector.saveToFile(filePath);
  }
};

/** Run a test suite */
export const runSuite = async (config: SuiteConfig): Promise<TestData> => {
  const {
    suiteName,
    proxyUrl,
    instanceUrls,
    jobs,
    waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
    saveToFile = true,
    proxyRatio,
    waitForMinuteBoundary = false,
    sendJobsInParallel = false,
    delayedJobs = [],
    delayedJobsDelayMs = DEFAULT_DELAYED_JOBS_DELAY_MS,
    configPreset,
  } = config;

  await initializeSuite(proxyUrl, instanceUrls, proxyRatio, configPreset);

  const aggregator = new StateAggregator(instanceUrls);
  const { collector } = createCollector(instanceUrls, aggregator);

  await collector.startEventListeners();
  const initialStates = await aggregator.fetchState();
  collector.addSnapshot('initial', initialStates);

  if (waitForMinuteBoundary) {
    await waitUntilNextMinute();
  }

  await sendAllJobs({
    jobs,
    delayedJobs,
    delayedJobsDelayMs,
    proxyUrl,
    collector,
    sendInParallel: sendJobsInParallel,
  });
  await waitAndCollectFinal(aggregator, collector, waitTimeoutMs);

  collector.stopEventListeners();
  const data = collector.getData();

  await saveDataIfRequested(collector, suiteName, saveToFile);

  return data;
};

// Re-export job generation utilities
export {
  generateJobsOfType,
  generateRandomJobs,
  getRandomJobType,
  JOB_TYPES,
  type GeneratedJob,
  type JobGenerationOptions,
} from './jobGenerators.js';
