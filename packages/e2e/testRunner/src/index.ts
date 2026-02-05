/**
 * Standalone E2E test runner for manual execution.
 * For Jest-based tests, see __tests__/ directory.
 */
import { generateRandomJobs, runSuite } from './suiteRunner.js';
import { log, logError } from './testUtils.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];
const NUM_JOBS = 10;
const JOB_DURATION_MS = 100;
const WAIT_TIMEOUT_MS = 30000;
const EXIT_FAILURE = 1;
const ZERO = 0;
const INCREMENT = 1;

/**
 * Log event breakdown from timeline
 */
const logEventBreakdown = (timeline: Array<{ event: string }>): void => {
  const eventTypes = new Map<string, number>();
  for (const event of timeline) {
    eventTypes.set(event.event, (eventTypes.get(event.event) ?? ZERO) + INCREMENT);
  }
  log('Event breakdown:');
  for (const [type, count] of eventTypes) {
    log(`  - ${type}: ${count}`);
  }
};

/**
 * Log stats by instance
 */
const logByInstance = (byInstance: Record<string, { completed: number; failed: number }>): void => {
  log('By instance:');
  for (const [instanceId, stats] of Object.entries(byInstance)) {
    log(`  - ${instanceId}: ${stats.completed} completed, ${stats.failed} failed`);
  }
};

/**
 * Log stats by model
 */
const logByModel = (byModel: Record<string, { completed: number; failed: number }>): void => {
  log('By model:');
  for (const [modelId, stats] of Object.entries(byModel)) {
    log(`  - ${modelId}: ${stats.completed} completed, ${stats.failed} failed`);
  }
};

const runManualTest = async (): Promise<void> => {
  log('=== E2E Test Runner (Manual Mode) ===');
  log(`Proxy URL: ${PROXY_URL}`);
  log(`Instance URLs: ${INSTANCE_URLS.join(', ')}`);
  log('');

  const jobs = generateRandomJobs(NUM_JOBS, { durationMs: JOB_DURATION_MS });

  log(`Sending ${NUM_JOBS} jobs...`);
  const data = await runSuite({
    suiteName: 'manual-run',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
  });

  log('');
  log('=== Data Collection Summary ===');
  log(`Duration: ${data.metadata.durationMs}ms`);
  log(`Timeline events: ${data.timeline.length}`);
  log(`Snapshots taken: ${data.snapshots.length}`);
  log(
    `Jobs: ${data.summary.totalJobs} total, ${data.summary.completed} completed, ${data.summary.failed} failed`
  );

  if (data.summary.avgDurationMs !== null) {
    log(`Avg job duration: ${data.summary.avgDurationMs.toFixed(INCREMENT)}ms`);
  }

  logEventBreakdown(data.timeline);
  logByInstance(data.summary.byInstance);
  logByModel(data.summary.byModel);

  log('');
  log('=== Test Complete ===');
};

runManualTest().catch((error: unknown) => {
  logError(`Test runner failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT_FAILURE);
});
