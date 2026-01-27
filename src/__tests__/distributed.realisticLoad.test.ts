/**
 * Realistic load tests for distributed rate limiting.
 * Simulates real-world conditions: network latency, slow LLM jobs, concurrent pressure.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { BackendConfig, LLMRateLimiterInstance, ModelRateLimitConfig } from '../multiModelTypes.js';
import { createDistributedBackend, type DistributedBackendInstance } from './distributedBackend.helpers.js';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FIVE = 5;
const TEN = 10;
const TWENTY = 20;
const THIRTY = 30;
const FIFTY = 50;
const HUNDRED = 100;
const FIVE_HUNDRED = 500;
const THOUSAND = 1000;
const REALISTIC_TEST_TIMEOUT = 120_000;

type InstanceArray = Array<{ limiter: LLMRateLimiterInstance; unsubscribe: () => void }>;
interface LatencyConfig { acquireMinMs: number; acquireMaxMs: number; releaseMinMs: number; releaseMaxMs: number; }
interface JobConfig { minDurationMs: number; maxDurationMs: number; tokens: number; }
interface LimiterSetupConfig { count: number; backend: DistributedBackendInstance; latency: LatencyConfig; tokensPerJob: number; }

interface TestTracker {
  completed: number; failed: number; totalDurationMs: number;
  acquireLatencies: number[]; releaseLatencies: number[]; jobDurations: number[];
  trackComplete: () => void; trackFailed: () => void;
  trackAcquireLatency: (ms: number) => void; trackReleaseLatency: (ms: number) => void;
  trackJobDuration: (ms: number) => void; setTotalDuration: (ms: number) => void;
}

const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + ONE)) + min;

const createTestTracker = (): TestTracker => {
  const tracker: TestTracker = {
    completed: ZERO, failed: ZERO, totalDurationMs: ZERO,
    acquireLatencies: [], releaseLatencies: [], jobDurations: [],
    trackComplete: () => { tracker.completed += ONE; },
    trackFailed: () => { tracker.failed += ONE; },
    trackAcquireLatency: (ms) => { tracker.acquireLatencies.push(ms); },
    trackReleaseLatency: (ms) => { tracker.releaseLatencies.push(ms); },
    trackJobDuration: (ms) => { tracker.jobDurations.push(ms); },
    setTotalDuration: (ms) => { tracker.totalDurationMs = ms; },
  };
  return tracker;
};

const createModelConfig = (estimatedTokens: number): ModelRateLimitConfig => ({
  requestsPerMinute: HUNDRED, tokensPerMinute: HUNDRED * TEN,
  resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: estimatedTokens },
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

const wrapBackendWithLatency = (backend: BackendConfig, latency: LatencyConfig, tracker: TestTracker): BackendConfig => ({
  acquire: async (ctx): Promise<boolean> => {
    const ms = randomInt(latency.acquireMinMs, latency.acquireMaxMs);
    tracker.trackAcquireLatency(ms);
    await sleep(ms);
    return await backend.acquire(ctx);
  },
  release: async (ctx): Promise<void> => {
    const ms = randomInt(latency.releaseMinMs, latency.releaseMaxMs);
    tracker.trackReleaseLatency(ms);
    await sleep(ms);
    await backend.release(ctx);
  },
});

const createLatencyLimiters = (config: LimiterSetupConfig, tracker: TestTracker): InstanceArray => {
  const instances: InstanceArray = [];
  for (let i = ZERO; i < config.count; i += ONE) {
    const wrappedBackend = wrapBackendWithLatency(config.backend.backend, config.latency, tracker);
    const limiter = createLLMRateLimiter({ backend: wrappedBackend, models: { default: createModelConfig(config.tokensPerJob) } });
    const unsubscribe = config.backend.subscribe((avail) => { limiter.setDistributedAvailability(avail); });
    instances.push({ limiter, unsubscribe });
  }
  return instances;
};

const cleanupInstances = (instances: InstanceArray): void => {
  for (const { limiter, unsubscribe } of instances) { unsubscribe(); limiter.stop(); }
};

const fireSlowJobs = async (instances: InstanceArray, jpi: number, jobConfig: JobConfig, tracker: TestTracker): Promise<void> => {
  const allPromises: Array<Promise<void>> = [];
  for (let i = ZERO; i < instances.length; i += ONE) {
    const { limiter } = instances[i] ?? {};
    if (limiter === undefined) { continue; }
    for (let j = ZERO; j < jpi; j += ONE) {
      const promise = limiter.queueJob({
        jobId: `i${i}-j${j}`,
        job: async ({ modelId }, resolve) => {
          const duration = randomInt(jobConfig.minDurationMs, jobConfig.maxDurationMs);
          tracker.trackJobDuration(duration);
          await sleep(duration);
          resolve({ modelId, inputTokens: jobConfig.tokens, cachedTokens: ZERO, outputTokens: ZERO });
          return { requestCount: ONE, usage: { input: jobConfig.tokens, output: ZERO, cached: ZERO } };
        },
      }).then(() => { tracker.trackComplete(); }).catch(() => { tracker.trackFailed(); });
      allPromises.push(promise);
    }
  }
  const startTime = Date.now();
  await Promise.all(allPromises);
  tracker.setTotalDuration(Date.now() - startTime);
};

const assertLimitsRespected = (stats: ReturnType<DistributedBackendInstance['getStats']>, tpm: number, rpm: number): void => {
  expect(stats.peakTokensPerMinute).toBeLessThanOrEqual(tpm);
  expect(stats.peakRequestsPerMinute).toBeLessThanOrEqual(rpm);
};

const calculateAverage = (arr: number[]): number => {
  if (arr.length === ZERO) return ZERO;
  let sum = ZERO;
  for (const val of arr) { sum += val; }
  return Math.round(sum / arr.length);
};

describe('realistic load - basic latency tests', () => {
  it('should respect limits with 10-50ms acquire latency and 50-200ms jobs', async () => {
    const TPM = HUNDRED; const RPM = TEN; const INST = THREE; const JPI = TEN; const TPJ = TEN;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const tracker = createTestTracker();
    const instances = createLatencyLimiters(
      { count: INST, backend, latency: { acquireMinMs: TEN, acquireMaxMs: FIFTY, releaseMinMs: FIVE, releaseMaxMs: TWENTY }, tokensPerJob: TPJ }, tracker
    );
    await fireSlowJobs(instances, JPI, { minDurationMs: FIFTY, maxDurationMs: HUNDRED * TWO, tokens: TPJ }, tracker);
    assertLimitsRespected(backend.getStats(), TPM, RPM);
    expect(tracker.completed).toBe(RPM);
    expect(tracker.failed).toBe(INST * JPI - RPM);
    expect(tracker.acquireLatencies.length).toBeGreaterThan(ZERO);
    cleanupInstances(instances);
  }, REALISTIC_TEST_TIMEOUT);

  it('should handle high latency backend (50-100ms acquire) under pressure', async () => {
    const TPM = FIFTY; const RPM = FIVE; const INST = FIVE; const JPI = TEN; const TPJ = TEN;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const tracker = createTestTracker();
    const instances = createLatencyLimiters(
      { count: INST, backend, latency: { acquireMinMs: FIFTY, acquireMaxMs: HUNDRED, releaseMinMs: TEN, releaseMaxMs: FIFTY }, tokensPerJob: TPJ }, tracker
    );
    await fireSlowJobs(instances, JPI, { minDurationMs: HUNDRED, maxDurationMs: HUNDRED * THREE, tokens: TPJ }, tracker);
    assertLimitsRespected(backend.getStats(), TPM, RPM);
    expect(tracker.completed).toBe(RPM);
    expect(calculateAverage(tracker.acquireLatencies)).toBeGreaterThanOrEqual(FIFTY);
    cleanupInstances(instances);
  }, REALISTIC_TEST_TIMEOUT);
});

describe('realistic load - slow LLM simulation', () => {
  it('should maintain correctness with very slow jobs (500-1000ms) simulating LLM calls', async () => {
    const TPM = FIFTY; const RPM = FIVE; const INST = TWO; const JPI = FIVE; const TPJ = TEN;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const tracker = createTestTracker();
    const instances = createLatencyLimiters(
      { count: INST, backend, latency: { acquireMinMs: TWENTY, acquireMaxMs: FIFTY, releaseMinMs: TEN, releaseMaxMs: THIRTY }, tokensPerJob: TPJ }, tracker
    );
    await fireSlowJobs(instances, JPI, { minDurationMs: FIVE_HUNDRED, maxDurationMs: THOUSAND, tokens: TPJ }, tracker);
    assertLimitsRespected(backend.getStats(), TPM, RPM);
    expect(tracker.completed).toBe(RPM);
    expect(calculateAverage(tracker.jobDurations)).toBeGreaterThanOrEqual(FIVE_HUNDRED);
    expect(tracker.totalDurationMs).toBeGreaterThanOrEqual(FIVE_HUNDRED);
    cleanupInstances(instances);
  }, REALISTIC_TEST_TIMEOUT);

  it('should handle mixed fast and slow jobs with latency', async () => {
    const TPM = HUNDRED; const RPM = TEN; const INST = THREE; const JPI = TWENTY; const TPJ = TEN; const RELEASE_WAIT = HUNDRED;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const tracker = createTestTracker();
    const instances = createLatencyLimiters(
      { count: INST, backend, latency: { acquireMinMs: FIVE, acquireMaxMs: FIFTY, releaseMinMs: FIVE, releaseMaxMs: TWENTY }, tokensPerJob: TPJ }, tracker
    );
    await fireSlowJobs(instances, JPI, { minDurationMs: TEN, maxDurationMs: HUNDRED * FIVE, tokens: TPJ }, tracker);
    await sleep(RELEASE_WAIT);
    const stats = backend.getStats();
    assertLimitsRespected(stats, TPM, RPM);
    expect(tracker.completed).toBe(RPM);
    expect(stats.totalAcquires).toBe(tracker.completed);
    expect(stats.totalReleases).toBe(tracker.completed);
    cleanupInstances(instances);
  }, REALISTIC_TEST_TIMEOUT);
});

describe('realistic load - latency tracking', () => {
  it('should track latency statistics accurately', async () => {
    const TPM = HUNDRED; const RPM = TEN; const INST = TWO; const JPI = TEN; const TPJ = TEN;
    const ACQ_MIN = TWENTY; const ACQ_MAX = FIFTY; const REL_MIN = TEN; const REL_MAX = THIRTY;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const tracker = createTestTracker();
    const instances = createLatencyLimiters(
      { count: INST, backend, latency: { acquireMinMs: ACQ_MIN, acquireMaxMs: ACQ_MAX, releaseMinMs: REL_MIN, releaseMaxMs: REL_MAX }, tokensPerJob: TPJ }, tracker
    );
    await fireSlowJobs(instances, JPI, { minDurationMs: FIFTY, maxDurationMs: HUNDRED, tokens: TPJ }, tracker);
    const avgAcquire = calculateAverage(tracker.acquireLatencies);
    const avgRelease = calculateAverage(tracker.releaseLatencies);
    expect(avgAcquire).toBeGreaterThanOrEqual(ACQ_MIN);
    expect(avgAcquire).toBeLessThanOrEqual(ACQ_MAX);
    expect(avgRelease).toBeGreaterThanOrEqual(REL_MIN);
    expect(avgRelease).toBeLessThanOrEqual(REL_MAX);
    cleanupInstances(instances);
  }, REALISTIC_TEST_TIMEOUT);
});
