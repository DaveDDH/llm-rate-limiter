/**
 * Shared test setup and utilities for maxWaitMS e2e tests.
 * Extracted to reduce code duplication and keep test files small.
 */
import {
  type E2ETestState,
  type JobTypeConfig,
  cleanupInstances,
  cleanupRedis,
  cleanupTestKeys,
  createJobTypeConfig,
  createTestState,
  generateTestPrefix,
  setupRedis,
} from './maxWaitMS.helpers.js';
import { type ControllableJob, completeAllJobs } from './maxWaitMS.jobHelpers.js';

// =============================================================================
// Constants
// =============================================================================

export const ZERO = 0;
export const ONE = 1;
export const TWO = 2;
export const THREE = 3;
export const NO_WAIT = 0;
export const SHORT_WAIT_MS = 500;
export const MEDIUM_WAIT_MS = 2000;
export const LONG_WAIT_MS = 5000;
export const TOLERANCE_MS = 500;
export const DEFAULT_TIMEOUT = 30000;
export const LONG_TIMEOUT = 60000;
export const SMALL_CAPACITY = 5;
export const VERY_SHORT_TIMEOUT = 100;
export const TWO_MULTIPLIER = 2;

// =============================================================================
// Job Types Configuration Helpers
// =============================================================================

export type JobTypesConfig = Record<
  'critical' | 'lowPriority' | 'standard' | 'background',
  JobTypeConfig
>;

// Ratio constants - give critical 70% of capacity, others share 30%
const CRITICAL_RATIO = 0.7;
const OTHER_RATIO = 0.1;

/** Create job types with fail-fast (maxWaitMS: 0) for all models */
export const createFailFastJobTypes = (): JobTypesConfig => ({
  critical: createJobTypeConfig({ fastModel: NO_WAIT, slowModel: NO_WAIT, backupModel: NO_WAIT }, { initialValue: CRITICAL_RATIO }),
  lowPriority: createJobTypeConfig({ fastModel: NO_WAIT }, { initialValue: OTHER_RATIO }),
  standard: createJobTypeConfig({ fastModel: NO_WAIT }, { initialValue: OTHER_RATIO }),
  background: createJobTypeConfig({ fastModel: NO_WAIT }, { initialValue: OTHER_RATIO }),
});

/** Create job types with waiting behavior */
export const createWaitingJobTypes = (waitMs: number = LONG_WAIT_MS): JobTypesConfig => ({
  critical: createJobTypeConfig({ fastModel: waitMs }, { initialValue: CRITICAL_RATIO }),
  lowPriority: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
  standard: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
  background: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
});

/** Create job types with timeout behavior */
export const createTimeoutJobTypes = (timeoutMs: number): JobTypesConfig => ({
  critical: createJobTypeConfig({ fastModel: timeoutMs, slowModel: timeoutMs, backupModel: timeoutMs }, { initialValue: CRITICAL_RATIO }),
  lowPriority: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
  standard: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
  background: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
});

/** Create job types with mixed priorities */
export const createMixedPriorityJobTypes = (): JobTypesConfig => ({
  critical: createJobTypeConfig({ fastModel: LONG_WAIT_MS }, { initialValue: CRITICAL_RATIO }),
  lowPriority: createJobTypeConfig({ fastModel: NO_WAIT, slowModel: NO_WAIT, backupModel: NO_WAIT }, { initialValue: OTHER_RATIO }),
  standard: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
  background: createJobTypeConfig(undefined, { initialValue: OTHER_RATIO }),
});

// =============================================================================
// Test State Management
// =============================================================================

/** Create test state and setup functions */
export const createE2ETestHarness = (): {
  state: E2ETestState;
  beforeAllFn: () => Promise<void>;
  afterAllFn: () => Promise<void>;
  beforeEachFn: () => Promise<void>;
  afterEachFn: () => Promise<void>;
} => {
  const state = createTestState();

  const beforeAllFn = async (): Promise<void> => {
    await setupRedis(state);
  };

  const afterAllFn = async (): Promise<void> => {
    await cleanupRedis(state);
  };

  const beforeEachFn = async (): Promise<void> => {
    if (!state.redisAvailable) return;
    Object.assign(state, { testPrefix: generateTestPrefix() });
    await cleanupTestKeys(state);
  };

  const afterEachFn = async (): Promise<void> => {
    await cleanupInstances(state);
    if (state.redisAvailable) {
      await cleanupTestKeys(state);
    }
  };

  return { state, beforeAllFn, afterAllFn, beforeEachFn, afterEachFn };
};

// =============================================================================
// Job Array Helpers
// =============================================================================

/** Get first job from array safely */
export const getFirstJob = (jobs: ControllableJob[]): ControllableJob | undefined => {
  const [first] = jobs;
  return first;
};

/** Get second job from array safely */
export const getSecondJob = (jobs: ControllableJob[]): ControllableJob | undefined => {
  const [, second] = jobs;
  return second;
};

/** Complete first job in array if it exists */
export const completeFirstJob = (jobs: ControllableJob[]): void => {
  const first = getFirstJob(jobs);
  if (first !== undefined) {
    first.complete();
  }
};

/** Complete second job in array if it exists */
export const completeSecondJob = (jobs: ControllableJob[]): void => {
  const second = getSecondJob(jobs);
  if (second !== undefined) {
    second.complete();
  }
};

/** Get remaining jobs after first */
export const getRemainingJobs = (jobs: ControllableJob[]): ControllableJob[] => jobs.slice(ONE);

/** Get remaining jobs after second */
export const getJobsAfterSecond = (jobs: ControllableJob[]): ControllableJob[] => jobs.slice(TWO);

/** Cleanup remaining jobs */
export const cleanupRemainingJobs = async (jobs: ControllableJob[]): Promise<void> => {
  await completeAllJobs(getRemainingJobs(jobs));
};
