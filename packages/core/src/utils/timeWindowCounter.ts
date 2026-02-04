/**
 * Fixed time-window counter for rate limiting.
 * Used for RPM, RPD, TPM, TPD tracking.
 */

// Constants
const ZERO = 0;
const ONE = 1;

/**
 * Fixed time-window counter for rate limiting.
 */
export class TimeWindowCounter {
  private count = ZERO;
  private windowStart: number;
  private readonly windowMs: number;
  private limit: number;
  private readonly name: string;
  private readonly onLog?: (message: string, data?: Record<string, unknown>) => void;

  constructor(
    limit: number,
    windowMs: number,
    name: string,
    onLog?: (message: string, data?: Record<string, unknown>) => void
  ) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.name = name;
    this.onLog = onLog;
    this.windowStart = this.getCurrentWindowStart();
  }

  /**
   * Update the limit dynamically.
   * Used when distributed allocation changes (e.g., instances join/leave).
   */
  setLimit(newLimit: number): void {
    console.log(`[DEBUG] ${this.name} setLimit called: oldLimit=${this.limit}, newLimit=${newLimit}`);
    if (newLimit !== this.limit) {
      this.log(`Limit changed`, { oldLimit: this.limit, newLimit });
      this.limit = newLimit;
    }
  }

  private getCurrentWindowStart(): number {
    return Math.floor(Date.now() / this.windowMs) * this.windowMs;
  }

  private checkAndResetWindow(): void {
    const currentWindowStart = this.getCurrentWindowStart();
    if (currentWindowStart > this.windowStart) {
      this.log(`Window reset`, { previousCount: this.count });
      this.count = ZERO;
      this.windowStart = currentWindowStart;
    }
  }

  private log(message: string, data?: Record<string, unknown>): void {
    if (this.onLog !== undefined) {
      this.onLog(`${this.name}| ${message}`, data);
    }
  }

  hasCapacity(): boolean {
    return this.hasCapacityFor(ONE);
  }

  hasCapacityFor(amount: number): boolean {
    this.checkAndResetWindow();
    return this.count + amount <= this.limit;
  }

  increment(): void {
    this.checkAndResetWindow();
    this.count += ONE;
  }

  add(amount: number): void {
    this.checkAndResetWindow();
    this.count += amount;
  }

  /**
   * Get current window start timestamp.
   * Call this at reservation time to capture which window the job started in.
   * @returns Window start timestamp (ms since epoch, aligned to window boundary)
   */
  getWindowStart(): number {
    this.checkAndResetWindow();
    return this.windowStart;
  }

  /**
   * Subtract amount only if still in the same time window.
   * Used for time-aware capacity refunds - prevents refunding across window boundaries.
   * @param amount The amount to subtract (refund)
   * @param windowStart The window start captured at reservation time
   * @returns true if subtraction was applied, false if window has changed (no refund)
   */
  subtractIfSameWindow(amount: number, windowStart: number): boolean {
    this.checkAndResetWindow();
    if (this.windowStart !== windowStart) {
      // Window has changed since reservation - no refund
      this.log(`Refund skipped (window changed)`, {
        amount,
        reservedInWindow: windowStart,
        currentWindow: this.windowStart,
      });
      return false;
    }
    this.count = Math.max(ZERO, this.count - amount);
    this.log(`Refund applied`, { amount, newCount: this.count });
    return true;
  }

  getTimeUntilReset(): number {
    const nextWindowStart = this.windowStart + this.windowMs;
    return Math.max(ZERO, nextWindowStart - Date.now());
  }

  getStats(): { current: number; limit: number; remaining: number; resetsInMs: number } {
    this.checkAndResetWindow();
    return {
      current: this.count,
      limit: this.limit,
      remaining: Math.max(ZERO, this.limit - this.count),
      resetsInMs: this.getTimeUntilReset(),
    };
  }
}
