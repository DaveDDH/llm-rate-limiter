/**
 * Types for capacity-based visualization.
 */

export interface CapacityMetric {
  /** Unique key for this metric */
  key: string;
  /** Display label */
  label: string;
  /** Usage value key in chart data */
  usageKey: string;
  /** Capacity value key in chart data */
  capacityKey: string;
  /** Type of metric */
  type: 'model' | 'jobType';
}

export interface InstanceConfig {
  /** Instance short ID (e.g., "inst1") */
  instanceId: string;
  /** Full instance ID */
  fullId: string;
  /** Model metrics for this instance */
  models: CapacityMetric[];
  /** Job type metrics for this instance */
  jobTypes: CapacityMetric[];
}

export interface CapacityDataPoint {
  /** Time in seconds from test start */
  time: number;
  /** Original timestamp */
  timestamp: number;
  /** Trigger event */
  trigger: string;
  /** Dynamic metric values */
  [key: string]: number | string;
}
