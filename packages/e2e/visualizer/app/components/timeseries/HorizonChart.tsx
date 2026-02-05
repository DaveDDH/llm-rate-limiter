'use client';

import { useEffect, useRef } from 'react';
import type { ChartDataPoint, MetricConfig } from '@/lib/timeseries';

interface HorizonChartProps {
  data: ChartDataPoint[];
  metricKey: string;
  config: MetricConfig;
  height?: number;
  bands?: number;
}

const DEFAULT_HEIGHT = 120;
const DEFAULT_BANDS = 4;
const POSITIVE_COLORS = ['#d0e8f2', '#a0d4e8', '#60b4d4', '#2090b0'];
const NEGATIVE_COLORS = ['#ffe0e0', '#ffc0c0', '#ff9090', '#ff6060'];

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

export function HorizonChart({
  data,
  metricKey,
  config,
  height = DEFAULT_HEIGHT,
  bands = DEFAULT_BANDS,
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

  return (
    <div className="flex items-center gap-3 border-b border-border py-2">
      <div className="w-48 text-sm truncate font-medium" title={config.label}>
        {config.label}
      </div>
      <div ref={containerRef} className="flex-1 min-w-0">
        <canvas ref={canvasRef} height={height} className="w-full" />
      </div>
    </div>
  );
}
