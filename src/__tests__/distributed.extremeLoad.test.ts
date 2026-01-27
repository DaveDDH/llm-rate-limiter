/**
 * Extreme load tests for distributed rate limiting.
 * These tests validate that the rate limiter NEVER exceeds limits under any conditions.
 * If these tests pass, the distributed rate limiting implementation is correct.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance, ModelRateLimitConfig } from '../multiModelTypes.js';
import { createConnectedLimiters, createDistributedBackend, createJobTracker, type DistributedBackendInstance, type JobTracker } from './distributedBackend.helpers.js';

const ZERO = 0;
const ONE = 1;
const THREE = 3;
const FIVE = 5;
const TEN = 10;
const TWENTY = 20;
const FIFTY = 50;
const HUNDRED = 100;
const TWO_HUNDRED = 200;
const FIVE_HUNDRED = 500;
const THOUSAND = 1000;
const TWO_THOUSAND = 2000;
const FIVE_THOUSAND = 5000;
const TEN_THOUSAND = 10000;
const MS_PER_MINUTE = 60_000;
const EXTREME_TEST_TIMEOUT = 60_000;

type InstanceArray = Array<{ limiter: LLMRateLimiterInstance; unsubscribe: () => void }>;
interface JobConfig { getTokens: () => number; getDelay: () => number; }

const createModelConfig = (estimatedTokens: number): ModelRateLimitConfig => ({
  requestsPerMinute: TEN_THOUSAND, tokensPerMinute: TEN_THOUSAND * TEN,
  resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: estimatedTokens },
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

const cleanupInstances = (instances: InstanceArray): void => {
  for (const { limiter, unsubscribe } of instances) { unsubscribe(); limiter.stop(); }
};

const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + ONE)) + min;

const fireSimultaneousJobs = async (instances: InstanceArray, jobsPerInstance: number, config: JobConfig, tracker: JobTracker): Promise<void> => {
  const allPromises: Array<Promise<void>> = [];
  for (let i = ZERO; i < instances.length; i += ONE) {
    const { limiter } = instances[i] ?? {};
    if (limiter === undefined) { continue; }
    for (let j = ZERO; j < jobsPerInstance; j += ONE) {
      const tokens = config.getTokens();
      const delay = config.getDelay();
      const idx = i;
      const promise = limiter.queueJob({
        jobId: `i${i}-j${j}`,
        job: async ({ modelId }, resolve) => { await sleep(delay); resolve({ modelId, inputTokens: tokens, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: tokens, output: ZERO, cached: ZERO } }; },
      }).then(() => { tracker.trackComplete(idx, tokens); }).catch((error: unknown) => { tracker.trackFailed(error); });
      allPromises.push(promise);
    }
  }
  await Promise.all(allPromises);
};

const assertLimitsNeverExceeded = (stats: ReturnType<DistributedBackendInstance['getStats']>, tokensPerMinute: number, requestsPerMinute: number): void => {
  expect(stats.peakTokensPerMinute).toBeLessThanOrEqual(tokensPerMinute);
  expect(stats.peakRequestsPerMinute).toBeLessThanOrEqual(requestsPerMinute);
};

const assertJobAccountingCorrect = (tracker: JobTracker, totalJobs: number, stats: ReturnType<DistributedBackendInstance['getStats']>): void => {
  expect(tracker.completed + tracker.failed).toBe(totalJobs);
  expect(stats.totalAcquires).toBe(tracker.completed);
  expect(stats.totalReleases).toBe(tracker.completed);
  expect(stats.rejections).toBe(tracker.failed);
};

describe('extreme load - simultaneous burst from many instances', () => {
  it('should NEVER exceed limits when 10 instances fire 100 jobs each simultaneously', async () => {
    const TPM = THOUSAND;
    const RPM = HUNDRED;
    const INST = TEN;
    const JPI = HUNDRED;
    const TPJ = TEN;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const instances = createConnectedLimiters(INST, backend, (b) => createLLMRateLimiter({ backend: b, models: { default: createModelConfig(TPJ) } }));
    const tracker = createJobTracker();
    await fireSimultaneousJobs(instances, JPI, { getTokens: () => TPJ, getDelay: () => randomInt(ONE, TEN) }, tracker);
    const stats = backend.getStats();
    assertLimitsNeverExceeded(stats, TPM, RPM);
    assertJobAccountingCorrect(tracker, INST * JPI, stats);
    expect(tracker.completed).toBe(RPM);
    cleanupInstances(instances);
  }, EXTREME_TEST_TIMEOUT);
});

describe('extreme load - variable job sizes under pressure', () => {
  it('should NEVER exceed limits with random token sizes between 1 and 100', async () => {
    const TPM = FIVE_HUNDRED;
    const RPM = FIFTY;
    const INST = FIVE;
    const JPI = TWO_HUNDRED;
    const AVG = FIFTY;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: AVG });
    const instances = createConnectedLimiters(INST, backend, (b) => createLLMRateLimiter({ backend: b, models: { default: createModelConfig(AVG) } }));
    const tracker = createJobTracker();
    await fireSimultaneousJobs(instances, JPI, { getTokens: () => randomInt(ONE, HUNDRED), getDelay: () => randomInt(ONE, FIVE) }, tracker);
    const stats = backend.getStats();
    assertLimitsNeverExceeded(stats, TPM, RPM);
    assertJobAccountingCorrect(tracker, INST * JPI, stats);
    expect(tracker.failed).toBeGreaterThan(ZERO);
    cleanupInstances(instances);
  }, EXTREME_TEST_TIMEOUT);
});

describe('extreme load - sustained pressure across time windows', () => {
  it('should correctly reset and enforce limits across 3 time windows', async () => {
    const TPM = TWO_HUNDRED;
    const RPM = TWENTY;
    const INST = THREE;
    const JPW = FIFTY;
    const TPJ = TEN;
    const WINDOWS = THREE;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const instances = createConnectedLimiters(INST, backend, (b) => createLLMRateLimiter({ backend: b, models: { default: createModelConfig(TPJ) } }));
    let totalCompleted = ZERO;
    const runWindow = async (): Promise<number> => {
      const t = createJobTracker();
      await fireSimultaneousJobs(instances, Math.floor(JPW / INST), { getTokens: () => TPJ, getDelay: () => ONE }, t);
      assertLimitsNeverExceeded(backend.getStats(), TPM, RPM);
      return t.completed;
    };
    totalCompleted += await runWindow();
    backend.advanceTime(MS_PER_MINUTE + ONE);
    totalCompleted += await runWindow();
    backend.advanceTime(MS_PER_MINUTE + ONE);
    totalCompleted += await runWindow();
    expect(totalCompleted).toBe(RPM * WINDOWS);
    cleanupInstances(instances);
  }, EXTREME_TEST_TIMEOUT);
});

describe('extreme load - 2000 concurrent jobs from 10 instances', () => {
  it('should handle massive concurrent load without ever exceeding limits', async () => {
    const TPM = TWO_THOUSAND;
    const RPM = TWO_HUNDRED;
    const INST = TEN;
    const JPI = TWO_HUNDRED;
    const TPJ = TEN;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const instances = createConnectedLimiters(INST, backend, (b) => createLLMRateLimiter({ backend: b, models: { default: createModelConfig(TPJ) } }));
    const tracker = createJobTracker();
    await fireSimultaneousJobs(instances, JPI, { getTokens: () => TPJ, getDelay: () => randomInt(ONE, TWENTY) }, tracker);
    const stats = backend.getStats();
    assertLimitsNeverExceeded(stats, TPM, RPM);
    assertJobAccountingCorrect(tracker, INST * JPI, stats);
    expect(tracker.completed).toBe(RPM);
    expect(stats.peakRequestsPerMinute).toBe(RPM);
    cleanupInstances(instances);
  }, EXTREME_TEST_TIMEOUT);
});

describe('extreme load - token limit exhaustion before request limit', () => {
  it('should stop when token limit is reached even if request limit is not', async () => {
    const TPM = FIVE_HUNDRED;
    const RPM = THOUSAND;
    const INST = FIVE;
    const JPI = HUNDRED;
    const TPJ = FIFTY;
    const MAX_BY_TOKENS = Math.floor(TPM / TPJ);
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const instances = createConnectedLimiters(INST, backend, (b) => createLLMRateLimiter({ backend: b, models: { default: createModelConfig(TPJ) } }));
    const tracker = createJobTracker();
    await fireSimultaneousJobs(instances, JPI, { getTokens: () => TPJ, getDelay: () => ONE }, tracker);
    const stats = backend.getStats();
    assertLimitsNeverExceeded(stats, TPM, RPM);
    expect(tracker.completed).toBe(MAX_BY_TOKENS);
    expect(stats.peakTokensPerMinute).toBe(TPM);
    cleanupInstances(instances);
  }, EXTREME_TEST_TIMEOUT);
});

describe('extreme load - request limit exhaustion before token limit', () => {
  it('should stop when request limit is reached even if token limit is not', async () => {
    const TPM = FIVE_THOUSAND;
    const RPM = FIFTY;
    const INST = TEN;
    const JPI = FIFTY;
    const TPJ = ONE;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const instances = createConnectedLimiters(INST, backend, (b) => createLLMRateLimiter({ backend: b, models: { default: createModelConfig(TPJ) } }));
    const tracker = createJobTracker();
    await fireSimultaneousJobs(instances, JPI, { getTokens: () => TPJ, getDelay: () => ONE }, tracker);
    const stats = backend.getStats();
    assertLimitsNeverExceeded(stats, TPM, RPM);
    expect(tracker.completed).toBe(RPM);
    expect(stats.peakRequestsPerMinute).toBe(RPM);
    cleanupInstances(instances);
  }, EXTREME_TEST_TIMEOUT);
});

describe('extreme load - all instances competing for last slot', () => {
  it('should correctly handle race when only one slot remains', async () => {
    const TPM = HUNDRED;
    const RPM = TEN;
    const INST = TEN;
    const TPJ = TEN;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const instances = createConnectedLimiters(INST, backend, (b) => createLLMRateLimiter({ backend: b, models: { default: createModelConfig(TPJ) } }));
    const t1 = createJobTracker();
    await fireSimultaneousJobs(instances, ONE, { getTokens: () => TPJ, getDelay: () => ONE }, t1);
    expect(t1.completed).toBe(RPM);
    const t2 = createJobTracker();
    await fireSimultaneousJobs(instances, ONE, { getTokens: () => TPJ, getDelay: () => ONE }, t2);
    expect(t2.completed).toBe(ZERO);
    expect(t2.failed).toBe(INST);
    assertLimitsNeverExceeded(backend.getStats(), TPM, RPM);
    cleanupInstances(instances);
  }, EXTREME_TEST_TIMEOUT);
});

describe('extreme load - 5000 jobs stress test', () => {
  it('should handle 5000 jobs across 10 instances without any limit violations', async () => {
    const TPM = FIVE_THOUSAND;
    const RPM = FIVE_HUNDRED;
    const INST = TEN;
    const JPI = FIVE_HUNDRED;
    const TPJ = TEN;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: TPJ });
    const instances = createConnectedLimiters(INST, backend, (b) => createLLMRateLimiter({ backend: b, models: { default: createModelConfig(TPJ) } }));
    const tracker = createJobTracker();
    await fireSimultaneousJobs(instances, JPI, { getTokens: () => TPJ, getDelay: () => randomInt(ONE, TEN) }, tracker);
    const stats = backend.getStats();
    assertLimitsNeverExceeded(stats, TPM, RPM);
    assertJobAccountingCorrect(tracker, INST * JPI, stats);
    expect(tracker.completed).toBe(RPM);
    cleanupInstances(instances);
  }, EXTREME_TEST_TIMEOUT);
});

describe('extreme load - ultimate validation', () => {
  it('THE ULTIMATE TEST: 10000 jobs, 20 instances, variable sizes, multiple windows', async () => {
    const TPM = THOUSAND;
    const RPM = HUNDRED;
    const INST = TWENTY;
    const JPI = HUNDRED;
    const WINDOWS = FIVE;
    const AVG = TWENTY;
    const backend = createDistributedBackend({ tokensPerMinute: TPM, requestsPerMinute: RPM, estimatedTokensPerRequest: AVG });
    const instances = createConnectedLimiters(INST, backend, (b) => createLLMRateLimiter({ backend: b, models: { default: createModelConfig(AVG) } }));
    let grandTotal = ZERO;
    const runWindow = async (): Promise<number> => {
      backend.reset();
      const t = createJobTracker();
      await fireSimultaneousJobs(instances, JPI, { getTokens: () => randomInt(FIVE, FIFTY), getDelay: () => randomInt(ONE, TWENTY) }, t);
      assertLimitsNeverExceeded(backend.getStats(), TPM, RPM);
      expect(t.completed).toBeLessThanOrEqual(RPM);
      expect(t.completed).toBeGreaterThan(ZERO);
      return t.completed + t.failed;
    };
    grandTotal += await runWindow();
    grandTotal += await runWindow();
    grandTotal += await runWindow();
    grandTotal += await runWindow();
    grandTotal += await runWindow();
    expect(grandTotal).toBe(INST * JPI * WINDOWS);
    cleanupInstances(instances);
  }, EXTREME_TEST_TIMEOUT);
});
