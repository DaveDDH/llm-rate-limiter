import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import type { ServerRateLimiter } from '../rateLimiterSetup.js';
import type { DebugEventEmitter } from './eventEmitter.js';
import type { JobHistoryTracker } from './jobHistoryTracker.js';

const HTTP_STATUS_OK = 200;

/** Dependencies for debug routes */
export interface DebugRouteDeps {
  rateLimiter: ServerRateLimiter;
  eventEmitter: DebugEventEmitter;
  jobHistoryTracker: JobHistoryTracker;
}

/**
 * Create debug routes for observability and testing.
 */
export const createDebugRoutes = (deps: DebugRouteDeps): Router => {
  const { rateLimiter, eventEmitter, jobHistoryTracker } = deps;
  const router = createRouter();

  /**
   * GET /debug/stats
   * Returns full rate limiter stats including models, job types, and memory.
   */
  router.get('/stats', (_req: Request, res: Response): void => {
    const stats = rateLimiter.getStats();
    const instanceId = rateLimiter.getInstanceId();

    res.status(HTTP_STATUS_OK).json({
      instanceId,
      timestamp: Date.now(),
      stats,
    });
  });

  /**
   * GET /debug/active-jobs
   * Returns all active jobs (waiting or processing) from the rate limiter.
   */
  router.get('/active-jobs', (_req: Request, res: Response): void => {
    const activeJobs = rateLimiter.getActiveJobs();
    const instanceId = rateLimiter.getInstanceId();

    res.status(HTTP_STATUS_OK).json({
      instanceId,
      timestamp: Date.now(),
      activeJobs,
      count: activeJobs.length,
    });
  });

  /**
   * GET /debug/job-history
   * Returns historical completed and failed jobs.
   */
  router.get('/job-history', (_req: Request, res: Response): void => {
    const history = jobHistoryTracker.getHistory();
    const summary = jobHistoryTracker.getSummary();
    const instanceId = rateLimiter.getInstanceId();

    res.status(HTTP_STATUS_OK).json({
      instanceId,
      timestamp: Date.now(),
      history,
      summary,
    });
  });

  /**
   * GET /debug/events
   * SSE endpoint for real-time event streaming.
   */
  router.get('/events', (req: Request, res: Response): void => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Flush headers immediately
    res.flushHeaders();

    // Add client to event emitter
    const clientId = eventEmitter.addClient(res);

    // Send initial connection event
    const initialEvent = {
      type: 'connected',
      instanceId: rateLimiter.getInstanceId(),
      timestamp: Date.now(),
      clientId,
    };
    res.write(`data: ${JSON.stringify(initialEvent)}\n\n`);

    // Handle client disconnect
    req.on('close', () => {
      eventEmitter.removeClient(clientId);
    });
  });

  return router;
};
