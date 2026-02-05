'use client';

import { useState, useEffect } from 'react';
import type { TestData } from '@llm-rate-limiter/e2e-test-results';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DatasetSelector } from './DatasetSelector';
import { CapacityContext, FocusInfo } from './CapacityContext';
import {
  transformToCapacityData,
  getInstanceConfigs,
} from '@/lib/timeseries/capacityTransform';
import type { CapacityDataPoint, InstanceConfig } from '@/lib/timeseries/capacityTypes';

async function loadDatasetJson(datasetId: string): Promise<TestData | null> {
  switch (datasetId) {
    case 'capacity-plus-one': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/capacity-plus-one.json');
      return m.default as unknown as TestData;
    }
    case 'exact-capacity': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/exact-capacity.json');
      return m.default as unknown as TestData;
    }
    case 'rate-limit-queuing': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/rate-limit-queuing.json');
      return m.default as unknown as TestData;
    }
    case 'slots-evolve-sequential': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/slots-evolve-sequential.json');
      return m.default as unknown as TestData;
    }
    case 'slots-evolve-interleaved': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/slots-evolve-interleaved.json');
      return m.default as unknown as TestData;
    }
    case 'slots-evolve-concurrent': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/slots-evolve-concurrent.json');
      return m.default as unknown as TestData;
    }
    case 'model-escalation': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/model-escalation.json');
      return m.default as unknown as TestData;
    }
    case 'dummy': {
      const m = await import('@llm-rate-limiter/e2e-test-results/src/data/dummy.json');
      return m.default as unknown as TestData;
    }
    default:
      return null;
  }
}

export function TimeseriesPage() {
  const [selectedDataset, setSelectedDataset] = useState('capacity-plus-one');
  const [testData, setTestData] = useState<TestData | null>(null);
  const [chartData, setChartData] = useState<CapacityDataPoint[]>([]);
  const [instances, setInstances] = useState<InstanceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDataset(): Promise<void> {
      setLoading(true);
      const data = await loadDatasetJson(selectedDataset);
      if (cancelled || data === null) return;

      setTestData(data);
      setChartData(transformToCapacityData(data));
      setInstances(getInstanceConfigs(data));
      setLoading(false);
    }

    void loadDataset();

    return () => {
      cancelled = true;
    };
  }, [selectedDataset]);

  return (
    <div className="w-full m-0 p-3">
      <Card className='shadow-none ring-0'>
        <CardHeader>
          <CardTitle>E2E Test Results - Capacity Visualization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <DatasetSelector value={selectedDataset} onValueChange={setSelectedDataset} />
            <FocusInfo
              focusData={focusIndex !== null ? chartData[focusIndex] : null}
              isHovering={focusIndex !== null}
            />
          </div>

          {loading ? (
            <div className="h-[400px] flex items-center justify-center text-muted-foreground">
              Loading...
            </div>
          ) : (
            <CapacityContext data={chartData} instances={instances} onFocusChange={setFocusIndex} />
          )}

          {testData && <SummarySection testData={testData} />}
        </CardContent>
      </Card>
    </div>
  );
}

interface SummarySectionProps {
  testData: TestData;
}

function SummarySection({ testData }: SummarySectionProps) {
  const { summary, metadata } = testData;
  const durationSec = (metadata.durationMs / 1000).toFixed(1);

  return (
    <div className="flex flex-wrap gap-2 pt-4 border-t">
      <Badge variant="outline">Duration: {durationSec}s</Badge>
      <Badge variant="outline">Total Jobs: {summary.totalJobs}</Badge>
      <Badge variant="outline">Completed: {summary.completed}</Badge>
      <Badge variant="outline">Failed: {summary.failed}</Badge>
      {summary.avgDurationMs && (
        <Badge variant="outline">
          Avg Duration: {(summary.avgDurationMs / 1000).toFixed(2)}s
        </Badge>
      )}
    </div>
  );
}
