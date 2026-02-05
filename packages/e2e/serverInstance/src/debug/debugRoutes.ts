import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { isValidPresetName } from '../rateLimiterConfigs.js';
import type { ResetOptions, ResetResult, ServerState } from '../serverState.js';
import type { DebugEventEmitter } from './eventEmitter.js';
import type { JobHistoryTracker } from './jobHistoryTracker.js';

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_INTERNAL_ERROR = 500;

/** Dependencies for debug routes */
export interface DebugRouteDeps {
  state: ServerState;
  resetServer: (options?: ResetOptions) => Promise<ResetResult>;
}

/** Request body for reset endpoint */
interface ResetRequestBody {
  cleanRedis?: boolean;
  configPreset?: string;
}

/** Check if property has valid cleanRedis value */
const hasValidCleanRedisProperty = (obj: object): boolean => {
  if (!('cleanRedis' in obj)) {
    return true;
  }
  const { cleanRedis } = obj as { cleanRedis: unknown };
  return cleanRedis === undefined || typeof cleanRedis === 'boolean';
};

/** Check if property has valid configPreset value */
const hasValidConfigPresetProperty = (obj: object): boolean => {
  if (!('configPreset' in obj)) {
    return true;
  }
  const { configPreset } = obj as { configPreset: unknown };
  return configPreset === undefined || typeof configPreset === 'string';
};

/** Type guard to check if value matches ResetRequestBody */
const isResetRequestBody = (value: unknown): value is ResetRequestBody => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value !== 'object') {
    return false;
  }
  return hasValidCleanRedisProperty(value) && hasValidConfigPresetProperty(value);
};

/** Get current state components (for convenience) */
const getStateComponents = (
  state: ServerState
): {
  rateLimiter: ServerState['rateLimiter'];
  eventEmitter: DebugEventEmitter;
  jobHistoryTracker: JobHistoryTracker;
} => ({
  rateLimiter: state.rateLimiter,
  eventEmitter: state.eventEmitter,
  jobHistoryTracker: state.jobHistoryTracker,
});

/** Handler for GET /debug/stats */
const handleStats =
  (state: ServerState) =>
  (_req: Request, res: Response): void => {
    const { rateLimiter } = getStateComponents(state);
    const stats = rateLimiter.getStats();
    const instanceId = rateLimiter.getInstanceId();

    res.status(HTTP_STATUS_OK).json({
      instanceId,
      timestamp: Date.now(),
      stats,
    });
  };

/** Handler for GET /debug/active-jobs */
const handleActiveJobs =
  (state: ServerState) =>
  (_req: Request, res: Response): void => {
    const { rateLimiter } = getStateComponents(state);
    const activeJobs = rateLimiter.getActiveJobs();
    const instanceId = rateLimiter.getInstanceId();

    res.status(HTTP_STATUS_OK).json({
      instanceId,
      timestamp: Date.now(),
      activeJobs,
      count: activeJobs.length,
    });
  };

/** Handler for GET /debug/job-history */
const handleJobHistory =
  (state: ServerState) =>
  (_req: Request, res: Response): void => {
    const { rateLimiter, jobHistoryTracker } = getStateComponents(state);
    const history = jobHistoryTracker.getHistory();
    const summary = jobHistoryTracker.getSummary();
    const instanceId = rateLimiter.getInstanceId();

    res.status(HTTP_STATUS_OK).json({
      instanceId,
      timestamp: Date.now(),
      history,
      summary,
    });
  };

/** Parse reset options from request body */
const parseResetOptions = (body: ResetRequestBody | undefined): ResetOptions | { error: string } => {
  const { cleanRedis = true, configPreset } = body ?? {};

  if (configPreset !== undefined) {
    if (isValidPresetName(configPreset)) {
      return { cleanRedis, configPreset };
    }
    return { error: `Invalid configPreset: ${configPreset}` };
  }

  return { cleanRedis };
};

/** Check if result is an error */
const isParseError = (result: ResetOptions | { error: string }): result is { error: string } =>
  'error' in result;

/** Handler for POST /debug/reset */
const handleReset =
  (state: ServerState, resetServer: (options?: ResetOptions) => Promise<ResetResult>) =>
  (req: Request, res: Response): void => {
    const body = isResetRequestBody(req.body) ? req.body : undefined;
    const parseResult = parseResetOptions(body);

    if (isParseError(parseResult)) {
      res.status(HTTP_STATUS_BAD_REQUEST).json({
        success: false,
        error: parseResult.error,
        timestamp: Date.now(),
      });
      return;
    }

    resetServer(parseResult)
      .then((result) => {
        res.status(HTTP_STATUS_OK).json({
          ...result,
          timestamp: Date.now(),
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        res.status(HTTP_STATUS_INTERNAL_ERROR).json({
          success: false,
          error: message,
          timestamp: Date.now(),
        });
      });
  };

/** Handler for GET /debug/allocation */
const handleAllocation =
  (state: ServerState) =>
  (_req: Request, res: Response): void => {
    const { rateLimiter } = getStateComponents(state);
    const allocation = rateLimiter.getAllocation();
    const instanceId = rateLimiter.getInstanceId();

    res.status(HTTP_STATUS_OK).json({
      instanceId,
      timestamp: Date.now(),
      allocation,
    });
  };

/** Handler for GET /debug/events (SSE endpoint) */
const handleEvents =
  (state: ServerState) =>
  (req: Request, res: Response): void => {
    const { rateLimiter, eventEmitter } = getStateComponents(state);

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
  };

/**
 * Create debug routes for observability and testing.
 */
export const createDebugRoutes = (deps: DebugRouteDeps): Router => {
  const { state, resetServer } = deps;
  const router = createRouter();

  router.get('/stats', handleStats(state));
  router.get('/active-jobs', handleActiveJobs(state));
  router.get('/job-history', handleJobHistory(state));
  router.post('/reset', handleReset(state, resetServer));
  router.get('/allocation', handleAllocation(state));
  router.get('/events', handleEvents(state));

  return router;
};
