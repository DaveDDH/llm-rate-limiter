'use client';

import type { CapacityDataPoint, CapacityMetric } from '@/lib/timeseries/capacityTypes';
import { useEffect, useRef, useState } from 'react';

interface CapacityChartProps {
  data: CapacityDataPoint[];
  metric: CapacityMetric;
  height?: number;
  focusIndex?: number | null;
  timeExtent: [number, number];
}

const DEFAULT_HEIGHT = 80;

// Colors - same base color, different opacity for allocated vs used
const BASE_COLOR = '#E8715A';
const ALLOCATED_COLOR = 'rgba(232, 113, 90, 0.25)'; // Faded
const USED_COLOR = '#E8715A'; // Solid

interface ChartValues {
  inFlight: number[];
  slots: number[];
}

function getValues(
  data: CapacityDataPoint[],
  inFlightKey: string,
  slotsKey: string | undefined
): ChartValues {
  const inFlight = data.map((d) => {
    const v = d[inFlightKey];
    return typeof v === 'number' ? v : 0;
  });
  const slots = slotsKey
    ? data.map((d) => {
        const v = d[slotsKey];
        return typeof v === 'number' ? v : 0;
      })
    : [];
  return { inFlight, slots };
}

function renderChart(
  ctx: CanvasRenderingContext2D,
  data: CapacityDataPoint[],
  values: ChartValues,
  width: number,
  height: number,
  timeExtent: [number, number]
): void {
  const [minTime, maxTime] = timeExtent;
  const timeRange = maxTime - minTime;

  // Find max value for scaling (slots should be >= inFlight typically)
  const maxValue = Math.max(...values.inFlight, ...values.slots, 1);

  ctx.clearRect(0, 0, width, height);

  if (timeRange === 0) return;

  // First pass: Draw slots (allocated) as faded bars
  if (values.slots.length > 0) {
    for (let i = 0; i < data.length; i += 1) {
      const point = data[i];
      const slotVal = values.slots[i];

      const xRatio = (point.time - minTime) / timeRange;
      const x = xRatio * width;

      let barWidth: number;
      if (i < data.length - 1) {
        const nextXRatio = (data[i + 1].time - minTime) / timeRange;
        barWidth = (nextXRatio - xRatio) * width;
      } else {
        barWidth = width - x;
      }

      const barHeight = (slotVal / maxValue) * height;
      ctx.fillStyle = ALLOCATED_COLOR;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
    }
  }

  // Second pass: Draw in-flight (used) as solid bars on top
  for (let i = 0; i < data.length; i += 1) {
    const point = data[i];
    const inFlightVal = values.inFlight[i];

    const xRatio = (point.time - minTime) / timeRange;
    const x = xRatio * width;

    let barWidth: number;
    if (i < data.length - 1) {
      const nextXRatio = (data[i + 1].time - minTime) / timeRange;
      barWidth = (nextXRatio - xRatio) * width;
    } else {
      barWidth = width - x;
    }

    const barHeight = (inFlightVal / maxValue) * height;
    ctx.fillStyle = USED_COLOR;
    ctx.fillRect(x, height - barHeight, barWidth, barHeight);
  }
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(1);
}

export function CapacityChart({
  data,
  metric,
  height = DEFAULT_HEIGHT,
  focusIndex,
  timeExtent,
}: CapacityChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
    const canvas = canvasRef.current;
    if (!canvas || containerWidth === 0 || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = containerWidth;
    canvas.height = height;

    const values = getValues(data, metric.usageKey, metric.slotsKey);
    renderChart(ctx, data, values, containerWidth, height, timeExtent);
  }, [data, metric, height, containerWidth, timeExtent]);

  const displayIndex = focusIndex ?? data.length - 1;
  const currentInFlight = data[displayIndex]?.[metric.usageKey];
  const currentSlots = metric.slotsKey ? data[displayIndex]?.[metric.slotsKey] : undefined;
  const inFlightVal = typeof currentInFlight === 'number' ? currentInFlight : 0;
  const slotsVal = typeof currentSlots === 'number' ? currentSlots : null;

  return (
    <div className="flex items-stretch border-t border-border pr-2" style={{ minHeight: height }}>
      <div
        className="w-40 flex items-center px-3 bg-muted/30 border-r border-border"
        style={{ textShadow: '0 1px 0 rgba(255,255,255,.5)' }}
      >
        <div
          title={metric.label}
          style={{
            fontSize: '12px',
            color: '#555',
            margin: '4px 0 0',
            fontFamily: 'monospace',
            outline: 0,
            border: 0,
            textShadow: 'none',
          }}
        >
          {metric.label}
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-w-0 relative">
        <canvas ref={canvasRef} height={height} className="w-full block" />
        <div
          className="absolute top-1 right-2 text-xs tabular-nums"
          style={{ color: '#888', fontFamily: "'JetBrains Mono', monospace" }}
        >
          <span style={{ color: BASE_COLOR, fontWeight: 600 }}>{formatValue(inFlightVal)}</span>
          <span style={{ color: '#555' }}> / </span>
          <span style={{ color: '#666' }}>{slotsVal !== null ? formatValue(slotsVal) : '?'}</span>
          <span style={{ color: '#444', marginLeft: '4px' }}>used/allocated</span>
        </div>
      </div>
    </div>
  );
}
