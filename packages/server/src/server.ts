/**
 * Express server setup.
 */
import type { Express } from 'express';

import { DEFAULT_FALLBACK_PORT, DEFAULT_PRIMARY_PORT, DEFAULT_REDIS_URL } from './constants.js';
import { logger } from './logger.js';
import { findAvailablePort } from './portUtils.js';
import { type ServerRateLimiter, createRateLimiterInstance } from './rateLimiterSetup.js';
import { createRoutes } from './routes.js';
import type { ServerConfig } from './types.js';

interface ServerInstance {
  app: Express;
  rateLimiter: ServerRateLimiter;
  port: number;
  close: () => Promise<void>;
}

/**
 * Create and start the Express server.
 */
export const createServer = async (config: ServerConfig = {}): Promise<ServerInstance> => {
  const {
    primaryPort = DEFAULT_PRIMARY_PORT,
    fallbackPort = DEFAULT_FALLBACK_PORT,
    redisUrl = DEFAULT_REDIS_URL,
  } = config;

  const port = await findAvailablePort([primaryPort, fallbackPort]);

  const rateLimiter = createRateLimiterInstance(redisUrl);
  await rateLimiter.start();
  logger.info('Rate limiter started');

  const app = express();

  app.use(express.json());
  app.use('/api', createRoutes(rateLimiter));

  const server = app.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}`);
    logger.info(`Queue endpoint: POST http://localhost:${port}/api/queue-job`);
  });

  const close = createCloseHandler({ server, rateLimiter });

  return { app, rateLimiter, port, close };
};

export const createCloseHandler = (params: CloseServerParams): (() => Promise<void>) => {
  const { server, rateLimiter } = params;

  return async (): Promise<void> => {
    rateLimiter.stop();
    logger.info('Rate limiter stopped');

    const closeAsync = promisify((callback: ServerCloseCallback) => {
      server.close(callback);
    });

    await closeAsync();
    logger.info('Server closed');
  };
};
