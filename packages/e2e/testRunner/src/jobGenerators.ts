/**
 * Job generation utilities for test suites
 */

/** Offset to make range inclusive of max value */
const INCLUSIVE_OFFSET = 1;

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

/** Duration configuration - fixed value or random range */
export type DurationConfig = number | { min: number; max: number };

/** Options for job generation */
export interface JobGenerationOptions {
  prefix?: string;
  durationMs?: DurationConfig;
}

/** Generated job structure */
export interface GeneratedJob {
  jobId: string;
  jobType: string;
  payload: { testData: string; durationMs?: number };
}

/** Resolve a duration config to a concrete millisecond value */
const resolveDuration = (config: DurationConfig | undefined): number | undefined => {
  if (config === undefined) return undefined;
  if (typeof config === 'number') return config;
  const { min, max } = config;
  return Math.floor(Math.random() * (max - min + INCLUSIVE_OFFSET)) + min;
};

/** Build payload for a job */
const buildPayload = (
  index: number,
  durationConfig: DurationConfig | undefined
): { testData: string; durationMs?: number } => {
  const base = { testData: `Test payload for job ${index}` };
  const durationMs = resolveDuration(durationConfig);
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
