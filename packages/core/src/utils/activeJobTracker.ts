/**
 * Active job tracking utilities for the LLM Rate Limiter.
 */
import type { ActiveJobInfo, ActiveJobStatus } from '../activeJobTypes.js';

/** Create initial active job info for a new job */
export const createInitialActiveJobInfo = (
  jobId: string,
  jobType: string,
  queuedAt: number
): ActiveJobInfo => ({
  jobId,
  jobType,
  status: 'waiting-for-capacity',
  queuedAt,
  startedAt: null,
  currentModelId: null,
  triedModels: [],
  waitStartedAt: null,
  maxWaitMS: null,
  timeoutAt: null,
});

/** Update job status */
export const updateJobStatus = (
  jobs: Map<string, ActiveJobInfo>,
  jobId: string,
  status: ActiveJobStatus
): void => {
  const job = jobs.get(jobId);
  if (job !== undefined) {
    job.status = status;
  }
};

/** Update job waiting state */
export const updateJobWaiting = (
  jobs: Map<string, ActiveJobInfo>,
  jobId: string,
  modelId: string,
  maxWaitMS: number
): void => {
  const job = jobs.get(jobId);
  if (job !== undefined) {
    const now = Date.now();
    job.currentModelId = modelId;
    job.waitStartedAt = now;
    job.maxWaitMS = maxWaitMS;
    job.timeoutAt = now + maxWaitMS;
  }
};

/** Add tried model to job */
export const addJobTriedModel = (jobs: Map<string, ActiveJobInfo>, jobId: string, modelId: string): void => {
  const job = jobs.get(jobId);
  if (job !== undefined && !job.triedModels.includes(modelId)) {
    job.triedModels.push(modelId);
  }
};

/** Clear tried models for job */
export const clearJobTriedModels = (jobs: Map<string, ActiveJobInfo>, jobId: string): void => {
  const job = jobs.get(jobId);
  if (job !== undefined) {
    job.triedModels = [];
  }
};

/** Update job processing state */
export const updateJobProcessing = (
  jobs: Map<string, ActiveJobInfo>,
  jobId: string,
  modelId: string
): void => {
  const job = jobs.get(jobId);
  if (job !== undefined) {
    job.status = 'processing';
    job.currentModelId = modelId;
    job.startedAt = Date.now();
    job.waitStartedAt = null;
    job.maxWaitMS = null;
    job.timeoutAt = null;
  }
};
