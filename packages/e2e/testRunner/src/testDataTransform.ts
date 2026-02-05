/**
 * Transform raw collected data into the improved structure.
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { buildJobRecords } from './testDataTransformJobs.js';
import { buildSnapshots } from './testDataTransformState.js';
import { buildSummary } from './testDataTransformSummary.js';
import { buildTimeline } from './testDataTransformTimeline.js';
import type { RawEvent, RawTestData } from './testDataTransformTypes.js';

// Re-export types
export type { RawTestData } from './testDataTransformTypes.js';

/**
 * Extract instance ID mapping from events
 */
const buildInstanceMapping = (events: RawEvent[]): Record<string, string> => {
  const mapping: Record<string, string> = {};
  for (const { sourceUrl, event } of events) {
    const { instanceId } = event;
    mapping[sourceUrl] = instanceId;
  }
  return mapping;
};

/**
 * Main transform function
 */
export const transformTestData = (raw: RawTestData): TestData => {
  const instanceMapping = buildInstanceMapping(raw.events);
  const jobs = buildJobRecords(raw.jobsSent, raw.events);
  const timeline = buildTimeline(raw.events);
  const snapshots = buildSnapshots(raw.snapshots);
  const summary = buildSummary(jobs);

  return {
    metadata: {
      startTime: raw.startTime,
      endTime: raw.endTime,
      durationMs: raw.endTime - raw.startTime,
      instances: instanceMapping,
    },
    jobs,
    timeline,
    snapshots,
    summary,
  };
};
