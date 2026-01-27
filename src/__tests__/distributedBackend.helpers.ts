/**
 * Dummy distributed backend for testing multi-instance rate limiting.
 * Simulates Redis-like centralized state with pub/sub notifications.
 */
import type { BackendAcquireContext, BackendConfig, BackendReleaseContext, DistributedAvailability, LLMRateLimiterInstance } from '../multiModelTypes.js';

const ZERO = 0;
const ONE = 1;
const MS_PER_MINUTE = 60_000;

/** Subscriber callback type */
export type AvailabilitySubscriber = (availability: DistributedAvailability) => void;

/** Tracked usage per model */
interface ModelUsage { tokensPerMinute: number; requestsPerMinute: number; lastResetTime: number; }

/** Configuration for the distributed backend */
export interface DistributedBackendConfig { tokensPerMinute: number; requestsPerMinute: number; estimatedTokensPerRequest: number; }

/** Statistics for monitoring the distributed backend */
export interface DistributedBackendStats {
  totalAcquires: number; totalReleases: number; totalTokensUsed: number;
  totalRequestsUsed: number; peakTokensPerMinute: number; peakRequestsPerMinute: number; rejections: number;
}

/** Return type for createDistributedBackend */
export interface DistributedBackendInstance {
  backend: BackendConfig;
  subscribe: (callback: AvailabilitySubscriber) => () => void;
  getAvailability: () => DistributedAvailability;
  getStats: () => DistributedBackendStats;
  reset: () => void;
  advanceTime: (ms: number) => void;
  getCurrentTime: () => number;
}

const createInitialStats = (): DistributedBackendStats => ({
  totalAcquires: ZERO, totalReleases: ZERO, totalTokensUsed: ZERO, totalRequestsUsed: ZERO,
  peakTokensPerMinute: ZERO, peakRequestsPerMinute: ZERO, rejections: ZERO,
});

const createUsageHelpers = (modelUsage: Map<string, ModelUsage>, getCurrentTime: () => number): {
  getOrCreate: (modelId: string) => ModelUsage;
  resetIfNeeded: (modelId: string) => void;
  getTotal: () => { tokens: number; requests: number };
} => ({
  getOrCreate: (modelId: string): ModelUsage => {
    let usage = modelUsage.get(modelId);
    if (usage === undefined) { usage = { tokensPerMinute: ZERO, requestsPerMinute: ZERO, lastResetTime: getCurrentTime() }; modelUsage.set(modelId, usage); }
    return usage;
  },
  resetIfNeeded: (modelId: string): void => {
    const usage = modelUsage.get(modelId);
    if (usage !== undefined && getCurrentTime() - usage.lastResetTime >= MS_PER_MINUTE) {
      modelUsage.set(modelId, { tokensPerMinute: ZERO, requestsPerMinute: ZERO, lastResetTime: getCurrentTime() });
    }
  },
  getTotal: (): { tokens: number; requests: number } => {
    let tokens = ZERO; let requests = ZERO;
    for (const [id] of modelUsage) { const u = modelUsage.get(id); if (u !== undefined) { tokens += u.tokensPerMinute; requests += u.requestsPerMinute; } }
    return { tokens, requests };
  },
});

const createAvailabilityCalc = (config: DistributedBackendConfig, getTotal: () => { tokens: number; requests: number }): () => DistributedAvailability =>
  (): DistributedAvailability => {
    const { tokens, requests } = getTotal();
    const availableTokens = Math.max(ZERO, config.tokensPerMinute - tokens);
    const availableRequests = Math.max(ZERO, config.requestsPerMinute - requests);
    const slotsByTokens = Math.floor(availableTokens / config.estimatedTokensPerRequest);
    return { slots: Math.min(slotsByTokens, availableRequests), tokensPerMinute: availableTokens, requestsPerMinute: availableRequests };
  };

/** Creates a dummy distributed backend that simulates centralized rate limiting. */
export const createDistributedBackend = (config: DistributedBackendConfig): DistributedBackendInstance => {
  const subscribers = new Set<AvailabilitySubscriber>();
  const modelUsage = new Map<string, ModelUsage>();
  let currentTime = Date.now();
  let stats = createInitialStats();
  const getCurrentTime = (): number => currentTime;
  const usage = createUsageHelpers(modelUsage, getCurrentTime);
  const calcAvail = createAvailabilityCalc(config, () => { for (const [id] of modelUsage) { usage.resetIfNeeded(id); } return usage.getTotal(); });
  const notify = (): void => { const avail = calcAvail(); for (const sub of subscribers) { sub(avail); } };

  const doAcquire = (ctx: BackendAcquireContext): boolean => {
    const u = usage.getOrCreate(ctx.modelId); usage.resetIfNeeded(ctx.modelId);
    const { tokens: totalT, requests: totalR } = usage.getTotal();
    if (totalT + ctx.estimated.tokens > config.tokensPerMinute || totalR + ctx.estimated.requests > config.requestsPerMinute) { stats.rejections += ONE; return false; }
    u.tokensPerMinute += ctx.estimated.tokens; u.requestsPerMinute += ctx.estimated.requests;
    stats.totalAcquires += ONE; stats.totalTokensUsed += ctx.estimated.tokens; stats.totalRequestsUsed += ctx.estimated.requests;
    const { tokens: newT, requests: newR } = usage.getTotal();
    stats.peakTokensPerMinute = Math.max(stats.peakTokensPerMinute, newT); stats.peakRequestsPerMinute = Math.max(stats.peakRequestsPerMinute, newR);
    notify(); return true;
  };

  const doRelease = (ctx: BackendReleaseContext): void => {
    const u = usage.getOrCreate(ctx.modelId); usage.resetIfNeeded(ctx.modelId);
    const tokenDiff = ctx.estimated.tokens - ctx.actual.tokens;
    const requestDiff = ctx.estimated.requests - ctx.actual.requests;
    if (tokenDiff > ZERO) { u.tokensPerMinute = Math.max(ZERO, u.tokensPerMinute - tokenDiff); }
    if (requestDiff > ZERO) { u.requestsPerMinute = Math.max(ZERO, u.requestsPerMinute - requestDiff); }
    stats.totalReleases += ONE; notify();
  };

  return {
    backend: { acquire: async (ctx): Promise<boolean> => await Promise.resolve(doAcquire(ctx)), release: async (ctx): Promise<void> => { doRelease(ctx); await Promise.resolve(); } },
    subscribe: (cb: AvailabilitySubscriber): (() => void) => { subscribers.add(cb); cb(calcAvail()); return (): void => { subscribers.delete(cb); }; },
    getAvailability: calcAvail, getStats: () => ({ ...stats }),
    reset: () => { modelUsage.clear(); stats = createInitialStats(); notify(); },
    advanceTime: (ms: number) => { currentTime += ms; notify(); }, getCurrentTime,
  };
};

/** Creates multiple rate limiter instances connected to the same distributed backend */
export const createConnectedLimiters = (
  count: number, distributedBackend: DistributedBackendInstance,
  createLimiter: (backend: BackendConfig, instanceId: number) => LLMRateLimiterInstance
): Array<{ limiter: LLMRateLimiterInstance; unsubscribe: () => void }> => {
  const instances: Array<{ limiter: LLMRateLimiterInstance; unsubscribe: () => void }> = [];
  for (let i = ZERO; i < count; i += ONE) {
    const limiter = createLimiter(distributedBackend.backend, i);
    const unsubscribe = distributedBackend.subscribe((avail) => { limiter.setDistributedAvailability(avail); });
    instances.push({ limiter, unsubscribe });
  }
  return instances;
};

/** Job result tracking for load tests */
export interface JobTracker {
  completed: number; failed: number; totalTokens: number; totalRequests: number;
  jobsPerInstance: Map<number, number>; tokensPerInstance: Map<number, number>; errors: Error[];
  trackComplete: (instanceIndex: number, tokens: number) => void;
  trackFailed: (error: unknown) => void;
}

/** Creates a job tracker for monitoring load test results */
export const createJobTracker = (): JobTracker => {
  const tracker: JobTracker = {
    completed: ZERO, failed: ZERO, totalTokens: ZERO, totalRequests: ZERO,
    jobsPerInstance: new Map<number, number>(), tokensPerInstance: new Map<number, number>(), errors: [],
    trackComplete: (idx: number, tokens: number): void => {
      tracker.completed += ONE; tracker.totalTokens += tokens; tracker.totalRequests += ONE;
      tracker.jobsPerInstance.set(idx, (tracker.jobsPerInstance.get(idx) ?? ZERO) + ONE);
      tracker.tokensPerInstance.set(idx, (tracker.tokensPerInstance.get(idx) ?? ZERO) + tokens);
    },
    trackFailed: (error: unknown): void => { tracker.failed += ONE; if (error instanceof Error) { tracker.errors.push(error); } },
  };
  return tracker;
};

