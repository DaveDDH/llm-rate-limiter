'use client';

import type { CapacityDataPoint, CapacityMetric, InstanceConfig } from '@/lib/timeseries/capacityTypes';

import { CapacityChart } from './CapacityChart';

interface InstanceSectionProps {
  config: InstanceConfig;
  data: CapacityDataPoint[];
  focusIndex: number | null;
  timeExtent: [number, number];
}

const CHART_HEIGHT = 120;

/** Check if a metric has any jobs (inFlight > 0) */
function hasJobs(data: CapacityDataPoint[], metric: CapacityMetric): boolean {
  for (const point of data) {
    const inFlight = point[metric.usageKey];
    if (typeof inFlight === 'number' && inFlight > 0) return true;
  }
  return false;
}

export function InstanceSection({ config, data, focusIndex, timeExtent }: InstanceSectionProps) {
  // Filter out metrics with no jobs
  const activeModels = config.models.filter((m) => hasJobs(data, m));

  if (activeModels.length === 0) {
    return null;
  }

  return (
    <div className="border border-border rounded-none overflow-hidden">
      <div className="flex gap-4 items-center bg-muted px-4 py-2 border-b border-border">
        <h3 className="font-semibold text-base">{config.instanceId}</h3>
        <p className="text-xs text-muted-foreground truncate">{config.fullId}</p>
      </div>

      {activeModels.length > 0 && (
        <div>
          {activeModels.map((metric) => (
            <CapacityChart
              key={metric.key}
              data={data}
              metric={metric}
              height={CHART_HEIGHT}
              focusIndex={focusIndex}
              timeExtent={timeExtent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
