import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { cleanupRedis } from './redisCleanup.js';
import { StateAggregator } from './stateAggregator.js';
import { TestDataCollector } from './testDataCollector.js';
import { createJobs, log, logError, sendJob, sleep, summarizeResults } from './testUtils.js';

const REDIS_URL = 'redis://localhost:6379';
const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];
const NUM_JOBS = 10;
const EXIT_FAILURE = 1;
const ZERO = 0;

// Output file for test data
const OUTPUT_DIR = './test-results';
const getOutputFilePath = (): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${OUTPUT_DIR}/test-run-${timestamp}.json`;
};

const JOB_TYPES = ['summary', 'VacationPlanning', 'ImageCreation', 'BudgetCalculation', 'WeatherForecast'];

const getRandomJobType = (): string => {
  const randomIndex = Math.floor(Math.random() * JOB_TYPES.length);
  return JOB_TYPES[randomIndex] ?? 'summary';
};

const runTests = async (): Promise<void> => {
  log('=== E2E Test Runner ===');
  log(`Proxy URL: ${PROXY_URL}`);
  log(`Instance URLs: ${INSTANCE_URLS.join(', ')}`);
  log('');

  // Clean Redis before starting
  log('Cleaning Redis state...');
  const cleanupResult = await cleanupRedis({ url: REDIS_URL });
  log(`Cleaned ${cleanupResult.totalKeysDeleted} keys in ${cleanupResult.durationMs}ms`);
  for (const [prefix, count] of Object.entries(cleanupResult.keysPerPrefix)) {
    if (count > ZERO) {
      log(`  - ${prefix}*: ${count} keys`);
    }
  }
  log('');

  // Initialize collectors
  const aggregator = new StateAggregator(INSTANCE_URLS);
  const collector = new TestDataCollector(INSTANCE_URLS);

  // Start listening to SSE events
  log('Starting event listeners...');
  await collector.startEventListeners();

  // Take initial snapshot
  log('Taking initial state snapshot...');
  const initialStates = await aggregator.fetchState();
  collector.addSnapshot('initial', initialStates);

  log(`Found ${initialStates.length} instances:`);
  for (const state of initialStates) {
    log(`  - ${state.instanceId}: ${state.activeJobs.length} active jobs`);
  }

  // Send jobs via proxy
  log('');
  log(`=== Sending ${NUM_JOBS} Jobs via Proxy ===`);

  const jobs = [];
  for (let i = ZERO; i < NUM_JOBS; i++) {
    jobs.push({
      jobId: `test-job-${Date.now()}-${i}`,
      jobType: getRandomJobType(),
      payload: { testData: `Test payload for job ${i}` },
    });
  }

  const results = [];
  for (const job of jobs) {
    // Record job being sent
    collector.recordJobSent(job.jobId, job.jobType, PROXY_URL);

    const result = await sendJob(PROXY_URL, job);
    results.push(result);

    if (result.success) {
      log(`[OK] Job ${result.jobId} queued`);
    } else {
      logError(`[FAIL] Job ${result.jobId}: ${result.error}`);
    }
  }

  // Take snapshot after sending jobs
  await sleep(200);
  const afterSendStates = await aggregator.fetchState();
  collector.addSnapshot('after-sending-jobs', afterSendStates);

  log('');
  const summary = summarizeResults(results);
  log(`Sent: ${summary.total} | Successful: ${summary.successful} | Failed: ${summary.failed}`);

  // Wait for jobs to complete
  log('');
  log('Waiting for jobs to complete...');
  try {
    await aggregator.waitForNoActiveJobs({ timeoutMs: 30000 });
    log('All jobs completed!');
  } catch (error) {
    logError(`Timeout: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Take final snapshot
  const finalStates = await aggregator.fetchState();
  collector.addSnapshot('final', finalStates);

  // Stop event listeners
  collector.stopEventListeners();

  // Get collected data summary
  const data = await collector.getData();
  log('');
  log('=== Data Collection Summary ===');
  log(`Duration: ${data.durationMs}ms`);
  log(`Events captured: ${data.summary.totalEventsReceived}`);
  log(`Snapshots taken: ${data.summary.totalSnapshots}`);
  log(`Jobs sent: ${data.summary.totalJobsSent}`);

  // Log event breakdown
  const eventTypes = new Map<string, number>();
  for (const event of data.events) {
    const type = (event.event as { type?: string })?.type ?? 'unknown';
    eventTypes.set(type, (eventTypes.get(type) ?? 0) + 1);
  }
  log('Event breakdown:');
  for (const [type, count] of eventTypes) {
    log(`  - ${type}: ${count}`);
  }

  // Log job history summary
  log('Job history per instance:');
  for (const history of data.jobHistory) {
    log(
      `  - ${history.instanceId}: ${history.summary.completed} completed, ${history.summary.failed} failed`
    );
  }

  // Save to file
  const outputPath = getOutputFilePath();
  await mkdir(dirname(outputPath), { recursive: true });
  await collector.saveToFile(outputPath);
  log('');
  log(`Test data saved to: ${outputPath}`);

  log('');
  log('=== Test Complete ===');
};

runTests().catch((error: unknown) => {
  logError(`Test runner failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT_FAILURE);
});
