/**
 * Types for test data transformation
 */
import type { InstanceState } from './stateAggregator.js';

// =============================================================================
// Raw Data Types (from collector)
// =============================================================================

export interface RawEvent {
  receivedAt: number;
  sourceUrl: string;
  event: RawEventData;
}

export interface RawEventData {
  type: string;
  instanceId: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface RawSnapshot {
  timestamp: number;
  label: string;
  instances: InstanceState[];
}

export interface RawJobSent {
  jobId: string;
  jobType: string;
  sentAt: number;
  targetUrl: string;
}

export interface RawTestData {
  startTime: number;
  endTime: number;
  instanceUrls: string[];
  events: RawEvent[];
  snapshots: RawSnapshot[];
  jobsSent: RawJobSent[];
}
