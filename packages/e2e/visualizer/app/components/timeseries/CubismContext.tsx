'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import type { ChartDataPoint, MetricConfig } from '@/lib/timeseries';
import { HorizonChart } from './HorizonChart';

interface CubismContextProps {
  data: ChartDataPoint[];
  selectedMetrics: string[];
  metricConfigs: MetricConfig[];
  height?: number;
}

const DEFAULT_CHART_HEIGHT = 120;

function getTimeExtent(data: ChartDataPoint[]): [number, number] {
  if (data.length === 0) return [0, 1];
  const times = data.map((d) => d.time);
  return [Math.min(...times), Math.max(...times)];
}

export function CubismContext({
  data,
  selectedMetrics,
  metricConfigs,
  height = DEFAULT_CHART_HEIGHT,
}: CubismContextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef<SVGSVGElement>(null);
  const ruleRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const configMap = new Map(metricConfigs.map((c) => [c.key, c]));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = (): void => {
      setContainerWidth(container.clientWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svg = axisRef.current;
    const labelOffset = 200; // w-48 + pl-2
    const chartWidth = containerWidth - labelOffset;
    if (!svg || chartWidth <= 0 || data.length === 0) return;

    const [minTime, maxTime] = getTimeExtent(data);
    const scale = d3.scaleLinear().domain([minTime, maxTime]).range([0, chartWidth]);

    const axis = d3.axisBottom(scale).ticks(10).tickFormat((d) => `${d}s`);

    d3.select(svg).selectAll('*').remove();
    d3.select(svg).append('g').attr('transform', 'translate(0,0)').call(axis);
  }, [data, containerWidth]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || data.length === 0 || containerWidth === 0) return;

      const labelOffset = 192 + 8; // w-48 + gap-2
      const chartWidth = containerWidth - labelOffset;
      if (chartWidth <= 0) return;

      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left - labelOffset;
      const index = Math.floor((x / chartWidth) * data.length);
      setFocusIndex(Math.max(0, Math.min(index, data.length - 1)));
    },
    [containerWidth, data.length]
  );

  const handleMouseLeave = useCallback(() => {
    setFocusIndex(null);
  }, []);

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        No data available
      </div>
    );
  }

  const lastIndex = data.length - 1;
  const displayIndex = focusIndex ?? lastIndex;
  const focusData = data[displayIndex];

  return (
    <div className="space-y-2">
      <FocusInfo
        focusData={focusData}
        selectedMetrics={selectedMetrics}
        configMap={configMap}
        isHovering={focusIndex !== null}
      />
      <div
        ref={containerRef}
        className="relative"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div className="space-y-0">
          {selectedMetrics.map((metricKey) => {
            const config = configMap.get(metricKey);
            if (!config) return null;
            return (
              <HorizonChart
                key={metricKey}
                data={data}
                metricKey={metricKey}
                config={config}
                height={height}
              />
            );
          })}
        </div>
        <RuleLine
          focusIndex={focusIndex}
          dataLength={data.length}
          containerWidth={containerWidth}
          ruleRef={ruleRef}
        />
      </div>
      <div className="ml-48 pl-3">
        <svg ref={axisRef} width={Math.max(0, containerWidth - 200)} height={30} className="text-sm" />
      </div>
    </div>
  );
}

interface FocusInfoProps {
  focusData: ChartDataPoint;
  selectedMetrics: string[];
  configMap: Map<string, MetricConfig>;
  isHovering: boolean;
}

function FocusInfo({ focusData, selectedMetrics, configMap, isHovering }: FocusInfoProps) {
  return (
    <div className="flex flex-wrap gap-6 text-sm py-2">
      <span className={isHovering ? 'text-foreground' : 'text-muted-foreground'}>
        Time: {focusData.time.toFixed(2)}s | {focusData.trigger}
      </span>
      {selectedMetrics.map((key) => {
        const config = configMap.get(key);
        const value = focusData[key];
        if (typeof value !== 'number') return null;
        return (
          <span key={key}>
            <span className="text-muted-foreground">{config?.label ?? key}:</span>{' '}
            <span className={isHovering ? 'font-semibold' : 'font-semibold text-muted-foreground'}>
              {value.toFixed(2)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

interface RuleLineProps {
  focusIndex: number | null;
  dataLength: number;
  containerWidth: number;
  ruleRef: React.RefObject<HTMLDivElement | null>;
}

function RuleLine({ focusIndex, dataLength, containerWidth, ruleRef }: RuleLineProps) {
  if (focusIndex === null || containerWidth === 0 || dataLength === 0) return null;

  const offset = 192 + 8; // label width + gap
  const chartWidth = containerWidth - offset;
  const x = offset + (focusIndex / dataLength) * chartWidth;

  return (
    <div
      ref={ruleRef}
      className="absolute top-0 bottom-0 w-px bg-foreground/50 pointer-events-none"
      style={{ left: `${x}px` }}
    />
  );
}
