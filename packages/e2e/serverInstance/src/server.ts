import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { promisify } from 'node:util';

import { DebugEventEmitter, JobHistoryTracker, createDebugRoutes } from './debug/index.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { findAvailablePort } from './portUtils.js';
import { type ServerRateLimiter, createRateLimiterInstance } from './rateLimiterSetup.js';
import { createRoutes } from './routes.js';
import type { ServerConfig } from './types.js';

interface CloseServerParams {
  server: Server;
  rateLimiter: ServerRateLimiter;
  eventEmitter: DebugEventEmitter;
  jobHistoryTracker: JobHistoryTracker;
}

type ServerCloseCallback = (err?: Error) => void;

interface ServerInstance {
  app: Express;
  rateLimiter: ServerRateLimiter;
  port: number;
  close: () => Promise<void>;
}

export const createServer = async (config: ServerConfig = {}): Promise<ServerInstance> => {
  const { primaryPort = env.port, fallbackPort = env.fallbackPort, redisUrl = env.redisUrl } = config;

  const port = await findAvailablePort([primaryPort, fallbackPort]);

  // Create debug components first (need instanceId from rate limiter)
  const jobHistoryTracker = new JobHistoryTracker();

  // Create rate limiter with availability change callback
  const rateLimiter = createRateLimiterInstance(redisUrl);

  // Create event emitter with instance ID
  const eventEmitter = new DebugEventEmitter(rateLimiter.getInstanceId());

  await rateLimiter.start();
  logger.info('Rate limiter started');

  const app = express();

  app.use(express.json());

  // Mount main routes with debug components
  app.use('/api', createRoutes({ rateLimiter, eventEmitter, jobHistoryTracker }));

  // Mount debug routes
  app.use('/api/debug', createDebugRoutes({ rateLimiter, eventEmitter, jobHistoryTracker }));

  const server = app.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}`);
    logger.info(`Queue endpoint: POST http://localhost:${port}/api/queue-job`);
    logger.info(`Debug SSE: GET http://localhost:${port}/api/debug/events`);
  });

  const close = createCloseHandler({ server, rateLimiter, eventEmitter, jobHistoryTracker });

  return { app, rateLimiter, port, close };
};

export const createCloseHandler = (params: CloseServerParams): (() => Promise<void>) => {
  const { server, rateLimiter, eventEmitter, jobHistoryTracker } = params;

  return async (): Promise<void> => {
    // Close SSE connections first
    eventEmitter.closeAll();
    logger.info('SSE connections closed');

    // Stop job history tracker cleanup interval
    jobHistoryTracker.stop();

    rateLimiter.stop();
    logger.info('Rate limiter stopped');

    const closeAsync = promisify((callback: ServerCloseCallback) => {
      server.close(callback);
    });

    await closeAsync();
    logger.info('Server closed');
  };
};
