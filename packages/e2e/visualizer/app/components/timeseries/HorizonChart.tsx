'use client';

import { useEffect, useRef } from 'react';
import type { ChartDataPoint, MetricConfig } from '@/lib/timeseries';

interface HorizonChartProps {
  data: ChartDataPoint[];
  metricKey: string;
  config: MetricConfig;
  height?: number;
  bands?: number;
  focusIndex?: number | null;
}

const DEFAULT_HEIGHT = 120;
const DEFAULT_BANDS = 4;

// Cubism default colors: blues for negative, greens for positive
const NEGATIVE_COLORS = ['#bdd7e7', '#6baed6', '#3182bd', '#08519c'];
const POSITIVE_COLORS = ['#bae4b3', '#74c476', '#31a354', '#006d2c'];

function getMetricValues(data: ChartDataPoint[], metricKey: string): number[] {
  return data.map((d) => {
    const value = d[metricKey];
    return typeof value === 'number' ? value : 0;
  });
}

function renderHorizonBands(
  ctx: CanvasRenderingContext2D,
  values: number[],
  width: number,
  height: number,
  bands: number,
  maxValue: number
): void {
  const bandHeight = height / bands;
  const xScale = width / values.length;

  ctx.clearRect(0, 0, width, height);

  values.forEach((value, i) => {
    const x = i * xScale;
    const normalizedValue = Math.abs(value) / maxValue;
    const isNegative = value < 0;
    const colors = isNegative ? NEGATIVE_COLORS : POSITIVE_COLORS;

    for (let band = 0; band < bands; band += 1) {
      const bandValue = normalizedValue * bands - band;
      if (bandValue <= 0) break;

      const fillHeight = Math.min(bandValue, 1) * bandHeight;
      ctx.fillStyle = colors[Math.min(band, colors.length - 1)];
      ctx.fillRect(x, height - fillHeight, xScale + 1, fillHeight);
    }
  });
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(2);
}

export function HorizonChart({
  data,
  metricKey,
  config,
  height = DEFAULT_HEIGHT,
  bands = DEFAULT_BANDS,
  focusIndex,
}: HorizonChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = container.clientWidth;
    canvas.width = width;
    canvas.height = height;

    const values = getMetricValues(data, metricKey);
    const maxValue = Math.max(...values.map(Math.abs), 1);

    renderHorizonBands(ctx, values, width, height, bands, maxValue);
  }, [data, metricKey, height, bands]);

  const displayIndex = focusIndex ?? data.length - 1;
  const currentValue = data[displayIndex]?.[metricKey];
  const displayValue = typeof currentValue === 'number' ? formatValue(currentValue) : '-';

  return (
    <div
      className="flex items-stretch border-t border-black relative"
      style={{ minHeight: height }}
    >
      <div
        className="w-48 flex items-center px-3 bg-background/80 border-r border-black"
        style={{ textShadow: '0 1px 0 rgba(255,255,255,.5)' }}
      >
        <span className="text-sm font-medium truncate" title={config.label}>
          {config.label}
        </span>
      </div>
      <div ref={containerRef} className="flex-1 min-w-0 relative">
        <canvas ref={canvasRef} height={height} className="w-full block" />
        <div
          className="absolute top-1 right-2 text-sm font-semibold tabular-nums"
          style={{ textShadow: '0 1px 0 rgba(255,255,255,.8)' }}
        >
          {displayValue}
        </div>
      </div>
    </div>
  );
}
