/**
 * Capacity checking and reservation helpers for the rate limiter.
 */
import type { CapacityEstimates, JobWindowStarts } from '../types.js';
import type { TimeWindowCounter } from './timeWindowCounter.js';

export type { CapacityEstimates };

const ZERO = 0;

/** Counters structure for capacity checking */
export interface CountersSet {
  rpmCounter: TimeWindowCounter | null;
  rpdCounter: TimeWindowCounter | null;
  tpmCounter: TimeWindowCounter | null;
  tpdCounter: TimeWindowCounter | null;
}

/** Check if time window counters have capacity for specified amounts */
export const hasTimeWindowCapacityForAmounts = (
  counters: CountersSet,
  requestCount: number,
  tokenCount: number
): boolean => {
  const { rpmCounter, rpdCounter, tpmCounter, tpdCounter } = counters;
  const requestCounters = [rpmCounter, rpdCounter].filter((c): c is TimeWindowCounter => c !== null);
  const tokenCounters = [tpmCounter, tpdCounter].filter((c): c is TimeWindowCounter => c !== null);
  const hasRequestCapacity = requestCounters.every((c) => c.hasCapacityFor(requestCount));
  const hasTokenCapacity = tokenCounters.every((c) => c.hasCapacityFor(tokenCount));
  return hasRequestCapacity && hasTokenCapacity;
};

/** Check if time window counters have capacity for single requests */
export const hasTimeWindowCapacity = (counters: CountersSet): boolean => {
  const { rpmCounter, rpdCounter, tpmCounter, tpdCounter } = counters;
  const requestCounters = [rpmCounter, rpdCounter].filter((c): c is TimeWindowCounter => c !== null);
  const tokenCounters = [tpmCounter, tpdCounter].filter((c): c is TimeWindowCounter => c !== null);
  return requestCounters.every((c) => c.hasCapacity()) && tokenCounters.every((c) => c.hasCapacity());
};

/** Capture current window starts from all counters */
export const captureWindowStarts = (counters: CountersSet): JobWindowStarts => ({
  rpmWindowStart: counters.rpmCounter?.getWindowStart(),
  rpdWindowStart: counters.rpdCounter?.getWindowStart(),
  tpmWindowStart: counters.tpmCounter?.getWindowStart(),
  tpdWindowStart: counters.tpdCounter?.getWindowStart(),
});

/** Reserve capacity in time window counters */
export const reserveTimeWindowCapacity = (counters: CountersSet, estimates: CapacityEstimates): void => {
  const { rpmCounter, rpdCounter, tpmCounter, tpdCounter } = counters;
  const { estimatedNumberOfRequests, estimatedUsedTokens } = estimates;
  if (estimatedNumberOfRequests > ZERO) {
    rpmCounter?.add(estimatedNumberOfRequests);
    rpdCounter?.add(estimatedNumberOfRequests);
  }
  if (estimatedUsedTokens > ZERO) {
    tpmCounter?.add(estimatedUsedTokens);
    tpdCounter?.add(estimatedUsedTokens);
  }
};

/** Release reservation from a single counter if same window */
const releaseFromCounter = (
  counter: TimeWindowCounter | null,
  amount: number,
  windowStart: number | undefined
): void => {
  if (windowStart !== undefined) {
    counter?.subtractIfSameWindow(amount, windowStart);
  }
};

/** Release time window reservation with window awareness */
export const releaseTimeWindowReservation = (
  counters: CountersSet,
  estimates: CapacityEstimates,
  windowStarts: JobWindowStarts
): void => {
  const { rpmCounter, rpdCounter, tpmCounter, tpdCounter } = counters;
  const { estimatedNumberOfRequests, estimatedUsedTokens } = estimates;
  if (estimatedNumberOfRequests > ZERO) {
    releaseFromCounter(rpmCounter, estimatedNumberOfRequests, windowStarts.rpmWindowStart);
    releaseFromCounter(rpdCounter, estimatedNumberOfRequests, windowStarts.rpdWindowStart);
  }
  if (estimatedUsedTokens > ZERO) {
    releaseFromCounter(tpmCounter, estimatedUsedTokens, windowStarts.tpmWindowStart);
    releaseFromCounter(tpdCounter, estimatedUsedTokens, windowStarts.tpdWindowStart);
  }
};

/** Get minimum value from an array of numbers, or default if empty */
const getMinFromArray = (values: number[], defaultValue: number): number => {
  if (values.length === ZERO) {
    return defaultValue;
  }
  return values.reduce((min, val) => (val < min ? val : min), values[ZERO] ?? defaultValue);
};

/** Map counters array to time until reset */
const mapToTimeUntilReset = (countersArray: TimeWindowCounter[]): number[] =>
  countersArray.map((c) => c.getTimeUntilReset());

/** Get minimum time until any counter has capacity */
export const getMinTimeUntilCapacity = (counters: CountersSet): number => {
  const { rpmCounter, rpdCounter, tpmCounter, tpdCounter } = counters;
  const countersArray = [rpmCounter, rpdCounter, tpmCounter, tpdCounter].filter(
    (c): c is TimeWindowCounter => c !== null
  );
  const times = mapToTimeUntilReset(countersArray);
  return getMinFromArray(times, ZERO);
};

/** Get time until next window reset */
export const getTimeUntilNextWindowReset = (counters: CountersSet): number => {
  const { rpmCounter, rpdCounter, tpmCounter, tpdCounter } = counters;
  const countersArray = [rpmCounter, rpdCounter, tpmCounter, tpdCounter].filter(
    (c): c is TimeWindowCounter => c !== null
  );
  const times: number[] = countersArray.map((c) => c.getTimeUntilReset());
  return getMinFromArray(times, Infinity);
};

/** Try to reserve capacity atomically, returns window starts if successful */
export const tryReserveCapacityAtomic = (
  counters: CountersSet,
  estimates: CapacityEstimates
): JobWindowStarts | null => {
  if (
    !hasTimeWindowCapacityForAmounts(
      counters,
      estimates.estimatedNumberOfRequests,
      estimates.estimatedUsedTokens
    )
  ) {
    return null;
  }
  const windowStarts = captureWindowStarts(counters);
  reserveTimeWindowCapacity(counters, estimates);
  return windowStarts;
};
