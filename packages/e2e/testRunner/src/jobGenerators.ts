/**
 * Job generation utilities for test suites
 */

/** Available job types for random generation */
export const JOB_TYPES = [
  'summary',
  'VacationPlanning',
  'ImageCreation',
  'BudgetCalculation',
  'WeatherForecast',
] as const;

/** Generate a random job type */
export const getRandomJobType = (): string => {
  const randomIndex = Math.floor(Math.random() * JOB_TYPES.length);
  return JOB_TYPES[randomIndex] ?? 'summary';
};

/** Options for job generation */
export interface JobGenerationOptions {
  prefix?: string;
  durationMs?: number;
}

/** Generated job structure */
export interface GeneratedJob {
  jobId: string;
  jobType: string;
  payload: { testData: string; durationMs?: number };
}

/** Build payload for a job */
const buildPayload = (
  index: number,
  durationMs: number | undefined
): { testData: string; durationMs?: number } => {
  const base = { testData: `Test payload for job ${index}` };
  if (durationMs === undefined) {
    return base;
  }
  return { ...base, durationMs };
};

/** Generate a list of random jobs */
export const generateRandomJobs = (count: number, options: JobGenerationOptions = {}): GeneratedJob[] => {
  const { prefix = 'test-job', durationMs } = options;
  const timestamp = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    jobId: `${prefix}-${timestamp}-${i}`,
    jobType: getRandomJobType(),
    payload: buildPayload(i, durationMs),
  }));
};

/** Generate jobs with a specific type */
export const generateJobsOfType = (
  count: number,
  jobType: string,
  options: JobGenerationOptions = {}
): GeneratedJob[] => {
  const { prefix = 'test-job', durationMs } = options;
  const timestamp = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    jobId: `${prefix}-${timestamp}-${i}`,
    jobType,
    payload: buildPayload(i, durationMs),
  }));
};
