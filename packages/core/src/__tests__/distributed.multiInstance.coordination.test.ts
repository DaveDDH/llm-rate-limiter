/**
 * Tests for distributed rate limiting - token coordination across instances.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import {
  FIFTY,
  HUNDRED,
  ONE,
  TEN,
  TWENTY,
  TWO,
  cleanupInstances,
  createLimiterWithBackend,
  createModelConfig,
  createSimpleJob,
} from './distributed.multiInstance.helpers.js';
import { createConnectedLimiters, createDistributedBackend } from './distributedBackend.helpers.js';

describe('distributed - coordinate token usage', () => {
  it('should coordinate token usage across instances', async () => {
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: HUNDRED,
      requestsPerMinute: TEN,
      estimatedTokensPerRequest: TEN,
    });
    const instances = createConnectedLimiters(TWO, distributedBackend, createLimiterWithBackend);
    const [instance1, instance2] = instances;
    if (instance1 === undefined || instance2 === undefined) throw new Error('Instances not created');
    await instance1.limiter.queueJob({ jobId: 'job1', job: createSimpleJob(TWENTY) });
    expect(distributedBackend.getStats().totalAcquires).toBe(ONE);
    await instance2.limiter.queueJob({ jobId: 'job2', job: createSimpleJob(TWENTY) });
    expect(distributedBackend.getStats().totalAcquires).toBe(TWO);
    expect(distributedBackend.getAvailability().tokensPerMinute).toBe(HUNDRED - TWENTY);
    cleanupInstances(instances);
  });
});

describe('distributed - reject when exceeding limit', () => {
  it('should reject when combined usage exceeds limit', async () => {
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: FIFTY,
      requestsPerMinute: TEN,
      estimatedTokensPerRequest: TEN,
    });
    const instances = createConnectedLimiters(TWO, distributedBackend, (backend) =>
      createLLMRateLimiter({ backend, models: { default: createModelConfig(FIFTY, ONE) } })
    );
    const [instance1, instance2] = instances;
    if (instance1 === undefined || instance2 === undefined) throw new Error('Instances not created');
    await instance1.limiter.queueJob({ jobId: 'job1', job: createSimpleJob(FIFTY) });
    const jobPromise = instance2.limiter.queueJob({ jobId: 'job2', job: createSimpleJob(FIFTY) });
    await expect(jobPromise).rejects.toThrow('All models rejected by backend');
    cleanupInstances(instances);
  });
});

describe('distributed - token refund', () => {
  it('should refund unused tokens on release', async () => {
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: HUNDRED,
      requestsPerMinute: TEN,
      estimatedTokensPerRequest: FIFTY,
    });
    const instances = createConnectedLimiters(ONE, distributedBackend, (backend) =>
      createLLMRateLimiter({ backend, models: { default: createModelConfig(FIFTY, ONE) } })
    );
    const [instance] = instances;
    if (instance === undefined) throw new Error('Instance not created');
    await instance.limiter.queueJob({ jobId: 'job1', job: createSimpleJob(TEN) });
    expect(distributedBackend.getAvailability().tokensPerMinute).toBe(HUNDRED - TEN);
    cleanupInstances(instances);
  });
});
