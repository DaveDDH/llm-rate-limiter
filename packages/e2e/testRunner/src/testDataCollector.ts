import { writeFile } from 'node:fs/promises';
import { request } from 'node:http';

import type { InstanceState } from './stateAggregator.js';

const HTTP_OK = 200;

/** A single event captured from SSE */
export interface CapturedEvent {
  /** Timestamp when event was received */
  receivedAt: number;
  /** Instance URL the event came from */
  sourceUrl: string;
  /** The parsed event data */
  event: unknown;
}

/** A state snapshot at a point in time */
export interface StateSnapshot {
  /** Timestamp of the snapshot */
  timestamp: number;
  /** Label describing when this snapshot was taken */
  label: string;
  /** State from each instance */
  instances: InstanceState[];
}

/** Job history from an instance */
export interface InstanceJobHistory {
  instanceId: string;
  history: unknown[];
  summary: { completed: number; failed: number; total: number };
}

/** Complete test data collected during a run */
export interface TestData {
  /** When the test started */
  startTime: number;
  /** When the test ended */
  endTime: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Instance URLs that were monitored */
  instanceUrls: string[];
  /** All events captured from SSE streams */
  events: CapturedEvent[];
  /** State snapshots taken during the test */
  snapshots: StateSnapshot[];
  /** Job history from each instance at the end */
  jobHistory: InstanceJobHistory[];
  /** Jobs that were sent during the test */
  jobsSent: Array<{ jobId: string; jobType: string; sentAt: number; targetUrl: string }>;
  /** Test results summary */
  summary: {
    totalJobsSent: number;
    totalEventsReceived: number;
    totalSnapshots: number;
  };
}

/** Response from job history endpoint */
interface JobHistoryResponse {
  instanceId: string;
  history: unknown[];
  summary: { completed: number; failed: number; total: number };
}

/**
 * Collects all data during an E2E test run.
 */
export class TestDataCollector {
  private readonly instanceUrls: string[];
  private readonly events: CapturedEvent[] = [];
  private readonly snapshots: StateSnapshot[] = [];
  private readonly jobsSent: TestData['jobsSent'] = [];
  private readonly startTime: number;
  private readonly sseConnections: Map<string, { close: () => void }> = new Map();

  constructor(instanceUrls: string[]) {
    this.instanceUrls = instanceUrls;
    this.startTime = Date.now();
  }

  /**
   * Start listening to SSE events from all instances.
   */
  async startEventListeners(): Promise<void> {
    for (const url of this.instanceUrls) {
      this.connectToSSE(url);
    }
    // Give connections time to establish
    await this.sleep(100);
  }

  private connectToSSE(baseUrl: string): void {
    const urlObj = new URL(`${baseUrl}/api/debug/events`);

    const req = request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
      },
      (res) => {
        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();

          // Parse SSE events
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const eventData = JSON.parse(line.slice(6));
                this.events.push({
                  receivedAt: Date.now(),
                  sourceUrl: baseUrl,
                  event: eventData,
                });
              } catch {
                // Ignore parse errors
              }
            }
          }
        });
      }
    );

    req.on('error', () => {
      // Ignore connection errors
    });

    req.end();

    this.sseConnections.set(baseUrl, {
      close: () => {
        req.destroy();
      },
    });
  }

  /**
   * Stop all SSE listeners.
   */
  stopEventListeners(): void {
    for (const connection of this.sseConnections.values()) {
      connection.close();
    }
    this.sseConnections.clear();
  }

  /**
   * Record a state snapshot.
   */
  addSnapshot(label: string, instances: InstanceState[]): void {
    this.snapshots.push({
      timestamp: Date.now(),
      label,
      instances,
    });
  }

  /**
   * Record a job that was sent.
   */
  recordJobSent(jobId: string, jobType: string, targetUrl: string): void {
    this.jobsSent.push({
      jobId,
      jobType,
      sentAt: Date.now(),
      targetUrl,
    });
  }

  /**
   * Fetch job history from all instances.
   */
  async fetchJobHistory(): Promise<InstanceJobHistory[]> {
    const results = await Promise.all(
      this.instanceUrls.map(async (url) => {
        const response = await this.fetchJson<JobHistoryResponse>(`${url}/api/debug/job-history`);
        if (response === null) {
          return {
            instanceId: 'unknown',
            history: [],
            summary: { completed: 0, failed: 0, total: 0 },
          };
        }
        return {
          instanceId: response.instanceId,
          history: response.history,
          summary: response.summary,
        };
      })
    );
    return results;
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    return new Promise((resolve) => {
      const urlObj = new URL(url);

      const req = request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'GET',
        },
        (res) => {
          if (res.statusCode !== HTTP_OK) {
            resolve(null);
            return;
          }

          let body = '';
          res.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(body) as T);
            } catch {
              resolve(null);
            }
          });
        }
      );

      req.on('error', () => {
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * Get all collected data.
   */
  async getData(): Promise<TestData> {
    const endTime = Date.now();
    const jobHistory = await this.fetchJobHistory();

    return {
      startTime: this.startTime,
      endTime,
      durationMs: endTime - this.startTime,
      instanceUrls: this.instanceUrls,
      events: this.events,
      snapshots: this.snapshots,
      jobHistory,
      jobsSent: this.jobsSent,
      summary: {
        totalJobsSent: this.jobsSent.length,
        totalEventsReceived: this.events.length,
        totalSnapshots: this.snapshots.length,
      },
    };
  }

  /**
   * Save all collected data to a file.
   */
  async saveToFile(filePath: string): Promise<void> {
    const data = await this.getData();
    const json = JSON.stringify(data, null, 2);
    await writeFile(filePath, json, 'utf-8');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
