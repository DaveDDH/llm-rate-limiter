import type {
  HistoricalJob,
  JobHistoryTrackerConfig,
  RecordCompletedParams,
  RecordFailedParams,
} from './types.js';

const DEFAULT_MAX_JOBS = 1000;
const DEFAULT_RETENTION_MS = 300000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60000; // 1 minute
const ZERO = 0;
const ONE = 1;

/**
 * Tracks completed and failed jobs for debugging and testing.
 * Active jobs are tracked by the core rate limiter via getActiveJobs().
 */
export class JobHistoryTracker {
  private readonly history: Map<string, HistoricalJob> = new Map();
  private readonly maxJobs: number;
  private readonly retentionMs: number;
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  constructor(config: JobHistoryTrackerConfig = {}) {
    this.maxJobs = config.maxJobs ?? DEFAULT_MAX_JOBS;
    this.retentionMs = config.retentionMs ?? DEFAULT_RETENTION_MS;
    this.startCleanup();
  }

  private startCleanup(): void {
    this.cleanupIntervalId = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
  }

  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.retentionMs;

    for (const [jobId, job] of this.history) {
      if (job.completedAt < cutoff) {
        this.history.delete(jobId);
      }
    }
  }

  private enforceMaxSize(): void {
    if (this.history.size <= this.maxJobs) {
      return;
    }

    // Remove oldest jobs first
    const entries = Array.from(this.history.entries());
    entries.sort((a, b) => a[ONE].completedAt - b[ONE].completedAt);

    const toRemove = entries.length - this.maxJobs;
    for (let i = ZERO; i < toRemove; i++) {
      const entry = entries[i];
      if (entry !== undefined) {
        this.history.delete(entry[ZERO]);
      }
    }
  }

  recordCompleted(params: RecordCompletedParams): void {
    const { jobId, jobType, modelUsed, queuedAt, startedAt, totalCost, modelsTried } = params;
    const now = Date.now();

    this.history.set(jobId, {
      jobId,
      jobType,
      status: 'completed',
      modelUsed,
      queuedAt,
      startedAt,
      completedAt: now,
      totalCost,
      modelsTried,
    });

    this.enforceMaxSize();
  }

  recordFailed(params: RecordFailedParams): void {
    const { jobId, jobType, error, queuedAt, startedAt, totalCost, modelsTried } = params;
    const now = Date.now();

    this.history.set(jobId, {
      jobId,
      jobType,
      status: 'failed',
      modelUsed: '',
      queuedAt,
      startedAt: startedAt ?? queuedAt,
      completedAt: now,
      totalCost,
      error,
      modelsTried,
    });

    this.enforceMaxSize();
  }

  getHistory(): HistoricalJob[] {
    return Array.from(this.history.values());
  }

  getJob(jobId: string): HistoricalJob | undefined {
    return this.history.get(jobId);
  }

  getSummary(): { completed: number; failed: number; total: number } {
    let completed = ZERO;
    let failed = ZERO;

    for (const job of this.history.values()) {
      if (job.status === 'completed') {
        completed++;
      } else {
        failed++;
      }
    }

    return { completed, failed, total: this.history.size };
  }

  stop(): void {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  clear(): void {
    this.history.clear();
  }
}
