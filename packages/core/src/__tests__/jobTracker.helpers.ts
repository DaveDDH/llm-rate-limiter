/**
 * Job tracking utilities for distributed rate limiting tests.
 */

const ZERO = 0;
const ONE = 1;

/** Job result tracking for load tests */
export interface JobTracker {
  completed: number;
  failed: number;
  totalTokens: number;
  totalRequests: number;
  jobsPerInstance: Map<number, number>;
  tokensPerInstance: Map<number, number>;
  errors: Error[];
  trackComplete: (instanceIndex: number, tokens: number) => void;
  trackFailed: (error: unknown) => void;
}

/** Creates a job tracker for monitoring load test results */
export const createJobTracker = (): JobTracker => {
  const tracker: JobTracker = {
    completed: ZERO,
    failed: ZERO,
    totalTokens: ZERO,
    totalRequests: ZERO,
    jobsPerInstance: new Map<number, number>(),
    tokensPerInstance: new Map<number, number>(),
    errors: [],
    trackComplete: (idx: number, tokens: number): void => {
      tracker.completed += ONE;
      tracker.totalTokens += tokens;
      tracker.totalRequests += ONE;
      tracker.jobsPerInstance.set(idx, (tracker.jobsPerInstance.get(idx) ?? ZERO) + ONE);
      tracker.tokensPerInstance.set(idx, (tracker.tokensPerInstance.get(idx) ?? ZERO) + tokens);
    },
    trackFailed: (error: unknown): void => {
      tracker.failed += ONE;
      if (error instanceof Error) {
        tracker.errors.push(error);
      }
    },
  };
  return tracker;
};
