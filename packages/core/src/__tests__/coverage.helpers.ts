/**
 * Shared helpers for coverage tests.
 */
import type { LLMRateLimiterStats } from '../multiModelTypes.js';
import type { InternalLimiterStats } from '../types.js';

export const ZERO = 0;
export const ONE = 1;
export const TEN = 10;
export const FIFTY = 50;
export const HUNDRED = 100;
export const THOUSAND = 1000;
export const DELAY_SHORT = 10;
export const RATIO_LOW = 0.001;
export const RATIO_TENTH = 0.1;
export const RATIO_HALF = 0.5;

export const createMockStats = (overrides: Partial<InternalLimiterStats> = {}): LLMRateLimiterStats => ({
  models: {
    default: {
      tokensPerMinute: { current: ZERO, limit: HUNDRED, remaining: HUNDRED, resetsInMs: THOUSAND },
      ...overrides,
    },
  },
});
