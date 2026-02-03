import type { ActiveJobInfo, LLMRateLimiterStats } from '@llm-rate-limiter/core';
import { request } from 'node:http';

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_TIMEOUT_MS = 30000;
const HTTP_OK = 200;

/** State of a single instance */
export interface InstanceState {
  /** Instance ID */
  instanceId: string;
  /** Rate limiter stats */
  stats: LLMRateLimiterStats;
  /** Active jobs (waiting or processing) */
  activeJobs: ActiveJobInfo[];
  /** Timestamp of last update */
  lastUpdate: number;
}

/** Aggregated state across all instances */
export interface AggregatedState {
  /** State per instance */
  instances: InstanceState[];
  /** Total active jobs across all instances */
  totalActiveJobs: number;
  /** Total available slots across all instances */
  totalAvailableSlots: number;
}

/** Response from /api/debug/stats endpoint */
interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: LLMRateLimiterStats;
}

/** Response from /api/debug/active-jobs endpoint */
interface ActiveJobsResponse {
  instanceId: string;
  timestamp: number;
  activeJobs: ActiveJobInfo[];
  count: number;
}

/**
 * Aggregates state from multiple rate limiter instances.
 * Useful for E2E testing distributed rate limiting behavior.
 */
export class StateAggregator {
  private readonly instanceUrls: string[];
  private readonly states: Map<string, InstanceState> = new Map();

  constructor(instanceUrls: string[]) {
    this.instanceUrls = instanceUrls;
  }

  /**
   * Fetch current state from all instances.
   */
  async fetchState(): Promise<InstanceState[]> {
    const results = await Promise.all(this.instanceUrls.map((url) => this.fetchInstanceState(url)));

    // Update internal state cache
    for (const state of results) {
      if (state !== null) {
        this.states.set(state.instanceId, state);
      }
    }

    return results.filter((s): s is InstanceState => s !== null);
  }

  private async fetchInstanceState(baseUrl: string): Promise<InstanceState | null> {
    try {
      const [statsResponse, activeJobsResponse] = await Promise.all([
        this.fetchJson<StatsResponse>(`${baseUrl}/api/debug/stats`),
        this.fetchJson<ActiveJobsResponse>(`${baseUrl}/api/debug/active-jobs`),
      ]);

      if (statsResponse === null || activeJobsResponse === null) {
        return null;
      }

      return {
        instanceId: statsResponse.instanceId,
        stats: statsResponse.stats,
        activeJobs: activeJobsResponse.activeJobs,
        lastUpdate: Date.now(),
      };
    } catch {
      return null;
    }
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
              const parsed = JSON.parse(body) as T;
              resolve(parsed);
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
   * Get aggregated state across all instances.
   */
  async getAggregatedState(): Promise<AggregatedState> {
    const instances = await this.fetchState();

    let totalActiveJobs = 0;
    let totalAvailableSlots = 0;

    for (const instance of instances) {
      totalActiveJobs += instance.activeJobs.length;

      // Sum available slots from all models
      for (const modelStats of Object.values(instance.stats.models)) {
        if (modelStats.concurrency !== undefined) {
          totalAvailableSlots += modelStats.concurrency.available;
        }
      }
    }

    return {
      instances,
      totalActiveJobs,
      totalAvailableSlots,
    };
  }

  /**
   * Wait for a condition to be true across instances.
   * Polls at regular intervals until the predicate returns true or timeout.
   */
  async waitFor(
    predicate: (states: InstanceState[]) => boolean,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<void> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = options;

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const states = await this.fetchState();

      if (predicate(states)) {
        return;
      }

      await this.sleep(pollIntervalMs);
    }

    throw new Error(`waitFor timeout after ${timeoutMs}ms`);
  }

  /**
   * Wait for a specific number of active jobs across all instances.
   */
  async waitForActiveJobCount(count: number, options?: { timeoutMs?: number }): Promise<void> {
    await this.waitFor((states) => {
      const total = states.reduce((sum, s) => sum + s.activeJobs.length, 0);
      return total === count;
    }, options);
  }

  /**
   * Wait for no active jobs across all instances.
   */
  async waitForNoActiveJobs(options?: { timeoutMs?: number }): Promise<void> {
    await this.waitForActiveJobCount(0, options);
  }

  /**
   * Get total active jobs from cached state.
   */
  getTotalActiveJobs(): number {
    let total = 0;
    for (const state of this.states.values()) {
      total += state.activeJobs.length;
    }
    return total;
  }

  /**
   * Get cached state for an instance.
   */
  getCachedState(instanceId: string): InstanceState | undefined {
    return this.states.get(instanceId);
  }

  /**
   * Clear cached state.
   */
  clearCache(): void {
    this.states.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
