/**
 * Tests for distributed rate limiting with multiple rate limiter instances.
 * Verifies that multiple instances coordinate through the distributed backend.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { Availability, AvailabilityChangeReason, BackendConfig, ModelRateLimitConfig, LLMRateLimiterInstance } from '../multiModelTypes.js';
import { createConnectedLimiters, createDistributedBackend, createJobTracker } from './distributedBackend.helpers.js';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const TEN = 10;
const TWENTY = 20;
const FIFTY = 50;
const HUNDRED = 100;
const MS_PER_MINUTE_PLUS_ONE = 60_001;

type InstanceArray = Array<{ limiter: LLMRateLimiterInstance; unsubscribe: () => void }>;

const createModelConfig = (estimatedTokens: number, estimatedRequests: number): ModelRateLimitConfig => ({
  requestsPerMinute: HUNDRED,
  tokensPerMinute: HUNDRED * TEN,
  resourcesPerEvent: { estimatedNumberOfRequests: estimatedRequests, estimatedUsedTokens: estimatedTokens },
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

const createLimiterWithBackend = (backend: BackendConfig): LLMRateLimiterInstance =>
  createLLMRateLimiter({ backend, models: { default: createModelConfig(TEN, ONE) } });

const cleanupInstances = (instances: InstanceArray): void => {
  for (const { limiter, unsubscribe } of instances) { unsubscribe(); limiter.stop(); }
};

describe('distributed - token coordination', () => {
  it('should coordinate token usage across instances', async () => {
    const distributedBackend = createDistributedBackend({ tokensPerMinute: HUNDRED, requestsPerMinute: TEN, estimatedTokensPerRequest: TEN });
    const instances = createConnectedLimiters(TWO, distributedBackend, createLimiterWithBackend);
    const [instance1, instance2] = instances;
    if (instance1 === undefined || instance2 === undefined) { throw new Error('Instances not created'); }
    await instance1.limiter.queueJob({ jobId: 'job1', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: TWENTY, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: TWENTY, output: ZERO, cached: ZERO } }; } });
    expect(distributedBackend.getStats().totalAcquires).toBe(ONE);
    await instance2.limiter.queueJob({ jobId: 'job2', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: TWENTY, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: TWENTY, output: ZERO, cached: ZERO } }; } });
    expect(distributedBackend.getStats().totalAcquires).toBe(TWO);
    expect(distributedBackend.getAvailability().tokensPerMinute).toBe(HUNDRED - TWENTY);
    cleanupInstances(instances);
  });

  it('should reject when combined usage exceeds limit', async () => {
    const distributedBackend = createDistributedBackend({ tokensPerMinute: FIFTY, requestsPerMinute: TEN, estimatedTokensPerRequest: TEN });
    const instances = createConnectedLimiters(TWO, distributedBackend, (backend) =>
      createLLMRateLimiter({ backend, models: { default: createModelConfig(FIFTY, ONE) } })
    );
    const [instance1, instance2] = instances;
    if (instance1 === undefined || instance2 === undefined) { throw new Error('Instances not created'); }
    await instance1.limiter.queueJob({ jobId: 'job1', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: FIFTY, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: FIFTY, output: ZERO, cached: ZERO } }; } });
    const jobPromise = instance2.limiter.queueJob({ jobId: 'job2', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: FIFTY, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: FIFTY, output: ZERO, cached: ZERO } }; } });
    await expect(jobPromise).rejects.toThrow('All models rejected by backend');
    cleanupInstances(instances);
  });

  it('should refund unused tokens on release', async () => {
    const distributedBackend = createDistributedBackend({ tokensPerMinute: HUNDRED, requestsPerMinute: TEN, estimatedTokensPerRequest: FIFTY });
    const instances = createConnectedLimiters(ONE, distributedBackend, (backend) =>
      createLLMRateLimiter({ backend, models: { default: createModelConfig(FIFTY, ONE) } })
    );
    const [instance] = instances;
    if (instance === undefined) { throw new Error('Instance not created'); }
    await instance.limiter.queueJob({ jobId: 'job1', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } }; } });
    expect(distributedBackend.getAvailability().tokensPerMinute).toBe(HUNDRED - TEN);
    cleanupInstances(instances);
  });
});

describe('distributed - availability notifications', () => {
  it('should notify all instances when availability changes', async () => {
    const distributedBackend = createDistributedBackend({ tokensPerMinute: HUNDRED, requestsPerMinute: TEN, estimatedTokensPerRequest: TEN });
    const availabilityChanges: Array<{ instanceId: number; reason: AvailabilityChangeReason }> = [];
    const instances = createConnectedLimiters(THREE, distributedBackend, (backend, instanceId) =>
      createLLMRateLimiter({
        backend, models: { default: createModelConfig(TEN, ONE) },
        onAvailableSlotsChange: (_, reason) => { availabilityChanges.push({ instanceId, reason }); },
      })
    );
    const [instance1] = instances;
    if (instance1 === undefined) { throw new Error('Instance not created'); }
    await instance1.limiter.queueJob({ jobId: 'trigger-change', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } }; } });
    const distributedChanges = availabilityChanges.filter((c) => c.reason === 'distributed');
    const uniqueInstances = new Set(distributedChanges.map((c) => c.instanceId));
    expect(uniqueInstances.size).toBe(THREE);
    cleanupInstances(instances);
  });
});

describe('distributed - time window reset', () => {
  it('should allow jobs after time window resets', async () => {
    const distributedBackend = createDistributedBackend({ tokensPerMinute: FIFTY, requestsPerMinute: TWO, estimatedTokensPerRequest: TWENTY });
    const instances = createConnectedLimiters(ONE, distributedBackend, (backend) =>
      createLLMRateLimiter({ backend, models: { default: createModelConfig(TWENTY, ONE) } })
    );
    const [instance] = instances;
    if (instance === undefined) { throw new Error('Instance not created'); }
    await instance.limiter.queueJob({ jobId: 'job1', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: TWENTY, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: TWENTY, output: ZERO, cached: ZERO } }; } });
    await instance.limiter.queueJob({ jobId: 'job2', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: TWENTY, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: TWENTY, output: ZERO, cached: ZERO } }; } });
    expect(distributedBackend.getAvailability().requestsPerMinute).toBe(ZERO);
    distributedBackend.advanceTime(MS_PER_MINUTE_PLUS_ONE);
    const afterReset = distributedBackend.getAvailability();
    expect(afterReset.requestsPerMinute).toBe(TWO);
    expect(afterReset.tokensPerMinute).toBe(FIFTY);
    await instance.limiter.queueJob({ jobId: 'job3', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } }; } });
    expect(distributedBackend.getStats().totalAcquires).toBe(THREE);
    cleanupInstances(instances);
  });
});

describe('distributed - setDistributedAvailability pub/sub', () => {
  it('should update limiter availability when backend pushes update', () => {
    const receivedAvailabilities: Availability[] = [];
    const limiter = createLLMRateLimiter({
      models: { default: createModelConfig(TEN, ONE) },
      onAvailableSlotsChange: (availability, reason) => { if (reason === 'distributed') { receivedAvailabilities.push(availability); } },
    });
    limiter.setDistributedAvailability({ slots: FIFTY, tokensPerMinute: HUNDRED, requestsPerMinute: TEN });
    expect(receivedAvailabilities).toHaveLength(ONE);
    expect(receivedAvailabilities[ZERO]?.slots).toBe(FIFTY);
    expect(receivedAvailabilities[ZERO]?.tokensPerMinute).toBe(HUNDRED);
    limiter.stop();
  });

  it('should propagate availability to all subscribed limiters', () => {
    const distributedBackend = createDistributedBackend({ tokensPerMinute: HUNDRED, requestsPerMinute: TEN, estimatedTokensPerRequest: TEN });
    const receivedByInstance = new Map<number, Availability[]>();
    const instances = createConnectedLimiters(THREE, distributedBackend, (backend, instanceId) => {
      receivedByInstance.set(instanceId, []);
      return createLLMRateLimiter({
        backend, models: { default: createModelConfig(TEN, ONE) },
        onAvailableSlotsChange: (availability, reason) => { if (reason === 'distributed') { receivedByInstance.get(instanceId)?.push(availability); } },
      });
    });
    distributedBackend.reset();
    for (const [, received] of receivedByInstance) {
      expect(received.length).toBeGreaterThanOrEqual(ONE);
      const [last] = received.slice(received.length - ONE);
      expect(last?.tokensPerMinute).toBe(HUNDRED);
    }
    cleanupInstances(instances);
  });
});

describe('distributed - request refund on release', () => {
  it('should refund unused requests when actual < estimated', async () => {
    const ESTIMATED_REQUESTS = TWO;
    const distributedBackend = createDistributedBackend({ tokensPerMinute: HUNDRED, requestsPerMinute: TEN, estimatedTokensPerRequest: TEN });
    const instances = createConnectedLimiters(ONE, distributedBackend, (backend) =>
      createLLMRateLimiter({ backend, models: { default: { ...createModelConfig(TEN, ESTIMATED_REQUESTS) } } })
    );
    const [instance] = instances;
    if (instance === undefined) { throw new Error('Instance not created'); }
    await instance.limiter.queueJob({ jobId: 'job1', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } }; } });
    expect(distributedBackend.getStats().totalReleases).toBe(ONE);
    cleanupInstances(instances);
  });
});

describe('distributed - backend edge cases', () => {
  it('should handle getCurrentTime correctly', () => {
    const distributedBackend = createDistributedBackend({ tokensPerMinute: HUNDRED, requestsPerMinute: TEN, estimatedTokensPerRequest: TEN });
    const initialTime = distributedBackend.getCurrentTime();
    distributedBackend.advanceTime(HUNDRED);
    expect(distributedBackend.getCurrentTime()).toBe(initialTime + HUNDRED);
  });

  it('should handle release for a model that was reset', async () => {
    const distributedBackend = createDistributedBackend({ tokensPerMinute: HUNDRED, requestsPerMinute: TEN, estimatedTokensPerRequest: TEN });
    const instances = createConnectedLimiters(ONE, distributedBackend, createLimiterWithBackend);
    const [instance] = instances;
    if (instance === undefined) { throw new Error('Instance not created'); }
    await instance.limiter.queueJob({ jobId: 'job1', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: ZERO }); return { requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } }; } });
    distributedBackend.reset();
    expect(distributedBackend.getStats().totalAcquires).toBe(ZERO);
    cleanupInstances(instances);
  });
});

describe('distributed - job tracker', () => {
  it('should track completed jobs', () => {
    const tracker = createJobTracker();
    tracker.trackComplete(ZERO, TEN);
    expect(tracker.completed).toBe(ONE);
    expect(tracker.totalTokens).toBe(TEN);
  });

  it('should track failed jobs with Error objects', () => {
    const tracker = createJobTracker();
    tracker.trackFailed(new Error('test error'));
    expect(tracker.failed).toBe(ONE);
    expect(tracker.errors).toHaveLength(ONE);
  });

  it('should handle non-Error objects in trackFailed', () => {
    const tracker = createJobTracker();
    tracker.trackFailed('string error');
    expect(tracker.failed).toBe(ONE);
    expect(tracker.errors).toHaveLength(ZERO);
  });
});
