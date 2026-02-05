'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import type { CapacityDataPoint, InstanceConfig } from '@/lib/timeseries/capacityTypes';
import { InstanceSection } from './InstanceSection';

interface CapacityContextProps {
  data: CapacityDataPoint[];
  instances: InstanceConfig[];
  onFocusChange?: (index: number | null) => void;
}

function getTimeExtent(data: CapacityDataPoint[]): [number, number] {
  if (data.length === 0) return [0, 1];
  const times = data.map((d) => d.time);
  return [Math.min(...times), Math.max(...times)];
}

// Label width matches w-40 in CapacityChart (40 * 4px = 160px)
const LABEL_WIDTH = 160;
// Right padding matches pr-2 in CapacityChart (2 * 4px = 8px)
const RIGHT_PADDING = 8;

export function CapacityContext({ data, instances, onFocusChange }: CapacityContextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef<SVGSVGElement>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

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
    if (!svg || containerWidth === 0 || data.length === 0) return;

    const chartWidth = containerWidth - LABEL_WIDTH - RIGHT_PADDING;
    if (chartWidth <= 0) return;

    const [minTime, maxTime] = getTimeExtent(data);
    const scale = d3.scaleLinear().domain([minTime, maxTime]).range([0, chartWidth]);
    const axis = d3.axisBottom(scale).ticks(10).tickFormat((d) => `${d}s`);

    d3.select(svg).selectAll('*').remove();
    d3.select(svg)
      .append('g')
      .attr('transform', `translate(${LABEL_WIDTH}, 0)`)
      .call(axis);
  }, [data, containerWidth]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || data.length === 0 || containerWidth === 0) return;

      const chartWidth = containerWidth - LABEL_WIDTH - RIGHT_PADDING;
      if (chartWidth <= 0) return;

      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left - LABEL_WIDTH;
      if (x < 0) return;

      // Map cursor position to time, not index
      const [minTime, maxTime] = getTimeExtent(data);
      const timeRange = maxTime - minTime;
      const cursorTime = minTime + (x / chartWidth) * timeRange;

      // Find the data point closest to this time
      let closestIndex = 0;
      let closestDiff = Math.abs(data[0].time - cursorTime);
      for (let i = 1; i < data.length; i += 1) {
        const diff = Math.abs(data[i].time - cursorTime);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIndex = i;
        }
      }

      setFocusIndex(closestIndex);
      onFocusChange?.(closestIndex);
    },
    [containerWidth, data, onFocusChange]
  );

  const handleMouseLeave = useCallback(() => {
    setFocusIndex(null);
    onFocusChange?.(null);
  }, [onFocusChange]);

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        className="relative"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div className="space-y-4">
          {instances.map((instance) => (
            <InstanceSection
              key={instance.instanceId}
              config={instance}
              data={data}
              focusIndex={focusIndex}
              timeExtent={getTimeExtent(data)}
            />
          ))}
        </div>

        {focusIndex !== null && containerWidth > LABEL_WIDTH && (() => {
          const [minTime, maxTime] = getTimeExtent(data);
          const timeRange = maxTime - minTime;
          const focusTime = data[focusIndex].time;
          const chartWidth = containerWidth - LABEL_WIDTH - RIGHT_PADDING;
          const xPos = timeRange > 0
            ? LABEL_WIDTH + ((focusTime - minTime) / timeRange) * chartWidth
            : LABEL_WIDTH;
          return (
            <div
              className="absolute top-0 bottom-0 w-px bg-foreground/50 pointer-events-none z-10"
              style={{ left: `${xPos}px` }}
            />
          );
        })()}
      </div>

      <div>
        <svg ref={axisRef} width={containerWidth} height={30} className="text-sm" />
      </div>
    </div>
  );
}

export interface FocusInfoProps {
  focusData: CapacityDataPoint | null;
  isHovering: boolean;
}

export function FocusInfo({ focusData, isHovering }: FocusInfoProps) {
  if (!focusData) return null;
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className={isHovering ? 'text-foreground font-medium' : 'text-muted-foreground'}>
        Time: {focusData.time.toFixed(2)}s
      </span>
      <span className="text-muted-foreground truncate max-w-md" title={focusData.trigger}>
        {focusData.trigger}
      </span>
    </div>
  );
}
