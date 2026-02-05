/**
 * Type definitions for rate limiter configuration presets.
 */
import type { ResourceEstimationsPerJob } from '@llm-rate-limiter/core';

export interface RateLimiterPreset {
  models: Record<
    string,
    {
      requestsPerMinute?: number;
      requestsPerDay?: number;
      tokensPerMinute?: number;
      tokensPerDay?: number;
      maxConcurrentRequests?: number;
      pricing: {
        input: number;
        cached: number;
        output: number;
      };
    }
  >;
  escalationOrder: readonly string[];
  resourceEstimations: ResourceEstimationsPerJob;
}

export type ConfigPresetName =
  | 'default'
  | 'slotCalculation'
  | 'fixedRatio'
  | 'flexibleRatio'
  | 'instanceScaling'
  | 'slotCalc-tpm'
  | 'slotCalc-rpm'
  | 'slotCalc-tpd'
  | 'slotCalc-rpd'
  | 'slotCalc-concurrent'
  | 'slotCalc-tpm-rpm'
  | 'slotCalc-multi-model'
  | 'slotCalc-ratios'
  | 'slotCalc-uneven-ratios'
  | 'slotCalc-memory'
  | 'slotCalc-tpd-rpd'
  | 'slotCalc-zero-slots'
  | 'slotCalc-rpm-limiting'
  | 'slotCalc-tpm-single';
