import type { Response } from 'express';

import type {
  AvailabilityPayload,
  DebugEvent,
  DebugEventType,
  JobCompletedPayload,
  JobFailedPayload,
  JobQueuedPayload,
  JobStartedPayload,
} from './types.js';

const ZERO = 0;
const ONE = 1;

interface SSEClientEntry {
  id: string;
  res: Response;
}

/**
 * Manages SSE connections and broadcasts debug events to connected clients.
 */
export class DebugEventEmitter {
  private readonly clients = new Map<string, SSEClientEntry>();
  private readonly instanceId: string;
  private clientCounter = ZERO;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  /**
   * Add a new SSE client connection.
   * Returns the client ID for later removal.
   */
  addClient(res: Response): string {
    this.clientCounter += ONE;
    const id = `client-${this.clientCounter}`;

    this.clients.set(id, { id, res });

    // Set up cleanup on connection close
    res.on('close', () => {
      this.removeClient(id);
    });

    return id;
  }

  /**
   * Remove a client connection.
   */
  removeClient(id: string): void {
    this.clients.delete(id);
  }

  /**
   * Get the number of connected clients.
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Broadcast an event to all connected clients.
   */
  private broadcast(type: DebugEventType, payload: unknown): void {
    const event: DebugEvent = {
      type,
      instanceId: this.instanceId,
      timestamp: Date.now(),
      payload,
    };

    const data = `data: ${JSON.stringify(event)}\n\n`;

    for (const client of this.clients.values()) {
      try {
        client.res.write(data);
      } catch {
        // Client disconnected, remove it
        this.removeClient(client.id);
      }
    }
  }

  /**
   * Emit a job:queued event.
   */
  emitJobQueued(payload: JobQueuedPayload): void {
    this.broadcast('job:queued', payload);
  }

  /**
   * Emit a job:started event.
   */
  emitJobStarted(payload: JobStartedPayload): void {
    this.broadcast('job:started', payload);
  }

  /**
   * Emit a job:completed event.
   */
  emitJobCompleted(payload: JobCompletedPayload): void {
    this.broadcast('job:completed', payload);
  }

  /**
   * Emit a job:failed event.
   */
  emitJobFailed(payload: JobFailedPayload): void {
    this.broadcast('job:failed', payload);
  }

  /**
   * Emit an availability event.
   */
  emitAvailability(payload: AvailabilityPayload): void {
    this.broadcast('availability', payload);
  }

  /**
   * Close all client connections.
   */
  closeAll(): void {
    for (const client of this.clients.values()) {
      try {
        client.res.end();
      } catch {
        // Ignore errors on close
      }
    }
    this.clients.clear();
  }
}
