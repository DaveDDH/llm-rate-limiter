import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { TimeWindowCounter } from '../utils/timeWindowCounter.js';

const WINDOW_MS = 1000;
const LIMIT = 5;
const COUNTER_NAME = 'TestCounter';
const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FOUR = 4;
const TEN = 10;
const SHORT_WINDOW_MS = 50;
const EXTRA_WAIT_MS = 10;

describe('TimeWindowCounter - hasCapacity', () => {
  it('should have capacity when count is below limit', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    expect(counter.hasCapacity()).toBe(true);
  });

  it('should not have capacity when count reaches limit', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    for (let i = ZERO; i < LIMIT; i += ONE) {
      counter.increment();
    }
    expect(counter.hasCapacity()).toBe(false);
  });

  it('should have capacity after adding tokens below limit', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    counter.add(THREE);
    expect(counter.hasCapacity()).toBe(true);
  });

  it('should not have capacity after adding tokens at limit', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    counter.add(LIMIT);
    expect(counter.hasCapacity()).toBe(false);
  });
});

describe('TimeWindowCounter - increment', () => {
  it('should increment count by 1', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    counter.increment();
    const stats = counter.getStats();
    expect(stats.current).toBe(ONE);
  });

  it('should increment count multiple times', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    for (let i = ZERO; i < THREE; i += ONE) {
      counter.increment();
    }
    const stats = counter.getStats();
    expect(stats.current).toBe(THREE);
  });
});

describe('TimeWindowCounter - add', () => {
  it('should add specified amount to count', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    counter.add(THREE);
    const stats = counter.getStats();
    expect(stats.current).toBe(THREE);
  });

  it('should accumulate multiple adds', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    counter.add(TWO);
    counter.add(THREE);
    const stats = counter.getStats();
    expect(stats.current).toBe(TWO + THREE);
  });
});

describe('TimeWindowCounter - subtract', () => {
  it('should subtract specified amount from count', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    counter.add(LIMIT);
    counter.subtract(TWO);
    const stats = counter.getStats();
    expect(stats.current).toBe(LIMIT - TWO);
  });

  it('should not go below zero when subtracting more than current count', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    counter.add(THREE);
    counter.subtract(TEN);
    const stats = counter.getStats();
    expect(stats.current).toBe(ZERO);
  });

  it('should handle subtracting from zero count', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    counter.subtract(LIMIT);
    const stats = counter.getStats();
    expect(stats.current).toBe(ZERO);
  });

  it('should restore capacity after subtraction', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    counter.add(LIMIT);
    expect(counter.hasCapacity()).toBe(false);
    counter.subtract(TWO);
    expect(counter.hasCapacity()).toBe(true);
  });

  it('should work correctly after multiple add and subtract operations', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    counter.add(FOUR);
    counter.subtract(TWO);
    counter.add(THREE);
    counter.subtract(ONE);
    const stats = counter.getStats();
    expect(stats.current).toBe(FOUR);
  });
});

describe('TimeWindowCounter - getStats', () => {
  it('should return correct initial stats', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    const stats = counter.getStats();
    expect(stats.current).toBe(ZERO);
    expect(stats.limit).toBe(LIMIT);
    expect(stats.remaining).toBe(LIMIT);
    expect(stats.resetsInMs).toBeGreaterThanOrEqual(ZERO);
    expect(stats.resetsInMs).toBeLessThanOrEqual(WINDOW_MS);
  });

  it('should return correct stats after incrementing', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    for (let i = ZERO; i < TWO; i += ONE) {
      counter.increment();
    }
    const stats = counter.getStats();
    expect(stats.current).toBe(TWO);
    expect(stats.remaining).toBe(LIMIT - TWO);
  });

  it('should return 0 remaining when at limit', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    counter.add(LIMIT);
    const stats = counter.getStats();
    expect(stats.remaining).toBe(ZERO);
  });
});

describe('TimeWindowCounter - getTimeUntilReset', () => {
  it('should return time until window reset', () => {
    const counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
    const timeUntilReset = counter.getTimeUntilReset();
    expect(timeUntilReset).toBeGreaterThanOrEqual(ZERO);
    expect(timeUntilReset).toBeLessThanOrEqual(WINDOW_MS);
  });
});

describe('TimeWindowCounter - window reset', () => {
  it('should reset count after window expires', async () => {
    const shortCounter = new TimeWindowCounter(LIMIT, SHORT_WINDOW_MS, COUNTER_NAME);

    shortCounter.add(LIMIT);
    expect(shortCounter.hasCapacity()).toBe(false);

    await setTimeoutAsync(SHORT_WINDOW_MS + EXTRA_WAIT_MS);

    expect(shortCounter.hasCapacity()).toBe(true);
    const stats = shortCounter.getStats();
    expect(stats.current).toBe(ZERO);
  });
});

describe('TimeWindowCounter - logging', () => {
  it('should call onLog when window resets', async () => {
    const logMessages: string[] = [];
    const onLog = (message: string): void => {
      logMessages.push(message);
    };

    const loggedCounter = new TimeWindowCounter(LIMIT, SHORT_WINDOW_MS, COUNTER_NAME, onLog);
    loggedCounter.increment();

    await setTimeoutAsync(SHORT_WINDOW_MS + EXTRA_WAIT_MS);

    loggedCounter.hasCapacity();

    expect(logMessages.some((msg) => msg.includes('Window reset'))).toBe(true);
  });
});
