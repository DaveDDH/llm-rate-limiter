import { request } from 'node:http';

const HTTP_ACCEPTED = 202;
const ZERO = 0;

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
 * Send a job to a server instance.
 */
export const sendJob = async (baseUrl: string, job: JobRequest): Promise<JobResponse> => {
  return new Promise((resolve) => {
    const data = JSON.stringify(job);
    const urlObj = new URL(`${baseUrl}/api/queue-job`);

    const req = request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === HTTP_ACCEPTED) {
            resolve({ success: true, jobId: job.jobId });
          } else {
            resolve({
              success: false,
              jobId: job.jobId,
              error: `HTTP ${res.statusCode}: ${body}`,
            });
          }
        });
      }
    );

    req.on('error', (error) => {
      resolve({
        success: false,
        jobId: job.jobId,
        error: error.message,
      });
    });

    req.write(data);
    req.end();
  });
};

/**
 * Send multiple jobs in parallel.
 */
export const sendJobs = async (baseUrl: string, jobs: JobRequest[]): Promise<JobResponse[]> => {
  return Promise.all(jobs.map((job) => sendJob(baseUrl, job)));
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
  for (let i = ZERO; i < count; i++) {
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
 * Sleep for a specified duration.
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Generate a summary of job results.
 */
export const summarizeResults = (
  results: JobResponse[]
): { successful: number; failed: number; total: number } => {
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  return { successful, failed, total: results.length };
};
