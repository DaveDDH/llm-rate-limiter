/**
 * Usage recording helpers for the rate limiter.
 */
import type { InternalJobResult, JobWindowStarts, OverageEvent, OverageResourceType } from '../types.js';
import type { CapacityEstimates, CountersSet } from './rateLimiterCapacityHelpers.js';
import type { TimeWindowCounter } from './timeWindowCounter.js';

const ZERO = 0;

type OverageCallback = (event: OverageEvent) => void;

/** Emit overage event if actual exceeds estimated */
export const emitOverageIfNeeded = (
  resourceType: OverageResourceType,
  estimated: number,
  actual: number,
  onOverage: OverageCallback | undefined
): void => {
  if (onOverage === undefined) {
    return;
  }
  if (actual > estimated) {
    onOverage({ resourceType, estimated, actual, overage: actual - estimated, timestamp: Date.now() });
  }
};

interface RecordUsageParams {
  counters: CountersSet;
  estimates: CapacityEstimates;
  windowStarts: JobWindowStarts;
  onOverage: OverageCallback | undefined;
}

/** Apply refund to a counter if same window */
const applyRefundToCounter = (
  counter: TimeWindowCounter | null,
  refund: number,
  windowStart: number | undefined
): void => {
  if (windowStart !== undefined) {
    counter?.subtractIfSameWindow(refund, windowStart);
  }
};

/** Parameters for applying difference to counters */
interface ApplyDifferenceParams {
  difference: number;
  minuteCounter: TimeWindowCounter | null;
  dayCounter: TimeWindowCounter | null;
  minuteWindowStart: number | undefined;
  dayWindowStart: number | undefined;
}

/** Apply difference to counters (add or refund) */
const applyDifferenceToCounters = (params: ApplyDifferenceParams): void => {
  const { difference, minuteCounter, dayCounter, minuteWindowStart, dayWindowStart } = params;
  if (difference < ZERO) {
    const refund = -difference;
    applyRefundToCounter(minuteCounter, refund, minuteWindowStart);
    applyRefundToCounter(dayCounter, refund, dayWindowStart);
  } else if (difference > ZERO) {
    minuteCounter?.add(difference);
    dayCounter?.add(difference);
  }
};

/** Add actual values to both counters */
const addToBothCounters = (
  actual: number,
  minuteCounter: TimeWindowCounter | null,
  dayCounter: TimeWindowCounter | null
): void => {
  minuteCounter?.add(actual);
  dayCounter?.add(actual);
};

/** Record actual request usage with time-window awareness */
export const recordRequestUsage = (actualRequests: number, params: RecordUsageParams): void => {
  const { counters, estimates, windowStarts } = params;
  const { rpmCounter, rpdCounter } = counters;
  const { estimatedNumberOfRequests } = estimates;
  if (estimatedNumberOfRequests === ZERO) {
    addToBothCounters(actualRequests, rpmCounter, rpdCounter);
    return;
  }
  const difference = actualRequests - estimatedNumberOfRequests;
  applyDifferenceToCounters({
    difference,
    minuteCounter: rpmCounter,
    dayCounter: rpdCounter,
    minuteWindowStart: windowStarts.rpmWindowStart,
    dayWindowStart: windowStarts.rpdWindowStart,
  });
};

/** Record actual token usage with time-window awareness */
export const recordTokenUsage = (actualTokens: number, params: RecordUsageParams): void => {
  const { counters, estimates, windowStarts } = params;
  const { tpmCounter, tpdCounter } = counters;
  const { estimatedUsedTokens } = estimates;
  if (estimatedUsedTokens === ZERO) {
    addToBothCounters(actualTokens, tpmCounter, tpdCounter);
    return;
  }
  const difference = actualTokens - estimatedUsedTokens;
  applyDifferenceToCounters({
    difference,
    minuteCounter: tpmCounter,
    dayCounter: tpdCounter,
    minuteWindowStart: windowStarts.tpmWindowStart,
    dayWindowStart: windowStarts.tpdWindowStart,
  });
};

/** Record all actual usage for a completed job */
export const recordActualUsage = (result: InternalJobResult, params: RecordUsageParams): void => {
  const { requestCount: actualRequests, usage } = result;
  const actualTokens = usage.input + usage.output + usage.cached;
  recordRequestUsage(actualRequests, params);
  recordTokenUsage(actualTokens, params);
  emitOverageIfNeeded(
    'requests',
    params.estimates.estimatedNumberOfRequests,
    actualRequests,
    params.onOverage
  );
  emitOverageIfNeeded('tokens', params.estimates.estimatedUsedTokens, actualTokens, params.onOverage);
};
