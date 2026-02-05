'use client';

import type { CapacityDataPoint, InstanceConfig } from '@/lib/timeseries/capacityTypes';
import { CapacityChart } from './CapacityChart';

interface InstanceSectionProps {
  config: InstanceConfig;
  data: CapacityDataPoint[];
  focusIndex: number | null;
  timeExtent: [number, number];
}

const CHART_HEIGHT = 120;

export function InstanceSection({ config, data, focusIndex, timeExtent }: InstanceSectionProps) {
  return (
    <div className="border border-border rounded-none overflow-hidden">
      <div className="bg-muted px-4 py-2 border-b border-border">
        <h3 className="font-semibold text-base">{config.instanceId}</h3>
        <p className="text-xs text-muted-foreground truncate">{config.fullId}</p>
      </div>

      {config.models.length > 0 && (
        <div>
          <div className="bg-muted/50 px-4 py-1 border-b border-border">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Models
            </span>
          </div>
          {config.models.map((metric) => (
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

      {config.jobTypes.length > 0 && (
        <div>
          <div className="bg-muted/50 px-4 py-1 border-b border-border">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Job Types
            </span>
          </div>
          {config.jobTypes.map((metric) => (
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
