/**
 * Express routes for the job queue API.
 */
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { HTTP_STATUS_ACCEPTED, HTTP_STATUS_BAD_REQUEST, HTTP_STATUS_CONFLICT, HTTP_STATUS_NOT_FOUND } from './constants.js';
import { handleJobComplete, handleJobError, processJob } from './jobHandler.js';
import { addJob, getAllJobs, getJob } from './jobQueue.js';
import { logger } from './logger.js';
import type { ServerRateLimiter } from './rateLimiterSetup.js';
import type { ErrorResponse, QueuedJob, QueueJobResponse } from './types.js';
import { validateQueueJobRequest } from './validation.js';

const createQueueJobHandler = (rateLimiter: ServerRateLimiter) =>
  (req: Request, res: Response<QueueJobResponse | ErrorResponse>): void => {
    const validation = validateQueueJobRequest(req.body);

    if (!validation.valid) {
      res.status(HTTP_STATUS_BAD_REQUEST).json({
        success: false,
        error: validation.error,
      });
      return;
    }

    const { data } = validation;
    const { jobId, jobType, payload } = data;

    if (getJob(jobId) !== undefined) {
      res.status(HTTP_STATUS_CONFLICT).json({
        success: false,
        error: `Job with ID "${jobId}" already exists`,
      });
      return;
    }

    const queuedJob: QueuedJob = {
      jobId,
      jobType,
      payload,
      queuedAt: new Date(),
      status: 'pending',
    };

    addJob(queuedJob);

    queueJobToLimiter({ rateLimiter, jobId, jobType, payload });

    res.status(HTTP_STATUS_ACCEPTED).json({
      success: true,
      jobId,
      message: 'Job queued successfully',
    });
  };

interface QueueJobToLimiterParams {
  rateLimiter: ServerRateLimiter;
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
}

const queueJobToLimiter = (params: QueueJobToLimiterParams): void => {
  const { rateLimiter, jobId, jobType, payload } = params;

  rateLimiter
    .queueJob({
      jobId,
      jobType: 'default',
      job: (args) => processJob({ jobId, jobType, payload, modelId: args.modelId }),
      onComplete: (result, context) => {
        handleJobComplete({
          jobId,
          modelUsed: result.modelUsed,
          totalCost: context.totalCost,
        });
      },
      onError: (error, context) => {
        handleJobError({
          jobId,
          error,
          totalCost: context.totalCost,
        });
      },
    })
    .catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Job ${jobId} queue error`, { error: errorMessage });
    });
};

const createGetJobHandler = () =>
  (req: Request<{ jobId: string }>, res: Response<QueuedJob | ErrorResponse>): void => {
    const { params } = req;
    const { jobId } = params;
    const job = getJob(jobId);
    if (job === undefined) {
      res.status(HTTP_STATUS_NOT_FOUND).json({
        success: false,
        error: `Job with ID "${jobId}" not found`,
      });
      return;
    }
    res.json(job);
  };

const createHealthHandler = (rateLimiter: ServerRateLimiter) =>
  (_req: Request, res: Response): void => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      rateLimiter: {
        hasCapacity: rateLimiter.hasCapacity(),
        stats: rateLimiter.getStats(),
      },
    });
  };

/**
 * Create routes for the job queue API.
 */
export const createRoutes = (rateLimiter: ServerRateLimiter): Router => {
  const router = createRouter();

  router.post('/queue-job', createQueueJobHandler(rateLimiter));
  router.get('/jobs', (_req: Request, res: Response<QueuedJob[]>): void => {
    res.json(getAllJobs());
  });
  router.get('/jobs/:jobId', createGetJobHandler());
  router.get('/health', createHealthHandler(rateLimiter));

  return router;
};
