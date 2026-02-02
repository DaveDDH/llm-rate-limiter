/**
 * Tests for backend - setDistributedAvailability and delegation.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { Availability, AvailabilityChangeReason, BackendReleaseContext } from '../multiModelTypes.js';
import {
  HUNDRED,
  ONE,
  TEN,
  ZERO,
  createAcquireTrueSimple,
  createDefaultConfig,
  createReleasePush,
} from './backend.helpers.js';

describe('backend - setDistributedAvailability basic', () => {
  it('should emit onAvailableSlotsChange with distributed reason', () => {
    const calls: Array<{ availability: Availability; reason: AvailabilityChangeReason }> = [];
    const limiter = createLLMRateLimiter({
      models: { default: createDefaultConfig() },
      onAvailableSlotsChange: (availability, reason) => {
        calls.push({ availability, reason });
      },
    });
    limiter.setDistributedAvailability({ slots: TEN, tokensPerMinute: HUNDRED });
    const distCall = calls.find((c) => c.reason === 'distributed');
    expect(distCall).toBeDefined();
    expect(distCall?.availability.slots).toBe(TEN);
    expect(distCall?.availability.tokensPerMinute).toBe(HUNDRED);
    expect(distCall?.availability.concurrentRequests).toBeNull();
    expect(distCall?.availability.memoryKB).toBeNull();
    limiter.stop();
  });

  it('should return early when no onAvailableSlotsChange callback', () => {
    const limiter = createLLMRateLimiter({ models: { default: createDefaultConfig() } });
    expect(() => {
      limiter.setDistributedAvailability({ slots: TEN });
    }).not.toThrow();
    limiter.stop();
  });
});

describe('backend - setDistributedAvailability optional fields', () => {
  it('should handle optional fields in DistributedAvailability', () => {
    const calls: Availability[] = [];
    const limiter = createLLMRateLimiter({
      models: { default: createDefaultConfig() },
      onAvailableSlotsChange: (availability, reason) => {
        if (reason === 'distributed') calls.push(availability);
      },
    });
    limiter.setDistributedAvailability({ slots: TEN });
    expect(calls[ZERO]?.tokensPerMinute).toBeNull();
    expect(calls[ZERO]?.tokensPerDay).toBeNull();
    expect(calls[ZERO]?.requestsPerMinute).toBeNull();
    expect(calls[ZERO]?.requestsPerDay).toBeNull();
    limiter.stop();
  });
});

describe('backend - delegation with backend', () => {
  it('should call release on delegation', async () => {
    const releaseCalls: BackendReleaseContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: { acquire: createAcquireTrueSimple(), release: createReleasePush(releaseCalls) },
      models: { modelA: createDefaultConfig(), modelB: createDefaultConfig() },
      order: ['modelA', 'modelB'],
    });
    let attempt = ZERO;
    const result = await limiter.queueJob({
      jobId: 'delegation-job',
      job: ({ modelId }, resolve, reject) => {
        attempt += ONE;
        if (attempt === ONE) {
          reject({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO }, { delegate: true });
          return { requestCount: ZERO, usage: { input: ZERO, output: ZERO, cached: ZERO } };
        }
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(result.modelUsed).toBe('modelB');
    expect(releaseCalls.length).toBeGreaterThanOrEqual(ONE);
    limiter.stop();
  });
});
