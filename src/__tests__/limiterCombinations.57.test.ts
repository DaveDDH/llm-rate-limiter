import {
  allLimiters,
  buildHighLimitConfig,
  combinations,
  createLLMRateLimiter,
  FIFTY_SEVEN,
  FIVE,
  ONE,
  SIX,
  testSemaphoreBlocker,
  testTimeWindowBlocker,
  THREE,
  TWO,
} from './limiterCombinations.helpers.js';

import type { LimiterType, LLMRateLimiterInstance } from './limiterCombinations.helpers.js';

const FOUR = 4;

// Generate all combinations of 2 or more limiters
const allCombinations: LimiterType[][] = [];
for (let k = TWO; k <= SIX; k += ONE) {
  allCombinations.push(...combinations(allLimiters, k));
}

// Verify we have exactly 57 combinations
if (allCombinations.length !== FIFTY_SEVEN) {
  throw new Error(`Expected 57 combinations, got ${allCombinations.length}`);
}

type LimiterSetter = (l: LLMRateLimiterInstance) => void;

const testCombo = (combo: LimiterType[], setLimiter: LimiterSetter): void => {
  for (const blocker of combo) {
    it(`should block when ${blocker} is exhausted`, async () => {
      if (blocker === 'memory' || blocker === 'concurrency') {
        await testSemaphoreBlocker(combo, blocker, setLimiter);
      } else {
        await testTimeWindowBlocker(combo, blocker, setLimiter);
      }
    });
  }
  it('should have capacity when no limiter is exhausted', () => {
    const config = buildHighLimitConfig(combo);
    const newLimiter = createLLMRateLimiter(config);
    setLimiter(newLimiter);
    expect(newLimiter.hasCapacity()).toBe(true);
  });
};

describe('Combinations of 2 limiters (15)', () => {
  let current: LLMRateLimiterInstance | undefined = undefined;
  const setLimiter: LimiterSetter = (l) => { current = l; };
  afterEach(() => { current?.stop(); current = undefined; });
  const combos = combinations(allLimiters, TWO);
  for (const combo of combos) {
    describe(combo.join(' + '), () => { testCombo(combo, setLimiter); });
  }
});

describe('Combinations of 3 limiters (20)', () => {
  let current: LLMRateLimiterInstance | undefined = undefined;
  const setLimiter: LimiterSetter = (l) => { current = l; };
  afterEach(() => { current?.stop(); current = undefined; });
  const combos = combinations(allLimiters, THREE);
  for (const combo of combos) {
    describe(combo.join(' + '), () => { testCombo(combo, setLimiter); });
  }
});

describe('Combinations of 4 limiters (15)', () => {
  let current: LLMRateLimiterInstance | undefined = undefined;
  const setLimiter: LimiterSetter = (l) => { current = l; };
  afterEach(() => { current?.stop(); current = undefined; });
  const combos = combinations(allLimiters, FOUR);
  for (const combo of combos) {
    describe(combo.join(' + '), () => { testCombo(combo, setLimiter); });
  }
});

describe('Combinations of 5 limiters (6)', () => {
  let current: LLMRateLimiterInstance | undefined = undefined;
  const setLimiter: LimiterSetter = (l) => { current = l; };
  afterEach(() => { current?.stop(); current = undefined; });
  const combos = combinations(allLimiters, FIVE);
  for (const combo of combos) {
    describe(combo.join(' + '), () => { testCombo(combo, setLimiter); });
  }
});

describe('All 6 limiters', () => {
  let current: LLMRateLimiterInstance | undefined = undefined;
  const setLimiter: LimiterSetter = (l) => { current = l; };
  afterEach(() => { current?.stop(); current = undefined; });
  const combo = allLimiters;
  describe(combo.join(' + '), () => { testCombo(combo, setLimiter); });
});
