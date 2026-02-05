/**
 * Timeline transformation helpers
 */
import type { TimelineEvent } from '@llm-rate-limiter/e2e-test-results';

import type { RawEvent, RawEventData } from './testDataTransformTypes.js';

/**
 * Extract string value from payload field safely
 */
const getPayloadString = (payload: Record<string, unknown>, key: string): string | undefined => {
  const { [key]: value } = payload;
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
};

/**
 * Build a timeline entry from event data
 */
const buildTimelineEntry = (data: RawEventData, payload: Record<string, unknown>): TimelineEvent => {
  const entry: TimelineEvent = {
    t: data.timestamp,
    event: data.type,
    instanceId: data.instanceId,
  };

  const jobId = getPayloadString(payload, 'jobId');
  if (jobId !== undefined) {
    entry.jobId = jobId;
  }

  const jobType = getPayloadString(payload, 'jobType');
  if (jobType !== undefined) {
    entry.jobType = jobType;
  }

  const modelId = getPayloadString(payload, 'modelId');
  if (modelId !== undefined) {
    entry.modelId = modelId;
  }

  const modelUsed = getPayloadString(payload, 'modelUsed');
  if (modelUsed !== undefined) {
    entry.modelId = modelUsed;
  }

  if (data.type === 'job:completed') {
    entry.data = {
      cost: payload.totalCost,
      durationMs: payload.durationMs,
    };
  }
  if (data.type === 'job:failed') {
    entry.data = {
      error: payload.error,
      modelsTried: payload.modelsTried,
    };
  }

  return entry;
};

/**
 * Build timeline from events
 */
export const buildTimeline = (events: RawEvent[]): TimelineEvent[] => {
  const timeline: TimelineEvent[] = [];

  for (const rawEvent of events) {
    const { event } = rawEvent;
    const payload = event.payload ?? {};
    const entry = buildTimelineEntry(event, payload);
    timeline.push(entry);
  }

  timeline.sort((a, b) => a.t - b.t);

  return timeline;
};
