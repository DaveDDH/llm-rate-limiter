/**
 * FIFO queue for jobs waiting for capacity with timeout support.
 * Jobs are queued and served in order when capacity becomes available.
 */

/** Waiter entry in the queue */
interface QueuedWaiter {
  /** Resolve the promise with true (capacity acquired) or false (timed out) */
  resolve: (acquired: boolean) => void;
  /** Timeout handle for cleanup */
  timeoutId: NodeJS.Timeout | null;
  /** Whether this waiter has been resolved (to prevent double resolution) */
  resolved: boolean;
}

// Constants
const ZERO = 0;

/**
 * A FIFO queue for jobs waiting for capacity.
 * When capacity becomes available, the first waiter in line gets to try reserving it.
 * Each waiter has an individual timeout after which they are removed from the queue.
 */
export class CapacityWaitQueue {
  private readonly queue: QueuedWaiter[] = [];
  private readonly name: string;

  constructor(name = 'CapacityWaitQueue') {
    this.name = name;
  }

  /**
   * Wait for capacity with a timeout.
   * @param tryReserve Function that attempts to atomically reserve capacity. Returns true if successful.
   * @param maxWaitMS Maximum time to wait in milliseconds. 0 means no waiting (fail fast).
   * @returns Promise that resolves to true if capacity was reserved, false if timed out.
   */
  async waitForCapacity(tryReserve: () => boolean, maxWaitMS: number): Promise<boolean> {
    // Fail fast: don't wait at all
    if (maxWaitMS === ZERO) {
      return tryReserve();
    }

    // Try to reserve immediately before queuing
    if (tryReserve()) {
      return true;
    }

    // Create waiter entry
    const { promise, resolve } = Promise.withResolvers<boolean>();

    const waiter: QueuedWaiter = {
      resolve: (acquired: boolean) => {
        if (waiter.resolved) return; // Prevent double resolution
        waiter.resolved = true;
        if (waiter.timeoutId !== null) {
          clearTimeout(waiter.timeoutId);
          waiter.timeoutId = null;
        }
        resolve(acquired);
      },
      timeoutId: null,
      resolved: false,
    };

    // Set up timeout
    waiter.timeoutId = setTimeout(() => {
      this.removeWaiter(waiter);
      waiter.resolve(false); // Timed out
    }, maxWaitMS);

    // Add to queue (FIFO)
    this.queue.push(waiter);

    return promise;
  }

  /**
   * Notify the queue that capacity may be available.
   * Attempts to serve waiters in FIFO order.
   * @param tryReserve Function that attempts to atomically reserve capacity.
   */
  notifyCapacityAvailable(tryReserve: () => boolean): void {
    this.processQueue(tryReserve);
  }

  /**
   * Process the queue and serve waiters that can acquire capacity.
   */
  private processQueue(tryReserve: () => boolean): void {
    while (this.queue.length > ZERO) {
      const firstWaiter = this.queue[ZERO];
      if (firstWaiter === undefined || firstWaiter.resolved) {
        // Remove stale entry
        this.queue.shift();
        continue;
      }

      // Try to reserve for this waiter
      if (tryReserve()) {
        this.queue.shift();
        firstWaiter.resolve(true); // Capacity acquired
      } else {
        // No more capacity available, stop processing
        break;
      }
    }
  }

  /**
   * Remove a waiter from the queue (used when timeout fires).
   */
  private removeWaiter(waiter: QueuedWaiter): void {
    const index = this.queue.indexOf(waiter);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
  }

  /**
   * Get the number of waiters in the queue.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Clear all waiters from the queue (used during shutdown).
   * All waiters are resolved with false.
   */
  clear(): void {
    while (this.queue.length > ZERO) {
      const waiter = this.queue.shift();
      if (waiter !== undefined && !waiter.resolved) {
        waiter.resolve(false);
      }
    }
  }
}
