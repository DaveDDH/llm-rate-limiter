'use client';

import { CubismContext } from './CubismContext';
import type { ChartDataPoint, MetricConfig } from '@/lib/timeseries';

interface TimeseriesChartProps {
  data: ChartDataPoint[];
  selectedMetrics: string[];
  metricConfigs: MetricConfig[];
}

export function TimeseriesChart({
  data,
  selectedMetrics,
  metricConfigs,
}: TimeseriesChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
        No data available
      </div>
    );
  }

  if (selectedMetrics.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-muted-foreground">
        Select metrics to visualize
      </div>
    );
  }

  return (
    <CubismContext
      data={data}
      selectedMetrics={selectedMetrics}
      metricConfigs={metricConfigs}
    />
  );
}
