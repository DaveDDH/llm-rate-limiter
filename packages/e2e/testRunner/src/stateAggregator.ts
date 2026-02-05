import type { ActiveJobInfo, AllocationInfo, LLMRateLimiterStats } from '@llm-rate-limiter/core';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_TIMEOUT_MS = 30000;
const HTTP_OK = 200;
const ZERO = 0;

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
  /** Distributed allocation info (per-model pools) */
  allocation: AllocationInfo | null;
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
  allocation?: AllocationInfo | null;
}

/** Response from /api/debug/active-jobs endpoint */
interface ActiveJobsResponse {
  instanceId: string;
  timestamp: number;
  activeJobs: ActiveJobInfo[];
  count: number;
}

/**
 * Sleep helper using native timers/promises
 */
const sleep = async (ms: number): Promise<void> => {
  await setTimeoutPromise(ms);
};

/**
 * Check if response is valid JSON response
 */
const isValidJsonResponse = (response: Response): boolean => response.status === HTTP_OK;

/**
 * Parse and validate JSON response
 */
const parseJsonResponse = async (response: Response): Promise<unknown> => {
  const data: unknown = await response.json();
  return data;
};

/**
 * Fetch JSON from URL using native fetch for StatsResponse
 */
const fetchStatsJson = async (url: string): Promise<StatsResponse | null> => {
  try {
    const response = await fetch(url);
    if (!isValidJsonResponse(response)) {
      return null;
    }
    const data = await parseJsonResponse(response);
    if (isStatsResponse(data)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Fetch JSON from URL using native fetch for ActiveJobsResponse
 */
const fetchActiveJobsJson = async (url: string): Promise<ActiveJobsResponse | null> => {
  try {
    const response = await fetch(url);
    if (!isValidJsonResponse(response)) {
      return null;
    }
    const data = await parseJsonResponse(response);
    if (isActiveJobsResponse(data)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Type guard for StatsResponse
 */
const isStatsResponse = (value: unknown): value is StatsResponse =>
  typeof value === 'object' && value !== null && 'instanceId' in value && 'stats' in value;

/**
 * Type guard for ActiveJobsResponse
 */
const isActiveJobsResponse = (value: unknown): value is ActiveJobsResponse =>
  typeof value === 'object' && value !== null && 'instanceId' in value && 'activeJobs' in value;

/**
 * Fetch instance state from a single URL
 */
const fetchSingleInstanceState = async (baseUrl: string): Promise<InstanceState | null> => {
  try {
    const [statsResponse, activeJobsResponse] = await Promise.all([
      fetchStatsJson(`${baseUrl}/api/debug/stats`),
      fetchActiveJobsJson(`${baseUrl}/api/debug/active-jobs`),
    ]);

    if (statsResponse === null || activeJobsResponse === null) {
      return null;
    }

    return {
      instanceId: statsResponse.instanceId,
      stats: statsResponse.stats,
      activeJobs: activeJobsResponse.activeJobs,
      lastUpdate: statsResponse.timestamp,
      allocation: statsResponse.allocation ?? null,
    };
  } catch {
    return null;
  }
};

/**
 * Calculate total available slots from model stats
 */
const calculateAvailableSlotsForInstance = (instance: InstanceState): number => {
  let slots = ZERO;

  for (const modelStats of Object.values(instance.stats.models)) {
    if (modelStats.concurrency !== undefined) {
      slots += modelStats.concurrency.available;
    }
  }

  return slots;
};

/**
 * Aggregates state from multiple rate limiter instances.
 * Useful for E2E testing distributed rate limiting behavior.
 */
export class StateAggregator {
  private readonly instanceUrls: string[];
  private readonly states = new Map<string, InstanceState>();

  constructor(instanceUrls: string[]) {
    this.instanceUrls = instanceUrls;
  }

  /**
   * Fetch current state from all instances.
   */
  async fetchState(): Promise<InstanceState[]> {
    const fetchPromises = this.instanceUrls.map(async (url) => await fetchSingleInstanceState(url));
    const results = await Promise.all(fetchPromises);

    // Update internal state cache
    for (const state of results) {
      if (state !== null) {
        this.states.set(state.instanceId, state);
      }
    }

    return results.filter((s): s is InstanceState => s !== null);
  }

  /**
   * Get aggregated state across all instances.
   */
  async getAggregatedState(): Promise<AggregatedState> {
    const instanceList = await this.fetchState();

    let totalActiveJobs = ZERO;
    let totalAvailableSlots = ZERO;

    for (const instance of instanceList) {
      totalActiveJobs += instance.activeJobs.length;
      totalAvailableSlots += calculateAvailableSlotsForInstance(instance);
    }

    return {
      instances: instanceList,
      totalActiveJobs,
      totalAvailableSlots,
    };
  }

  /**
   * Check if condition is met
   */
  private async checkCondition(predicate: (states: InstanceState[]) => boolean): Promise<boolean> {
    const states = await this.fetchState();
    return predicate(states);
  }

  /**
   * Poll for condition using recursive approach to avoid await-in-loop
   */
  private async pollRecursive(
    predicate: (states: InstanceState[]) => boolean,
    startTime: number,
    timeoutMs: number,
    pollIntervalMs: number
  ): Promise<boolean> {
    if (Date.now() - startTime >= timeoutMs) {
      return false;
    }

    const conditionMet = await this.checkCondition(predicate);
    if (conditionMet) {
      return true;
    }

    await sleep(pollIntervalMs);
    return await this.pollRecursive(predicate, startTime, timeoutMs, pollIntervalMs);
  }

  /**
   * Poll for condition until satisfied or timeout
   */
  private async pollForCondition(
    predicate: (states: InstanceState[]) => boolean,
    timeoutMs: number,
    pollIntervalMs: number
  ): Promise<boolean> {
    const conditionMet = await this.checkCondition(predicate);
    if (conditionMet) {
      return true;
    }

    await sleep(pollIntervalMs);
    return await this.pollRecursive(predicate, Date.now(), timeoutMs, pollIntervalMs);
  }

  /**
   * Wait for a condition to be true across instances.
   */
  async waitFor(
    predicate: (states: InstanceState[]) => boolean,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<void> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = options;

    const success = await this.pollForCondition(predicate, timeoutMs, pollIntervalMs);

    if (!success) {
      throw new Error(`waitFor timeout after ${timeoutMs}ms`);
    }
  }

  /**
   * Wait for a specific number of active jobs across all instances.
   */
  async waitForActiveJobCount(count: number, options?: { timeoutMs?: number }): Promise<void> {
    await this.waitFor((states) => {
      const total = states.reduce((sum, s) => sum + s.activeJobs.length, ZERO);
      return total === count;
    }, options);
  }

  /**
   * Wait for no active jobs across all instances.
   */
  async waitForNoActiveJobs(options?: { timeoutMs?: number }): Promise<void> {
    await this.waitForActiveJobCount(ZERO, options);
  }

  /**
   * Get total active jobs from cached state.
   */
  getTotalActiveJobs(): number {
    let total = ZERO;
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
}
