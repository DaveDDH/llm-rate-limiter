/**
 * Job-related helper functions for maxWaitMS e2e tests.
 * Provides utilities for creating and controlling jobs.
 */
import type { LLMRateLimiterInstance } from '@llm-rate-limiter/core';
import { EventEmitter, once } from 'node:events';

import type { TestJobType } from './maxWaitMS.helpers.js';

// =============================================================================
// Constants
// =============================================================================

const ZERO = 0;
const ONE = 1;

// =============================================================================
// Types
// =============================================================================

/** Result from a queued job */
export interface JobResult {
  success: boolean;
  modelUsed?: string;
  error?: Error;
  waitedMs: number;
}

/** Controllable job that can be completed externally */
export interface ControllableJob {
  complete: () => void;
  fail: (error: Error) => void;
  jobPromise: Promise<JobResult>;
  jobId: string;
}

// =============================================================================
// Deferred Promise
// =============================================================================

/** Deferred promise for controlled job completion */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

/** Create a deferred promise using EventEmitter */
const createDeferred = (): Deferred => {
  const emitter = new EventEmitter();
  const state = { rejectError: undefined as Error | undefined };

  const promise = once(emitter, 'complete').then(() => {
    if (state.rejectError !== undefined) throw state.rejectError;
  });

  const resolve = (): void => {
    emitter.emit('complete');
  };

  const reject = (error: Error): void => {
    state.rejectError = error;
    emitter.emit('complete');
  };

  return { promise, resolve, reject };
};

// =============================================================================
// Job Creation
// =============================================================================

/** Convert unknown error to Error */
const toError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  return new Error(String(error));
};

/** Create the job result handler */
const createJobResultHandler = (
  startTime: number
): { onSuccess: (modelId: string) => JobResult; onError: (error: unknown) => JobResult } => ({
  onSuccess: (modelId: string): JobResult => ({
    success: true,
    modelUsed: modelId,
    waitedMs: Date.now() - startTime,
  }),
  onError: (error: unknown): JobResult => ({
    success: false,
    error: toError(error),
    waitedMs: Date.now() - startTime,
  }),
});

/** Queue a job that can be controlled externally */
export const queueControllableJob = (
  limiter: LLMRateLimiterInstance<TestJobType>,
  jobType: TestJobType,
  jobId: string
): ControllableJob => {
  const deferred = createDeferred();
  const startTime = Date.now();
  const { onSuccess, onError } = createJobResultHandler(startTime);

  const jobPromise = limiter
    .queueJob({
      jobId,
      jobType,
      job: async ({ modelId }, resolve) => {
        await deferred.promise;
        resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
      },
    })
    .then((result) => onSuccess(result.modelUsed))
    .catch(onError);

  return {
    complete: (): void => {
      deferred.resolve();
    },
    fail: (error: Error): void => {
      deferred.reject(error);
    },
    jobPromise,
    jobId,
  };
};

/** Queue multiple controllable jobs */
export const queueControllableJobs = (
  limiter: LLMRateLimiterInstance<TestJobType>,
  jobType: TestJobType,
  count: number,
  idPrefix = 'job'
): ControllableJob[] => {
  const jobs: ControllableJob[] = [];
  for (let i = ZERO; i < count; i += ONE) {
    jobs.push(queueControllableJob(limiter, jobType, `${idPrefix}-${i}`));
  }
  return jobs;
};

/** Get job promise from a controllable job */
const getJobPromise = async (job: ControllableJob): Promise<JobResult> => {
  const result = await job.jobPromise;
  return result;
};

/** Complete all jobs and wait for results */
export const completeAllJobs = async (jobs: ControllableJob[]): Promise<JobResult[]> => {
  for (const job of jobs) {
    job.complete();
  }
  const promises = jobs.map(getJobPromise);
  const results = await Promise.all(promises);
  return results;
};

// =============================================================================
// Assertions
// =============================================================================

/** Assert that a job completed successfully within expected time range */
export const assertJobSucceeded = (result: JobResult, maxExpectedWaitMs?: number): void => {
  expect(result.success).toBe(true);
  expect(result.modelUsed).toBeDefined();
  if (maxExpectedWaitMs !== undefined) {
    expect(result.waitedMs).toBeLessThanOrEqual(maxExpectedWaitMs);
  }
};

/** Assert that a job failed/was rejected */
export const assertJobFailed = (result: JobResult): void => {
  expect(result.success).toBe(false);
  expect(result.error).toBeDefined();
};
