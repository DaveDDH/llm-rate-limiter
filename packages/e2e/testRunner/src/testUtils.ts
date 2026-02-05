import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

const HTTP_ACCEPTED = 202;
const ZERO = 0;
const INCREMENT = 1;

/** Job request to send to the server */
export interface JobRequest {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
}

/** Response from queueing a job */
export interface JobResponse {
  success: boolean;
  jobId: string;
  error?: string;
}

/** Debug event from SSE stream */
export interface DebugEvent {
  type: string;
  instanceId: string;
  timestamp: number;
  payload: unknown;
}

/**
 * Send a job to a server instance using fetch API.
 */
export const sendJob = async (baseUrl: string, job: JobRequest): Promise<JobResponse> => {
  try {
    const response = await fetch(`${baseUrl}/api/queue-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });

    if (response.status === HTTP_ACCEPTED) {
      return { success: true, jobId: job.jobId };
    }

    const body = await response.text();
    return {
      success: false,
      jobId: job.jobId,
      error: `HTTP ${String(response.status)}: ${body}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      jobId: job.jobId,
      error: errorMessage,
    };
  }
};

/** Send a single job asynchronously */
const sendSingleJob = async (baseUrl: string, job: JobRequest): Promise<JobResponse> => {
  const result = await sendJob(baseUrl, job);
  return result;
};

/**
 * Send multiple jobs in parallel.
 */
export const sendJobs = async (baseUrl: string, jobs: JobRequest[]): Promise<JobResponse[]> => {
  const sendPromises = jobs.map(async (job) => {
    const result = await sendSingleJob(baseUrl, job);
    return result;
  });
  const results = await Promise.all(sendPromises);
  return results;
};

/**
 * Create a job request with a unique ID.
 */
export const createJob = (jobType: string, index: number): JobRequest => ({
  jobId: `test-job-${Date.now()}-${index}`,
  jobType,
  payload: {
    testData: `Test payload for job ${index}`,
    timestamp: new Date().toISOString(),
  },
});

/**
 * Create multiple job requests.
 */
export const createJobs = (jobType: string, count: number): JobRequest[] => {
  const jobs: JobRequest[] = [];
  for (let i = ZERO; i < count; i += INCREMENT) {
    jobs.push(createJob(jobType, i));
  }
  return jobs;
};

/**
 * Log with timestamp.
 */
export const log = (message: string): void => {
  const timestamp = new Date().toISOString();
  process.stdout.write(`[${timestamp}] ${message}\n`);
};

/**
 * Log error with timestamp.
 */
export const logError = (message: string): void => {
  const timestamp = new Date().toISOString();
  process.stderr.write(`[${timestamp}] ERROR: ${message}\n`);
};

/**
 * Sleep for a specified duration using native timers/promises.
 */
export const sleep = async (ms: number): Promise<void> => {
  await setTimeoutPromise(ms);
};

/**
 * Generate a summary of job results.
 */
export const summarizeResults = (
  results: JobResponse[]
): { successful: number; failed: number; total: number } => {
  const successfulResults = results.filter((r) => r.success);
  const failedResults = results.filter((r) => !r.success);
  return { successful: successfulResults.length, failed: failedResults.length, total: results.length };
};
