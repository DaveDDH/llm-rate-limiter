/**
 * Type guards and parsing utilities for the Redis backend.
 */
import type { AllocationInfo, DynamicLimits } from '@llm-rate-limiter/core';

import type { AllocationData, RedisBackendStats } from './types.js';

export const isObject = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null;

export const isAllocationData = (d: unknown): d is AllocationData =>
  isObject(d) &&
  'instanceCount' in d &&
  typeof d.instanceCount === 'number' &&
  'pools' in d &&
  isObject(d.pools);

export const isParsedMessage = (d: unknown): d is { instanceId: string; allocation: string } =>
  isObject(d) && 'instanceId' in d && typeof d.instanceId === 'string';

export const isRedisBackendStats = (d: unknown): d is RedisBackendStats =>
  isObject(d) && 'totalInstances' in d;

/** Validates that a single limit value is either undefined or a number */
const isValidLimitValue = (value: unknown): boolean => value === undefined || typeof value === 'number';

/** Validates a single model's limits object */
const isValidModelLimits = (limits: Record<string, unknown>): boolean =>
  isValidLimitValue(limits.tokensPerMinute) &&
  isValidLimitValue(limits.requestsPerMinute) &&
  isValidLimitValue(limits.tokensPerDay) &&
  isValidLimitValue(limits.requestsPerDay);

/** Type guard for DynamicLimits - validates structure of dynamic limits per model */
export const isDynamicLimits = (d: unknown): d is DynamicLimits => {
  if (!isObject(d)) return false;
  for (const modelLimits of Object.values(d)) {
    if (!isObject(modelLimits)) return false;
    if (!isValidModelLimits(modelLimits)) return false;
  }
  return true;
};

const DEFAULT_INSTANCE_COUNT = 1;
const defaultAlloc: AllocationInfo = {
  instanceCount: DEFAULT_INSTANCE_COUNT,
  pools: {},
};

/** Extended allocation data that may include dynamic limits */
interface AllocationDataWithLimits extends AllocationData {
  dynamicLimits?: unknown;
}

/** Extracts validated dynamic limits from parsed data */
const extractValidDynamicLimits = (parsed: AllocationDataWithLimits): DynamicLimits | undefined => {
  if ('dynamicLimits' in parsed && isDynamicLimits(parsed.dynamicLimits)) {
    return parsed.dynamicLimits;
  }
  return undefined;
};

/** Builds AllocationInfo from validated AllocationData */
const buildAllocationInfo = (parsed: AllocationData): AllocationInfo => {
  const { instanceCount, pools } = parsed;
  const dynamicLimits = extractValidDynamicLimits(parsed);
  if (dynamicLimits !== undefined) {
    return { instanceCount, pools, dynamicLimits };
  }
  return { instanceCount, pools };
};

export const parseAllocation = (json: string | null): AllocationInfo => {
  /* istanbul ignore if -- Defensive: allocation data should exist */
  if (json === null) return defaultAlloc;
  try {
    const parsed: unknown = JSON.parse(json);
    if (isAllocationData(parsed)) {
      return buildAllocationInfo(parsed);
    }
    return defaultAlloc;
  } catch {
    return defaultAlloc;
  }
};

export const ignoreError = (): void => {
  /* fire-and-forget */
};
