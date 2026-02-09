/**
 * Transform test data into capacity-based format for visualization.
 * Shows data per job type, per model, per instance.
 */
import type { JobRecord, StateSnapshot, TestData } from '@llm-rate-limiter/e2e-test-results';

import type { CapacityDataPoint, CapacityMetric, InstanceConfig } from './capacityTypes';

const FIRST_INSTANCE_INDEX = 1;
const KEY_REGEXP = /[^a-zA-Z0-9]/gu;
const NUM_INTERVALS = 400;
const MS_TO_SECONDS = 1000;

/** Build instance ID map */
function buildInstanceIdMap(testData: TestData): Map<string, string> {
  const map = new Map<string, string>();
  const instanceIds = Object.values(testData.metadata.instances);
  instanceIds.forEach((id, index) => {
    map.set(id, `inst${index + FIRST_INSTANCE_INDEX}`);
  });
  return map;
}

/** Find the time span from job activity bounds */
function findTimeSpan(testData: TestData): { minTime: number; maxTime: number } {
  const jobs = Object.values(testData.jobs);
  if (jobs.length === 0) {
    return { minTime: testData.metadata.startTime, maxTime: testData.metadata.endTime };
  }

  const minTime = jobs.reduce((min, j) => (j.sentAt < min ? j.sentAt : min), Infinity);
  const maxTime = jobs.reduce((max, j) => {
    const end = j.events[j.events.length - 1]?.timestamp ?? 0;
    return end > max ? end : max;
  }, 0);

  return { minTime, maxTime };
}

/** Find the snapshot that applies at a given timestamp */
function findSnapshotAtTime(snapshots: StateSnapshot[], timestamp: number): StateSnapshot | null {
  let applicable: StateSnapshot | null = null;
  for (const snap of snapshots) {
    if (snap.timestamp <= timestamp) {
      applicable = snap;
    } else {
      break;
    }
  }
  return applicable;
}

/** Make a safe key from a string */
function makeKey(str: string): string {
  return str.replace(KEY_REGEXP, '_');
}

/** Find the model a job is associated with (running or queued) */
function findJobModel(job: JobRecord): string | null {
  for (const event of job.events) {
    if (event.type === 'started' && event.modelId) {
      return event.modelId;
    }
  }
  return job.modelUsed;
}

/** Check if a job is running (started but not completed/failed) at a given time */
function isJobRunning(job: JobRecord, timestamp: number): boolean {
  let started = false;
  for (const event of job.events) {
    if (event.timestamp > timestamp) break;
    if (event.type === 'started') started = true;
    if (event.type === 'completed' || event.type === 'failed') return false;
  }
  return started;
}

interface ActiveJobCounts {
  running: Record<string, number>;
  queued: Record<string, number>;
}

/** Count running and queued jobs per model/jobType from activeJobIds */
function countActiveJobs(
  activeJobIds: string[],
  jobs: Record<string, JobRecord>,
  timestamp: number
): ActiveJobCounts {
  const running: Record<string, number> = {};
  const queued: Record<string, number> = {};
  for (const jobId of activeJobIds) {
    const job = jobs[jobId];
    if (!job) continue;
    const model = findJobModel(job);
    if (!model) continue;
    const key = `${makeKey(model)}_${makeKey(job.jobType)}`;
    if (isJobRunning(job, timestamp)) {
      running[key] = (running[key] ?? 0) + 1;
    } else {
      queued[key] = (queued[key] ?? 0) + 1;
    }
  }
  return { running, queued };
}

/** Extract per-jobType per-model data from a snapshot */
function extractSnapshotData(
  snapshot: StateSnapshot | null,
  instanceIdMap: Map<string, string>,
  jobs: Record<string, JobRecord>,
  visualTimestamp: number
): Record<string, number> {
  const data: Record<string, number> = {};

  if (!snapshot) return data;

  for (const [fullId, state] of Object.entries(snapshot.instances)) {
    const shortId = instanceIdMap.get(fullId) ?? fullId;
    const counts = countActiveJobs(state.activeJobIds, jobs, visualTimestamp);

    for (const [modelId, modelState] of Object.entries(state.models)) {
      const modelKey = makeKey(modelId);

      if (modelState.jobTypes) {
        for (const [jobType, jtState] of Object.entries(modelState.jobTypes)) {
          const jtKey = makeKey(jobType);
          const prefix = `${shortId}_${modelKey}_${jtKey}`;
          const activeKey = `${modelKey}_${jtKey}`;

          data[`${prefix}_slots`] = jtState.totalSlots;
          data[`${prefix}_running`] = counts.running[activeKey] ?? 0;
          data[`${prefix}_queued`] = counts.queued[activeKey] ?? 0;
        }
      }
    }
  }

  return data;
}

/** Build data point from snapshot */
function buildIntervalDataPoint(
  intervalIndex: number,
  intervalMidpoint: number,
  minTime: number,
  snapshotData: Record<string, number>
): CapacityDataPoint {
  const point: CapacityDataPoint = {
    time: (intervalMidpoint - minTime) / MS_TO_SECONDS,
    timestamp: intervalMidpoint,
    trigger: `interval-${intervalIndex}`,
    ...snapshotData,
  };

  return point;
}

/** Build all data points */
function buildDataPoints(
  testData: TestData,
  minTime: number,
  maxTime: number,
  instanceIdMap: Map<string, string>
): CapacityDataPoint[] {
  const timeSpan = maxTime - minTime;
  const intervalDuration = timeSpan / NUM_INTERVALS;
  const points: CapacityDataPoint[] = [];

  for (let i = 0; i < NUM_INTERVALS; i += 1) {
    const intervalStart = minTime + i * intervalDuration;
    const intervalMidpoint = intervalStart + intervalDuration / 2;

    const snapshot = findSnapshotAtTime(testData.snapshots, intervalMidpoint);
    const snapshotData = extractSnapshotData(snapshot, instanceIdMap, testData.jobs, intervalMidpoint);

    const point = buildIntervalDataPoint(i, intervalMidpoint, minTime, snapshotData);
    points.push(point);
  }

  return points;
}

/** Transform test data to capacity data points */
export function transformToCapacityData(testData: TestData): CapacityDataPoint[] {
  const instanceIdMap = buildInstanceIdMap(testData);
  const { minTime, maxTime } = findTimeSpan(testData);
  // Extend maxTime by one interval so the last real bar covers the final snapshot
  const timeSpan = maxTime - minTime;
  const extraInterval = timeSpan / NUM_INTERVALS;
  const points = buildDataPoints(testData, minTime, maxTime + extraInterval, instanceIdMap);

  // Add padding point at the end with slots carried forward but inFlight zeroed
  const paddingTime = (maxTime + extraInterval * 2 - minTime) / MS_TO_SECONDS;
  const paddingPoint: CapacityDataPoint = {
    time: paddingTime,
    timestamp: maxTime + extraInterval * 2,
    trigger: 'end-padding',
  };

  const lastPoint = points[points.length - 1];
  if (lastPoint) {
    for (const key of Object.keys(lastPoint)) {
      if (key.endsWith('_slots')) {
        paddingPoint[key] = lastPoint[key];
      }
      if (key.endsWith('_running') || key.endsWith('_queued')) {
        paddingPoint[key] = 0;
      }
    }
  }
  points.push(paddingPoint);

  return points;
}

/** Collected metric info per instance */
interface InstanceMetricInfo {
  fullId: string;
  /** Map of modelKey -> Set of jobTypeKeys */
  models: Map<string, Set<string>>;
}

/** Aggregate all model/jobType combinations from snapshots */
function aggregateMetricInfo(testData: TestData): Map<string, InstanceMetricInfo> {
  const aggregated = new Map<string, InstanceMetricInfo>();

  for (const snapshot of testData.snapshots) {
    for (const [fullId, state] of Object.entries(snapshot.instances)) {
      let info = aggregated.get(fullId);
      if (!info) {
        info = { fullId, models: new Map() };
        aggregated.set(fullId, info);
      }

      for (const [modelId, modelState] of Object.entries(state.models)) {
        const modelKey = makeKey(modelId);
        let jobTypes = info.models.get(modelKey);
        if (!jobTypes) {
          jobTypes = new Set();
          info.models.set(modelKey, jobTypes);
        }

        if (modelState.jobTypes) {
          for (const jobType of Object.keys(modelState.jobTypes)) {
            jobTypes.add(jobType);
          }
        }
      }
    }
  }

  return aggregated;
}

/** Build metrics for an instance */
function buildInstanceMetrics(shortId: string, info: InstanceMetricInfo): CapacityMetric[] {
  const metrics: CapacityMetric[] = [];

  for (const [modelKey, jobTypes] of info.models) {
    for (const jobType of jobTypes) {
      const jtKey = makeKey(jobType);
      const prefix = `${shortId}_${modelKey}_${jtKey}`;

      metrics.push({
        key: prefix,
        label: `${modelKey} / ${jobType}`,
        usageKey: `${prefix}_running`,
        queuedKey: `${prefix}_queued`,
        capacityKey: `${prefix}_running`,
        slotsKey: `${prefix}_slots`,
        type: 'jobType',
      });
    }
  }

  return metrics;
}

/** Get instance configurations from test data */
export function getInstanceConfigs(testData: TestData): InstanceConfig[] {
  const configs: InstanceConfig[] = [];
  const instanceIdMap = buildInstanceIdMap(testData);
  const aggregated = aggregateMetricInfo(testData);

  for (const [fullId, info] of aggregated) {
    const shortId = instanceIdMap.get(fullId) ?? fullId;
    const metrics = buildInstanceMetrics(shortId, info);

    configs.push({
      instanceId: shortId,
      fullId,
      models: metrics,
      jobTypes: [],
    });
  }

  return configs;
}
