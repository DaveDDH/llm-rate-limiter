import type { JobResult, TokenUsageEntry } from '@llm-rate-limiter/core';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import {
  MOCK_INPUT_TOKENS,
  MOCK_OUTPUT_TOKENS,
  MOCK_REQUEST_COUNT,
  ZERO_CACHED_TOKENS,
} from './constants.js';
import { logger } from './logger.js';

const ZERO = 0;

interface JobData {
  processed: boolean;
  jobId: string;
  jobType: string;
}

/** Reject callback type matching the rate limiter's LLMJob signature */
type RejectFn = (usage: TokenUsageEntry, opts?: { delegate?: boolean }) => void;

interface ProcessJobParams {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
  modelId: string;
  reject?: RejectFn;
}

interface JobCompletionParams {
  jobId: string;
  modelUsed: string;
  totalCost: number;
}

interface JobErrorParams {
  jobId: string;
  error: Error;
  totalCost: number;
}

/** Check if payload has a numeric field */
const getPayloadNumber = (payload: Record<string, unknown>, key: string): number | undefined => {
  const { [key]: value } = payload;
  return typeof value === 'number' ? value : undefined;
};

/** Resolve actual token values from payload overrides or defaults */
const resolveTokens = (payload: Record<string, unknown>): TokenUsageEntry => ({
  inputTokens: getPayloadNumber(payload, 'actualInputTokens') ?? MOCK_INPUT_TOKENS,
  outputTokens: getPayloadNumber(payload, 'actualOutputTokens') ?? MOCK_OUTPUT_TOKENS,
  cachedTokens: getPayloadNumber(payload, 'actualCachedTokens') ?? ZERO_CACHED_TOKENS,
  requestCount: getPayloadNumber(payload, 'actualRequestCount') ?? MOCK_REQUEST_COUNT,
});

/** Type guard for objects with optional numeric fields */
interface RejectUsagePayload {
  inputTokens?: unknown;
  outputTokens?: unknown;
  cachedTokens?: unknown;
  requestCount?: unknown;
}

/** Type guard for reject usage payload */
const isRejectUsagePayload = (value: unknown): value is RejectUsagePayload =>
  typeof value === 'object' && value !== null;

/** Extract a numeric field or return zero */
const numericOrZero = (value: unknown): number => (typeof value === 'number' ? value : ZERO);

/** Check if payload contains a valid reject usage object */
const getRejectUsage = (payload: Record<string, unknown>): TokenUsageEntry | null => {
  const { rejectUsage: raw } = payload;
  if (!isRejectUsagePayload(raw)) {
    return null;
  }
  return {
    inputTokens: numericOrZero(raw.inputTokens),
    outputTokens: numericOrZero(raw.outputTokens),
    cachedTokens: numericOrZero(raw.cachedTokens),
    requestCount: numericOrZero(raw.requestCount),
  };
};

/** Simulate processing time if durationMs is specified */
const simulateProcessingTime = async (jobId: string, durationMs: number): Promise<void> => {
  if (durationMs > ZERO) {
    logger.info(`Job ${jobId} simulating ${durationMs}ms processing time`);
    await setTimeoutAsync(durationMs);
  }
};

/** Handle reject usage scenario: call reject then throw */
const handleRejectUsage = (
  jobId: string,
  rejectUsage: TokenUsageEntry,
  reject: RejectFn | undefined
): never => {
  if (reject !== undefined) {
    logger.info(`Job ${jobId} calling reject with usage`, rejectUsage);
    reject(rejectUsage);
  }
  throw new Error(`Job ${jobId} rejected with usage`);
};

export const processJob = async (params: ProcessJobParams): Promise<JobResult<JobData>> => {
  const { jobId, jobType, payload, modelId, reject } = params;

  logger.debug(`Job ${jobId} payload:`, { payload });
  logger.info(`Processing job ${jobId}`, { modelId, jobType, payload });

  const durationMs = getPayloadNumber(payload, 'durationMs') ?? ZERO;
  await simulateProcessingTime(jobId, durationMs);

  // Handle reject scenario: call reject() then throw
  const rejectUsage = getRejectUsage(payload);
  if (rejectUsage !== null) {
    handleRejectUsage(jobId, rejectUsage, reject);
  }

  // Handle error scenario: throw without reject (no capacity release)
  if (payload.shouldThrow === true) {
    throw new Error(`Job ${jobId} simulated error`);
  }

  // Normal completion: return actual usage from payload overrides or defaults
  const tokens = resolveTokens(payload);

  return {
    ...tokens,
    data: { processed: true, jobId, jobType },
  };
};

export const handleJobComplete = (params: JobCompletionParams): void => {
  const { jobId, modelUsed, totalCost } = params;
  logger.info(`Job ${jobId} completed`, { modelUsed, totalCost });
};

export const handleJobError = (params: JobErrorParams): void => {
  const { jobId, error, totalCost } = params;
  logger.error(`Job ${jobId} failed`, { error: error.message, totalCost });
};
