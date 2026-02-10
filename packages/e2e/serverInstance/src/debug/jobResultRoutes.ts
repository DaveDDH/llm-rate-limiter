import type { Request, Response } from 'express';

import type { ServerState } from '../serverState.js';
import type { HistoricalJob } from './types.js';

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_NOT_FOUND = 404;

/** Transform a HistoricalJob into the API response format */
const toJobResultResponse = (job: HistoricalJob): Record<string, unknown> => ({
  jobId: job.jobId,
  status: job.status,
  modelUsed: job.modelUsed,
  startTime: job.startedAt,
  endTime: job.completedAt,
  queueDuration: job.startedAt - job.queuedAt,
  executionDuration: job.completedAt - job.startedAt,
  error: job.error,
});

/** Handler for GET /debug/job-result/:jobId */
export const handleJobResult =
  (state: ServerState) =>
  (req: Request, res: Response): void => {
    const { params } = req;
    const jobId = typeof params.jobId === 'string' ? params.jobId : undefined;

    if (jobId === undefined) {
      res.status(HTTP_STATUS_BAD_REQUEST).json({ error: 'Missing jobId' });
      return;
    }

    const job = state.jobHistoryTracker.getJob(jobId);

    if (job === undefined) {
      res.status(HTTP_STATUS_NOT_FOUND).json({ error: 'Job not found' });
      return;
    }

    res.status(HTTP_STATUS_OK).json({
      ...toJobResultResponse(job),
      instanceId: state.rateLimiter.getInstanceId(),
    });
  };

/** Handler for GET /debug/job-results (bulk) */
export const handleJobResults =
  (state: ServerState) =>
  (_req: Request, res: Response): void => {
    const history = state.jobHistoryTracker.getHistory();
    const results = history.map(toJobResultResponse);

    res.status(HTTP_STATUS_OK).json({
      instanceId: state.rateLimiter.getInstanceId(),
      results,
    });
  };
