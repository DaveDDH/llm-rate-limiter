/**
 * Shared test helpers for E2E tests
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

// Constants
const INITIAL_VALUE = 0;

/**
 * Create an empty/default TestData object for initialization
 */
export const createEmptyTestData = (): TestData => ({
  metadata: {
    startTime: INITIAL_VALUE,
    endTime: INITIAL_VALUE,
    durationMs: INITIAL_VALUE,
    instances: {},
  },
  jobs: {},
  timeline: [],
  snapshots: [],
  summary: {
    totalJobs: INITIAL_VALUE,
    completed: INITIAL_VALUE,
    failed: INITIAL_VALUE,
    avgDurationMs: null,
    byInstance: {},
    byJobType: {},
    byModel: {},
  },
});

// Export constant for tests
export const ZERO_COUNT = 0;
