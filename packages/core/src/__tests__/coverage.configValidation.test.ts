/**
 * Coverage tests for configValidation module.
 */
import type { InternalLimiterConfig } from '../types.js';
import {
  validateConfig,
  validateMemoryLimits,
  validateRequestLimits,
  validateTokenLimits,
} from '../utils/configValidation.js';
import { FIFTY, HUNDRED, ONE, RATIO_HALF, ZERO } from './coverage.helpers.js';

describe('configValidation - request limits', () => {
  it('should throw when requestsPerMinute is set without estimatedNumberOfRequests', () => {
    const config: InternalLimiterConfig = { requestsPerMinute: HUNDRED };
    expect(() => {
      validateRequestLimits(config, undefined);
    }).toThrow('resourcesPerEvent.estimatedNumberOfRequests is required');
  });

  it('should throw when requestsPerDay is set without estimatedNumberOfRequests', () => {
    const config: InternalLimiterConfig = { requestsPerDay: HUNDRED };
    expect(() => {
      validateRequestLimits(config, { estimatedNumberOfRequests: ZERO });
    }).toThrow('resourcesPerEvent.estimatedNumberOfRequests is required');
  });
});

describe('configValidation - token limits', () => {
  it('should throw when tokensPerMinute is set without estimatedUsedTokens', () => {
    const config: InternalLimiterConfig = { tokensPerMinute: HUNDRED };
    expect(() => {
      validateTokenLimits(config, undefined);
    }).toThrow('resourcesPerEvent.estimatedUsedTokens is required');
  });

  it('should throw when tokensPerDay is set without estimatedUsedTokens', () => {
    const config: InternalLimiterConfig = { tokensPerDay: HUNDRED };
    expect(() => {
      validateTokenLimits(config, { estimatedUsedTokens: ZERO });
    }).toThrow('resourcesPerEvent.estimatedUsedTokens is required');
  });
});

describe('configValidation - memory limits', () => {
  it('should throw when memory is set without estimatedUsedMemoryKB', () => {
    const config: InternalLimiterConfig = { memory: { freeMemoryRatio: RATIO_HALF } };
    expect(() => {
      validateMemoryLimits(config, undefined);
    }).toThrow('resourcesPerEvent.estimatedUsedMemoryKB is required');
  });

  it('should throw when memory is set with zero estimatedUsedMemoryKB', () => {
    const config: InternalLimiterConfig = { memory: { freeMemoryRatio: RATIO_HALF } };
    expect(() => {
      validateMemoryLimits(config, { estimatedUsedMemoryKB: ZERO });
    }).toThrow('resourcesPerEvent.estimatedUsedMemoryKB is required');
  });
});

describe('configValidation - validateConfig', () => {
  it('should pass validateConfig with valid config', () => {
    const config: InternalLimiterConfig = {
      requestsPerMinute: HUNDRED,
      tokensPerMinute: HUNDRED,
      resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: FIFTY },
    };
    expect(() => {
      validateConfig(config);
    }).not.toThrow();
  });
});
