/**
 * In-memory job queue for demonstration purposes.
 * In production, you would use a persistent queue like Bull, BullMQ, or a database.
 */
import type { QueuedJob } from './types.js';

const jobQueue = new Map<string, QueuedJob>();

/**
 * Add a job to the queue.
 */
export const addJob = (job: QueuedJob): void => {
  jobQueue.set(job.jobId, job);
};

/**
 * Get a job by ID.
 */
export const getJob = (jobId: string): QueuedJob | undefined => jobQueue.get(jobId);

/**
 * Update job status.
 */
export const updateJobStatus = (
  jobId: string,
  status: QueuedJob['status']
): boolean => {
  const job = jobQueue.get(jobId);
  if (job !== undefined) {
    job.status = status;
    return true;
  }
  return false;
};

/**
 * Get all jobs.
 */
export const getAllJobs = (): QueuedJob[] => Array.from(jobQueue.values());

/**
 * Get jobs by status.
 */
export const getJobsByStatus = (status: QueuedJob['status']): QueuedJob[] =>
  Array.from(jobQueue.values()).filter((job) => job.status === status);

/**
 * Clear the job queue.
 */
export const clearQueue = (): void => {
  jobQueue.clear();
};
