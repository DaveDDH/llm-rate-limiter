/**
 * Summary transformation helpers
 */
import type { JobRecord, JobSummaryByCategory, TestSummary } from '@llm-rate-limiter/e2e-test-results';

const ZERO = 0;
const ONE = 1;

/**
 * Create default category stats
 */
const createDefaultCategory = (): JobSummaryByCategory => ({
  completed: ZERO,
  failed: ZERO,
  total: ZERO,
});

/**
 * Ensure a category exists in the map and return updated map
 */
const ensureCategory = (
  map: Record<string, JobSummaryByCategory>,
  key: string
): { updatedMap: Record<string, JobSummaryByCategory>; category: JobSummaryByCategory } => {
  const { [key]: existing } = map;
  if (existing !== undefined) {
    return { updatedMap: map, category: existing };
  }

  const newCategory = createDefaultCategory();
  const updatedMap = { ...map, [key]: newCategory };
  return { updatedMap, category: newCategory };
};

/**
 * Update category stats for a job
 */
const updateCategoryStats = (
  category: JobSummaryByCategory,
  isCompleted: boolean,
  isFailed: boolean
): JobSummaryByCategory => ({
  completed: category.completed + (isCompleted ? ONE : ZERO),
  failed: category.failed + (isFailed ? ONE : ZERO),
  total: category.total + ONE,
});

/**
 * Process job for by-instance stats
 */
const processJobByInstance = (
  byInstance: Record<string, JobSummaryByCategory>,
  job: JobRecord,
  isCompleted: boolean,
  isFailed: boolean
): Record<string, JobSummaryByCategory> => {
  if (job.instanceId === '') {
    return byInstance;
  }
  const { updatedMap, category } = ensureCategory(byInstance, job.instanceId);
  return { ...updatedMap, [job.instanceId]: updateCategoryStats(category, isCompleted, isFailed) };
};

/**
 * Process job for by-type stats
 */
const processJobByType = (
  byJobType: Record<string, JobSummaryByCategory>,
  job: JobRecord,
  isCompleted: boolean,
  isFailed: boolean
): Record<string, JobSummaryByCategory> => {
  const { updatedMap, category } = ensureCategory(byJobType, job.jobType);
  return { ...updatedMap, [job.jobType]: updateCategoryStats(category, isCompleted, isFailed) };
};

/**
 * Process job for by-model stats
 */
const processJobByModel = (
  byModel: Record<string, JobSummaryByCategory>,
  job: JobRecord,
  isCompleted: boolean,
  isFailed: boolean
): Record<string, JobSummaryByCategory> => {
  if (job.modelUsed === null) {
    return byModel;
  }
  const { updatedMap, category } = ensureCategory(byModel, job.modelUsed);
  return { ...updatedMap, [job.modelUsed]: updateCategoryStats(category, isCompleted, isFailed) };
};

/**
 * Accumulator for summary building
 */
interface SummaryAccumulator {
  completed: number;
  failed: number;
  totalDuration: number;
  durationCount: number;
  byInstance: Record<string, JobSummaryByCategory>;
  byJobType: Record<string, JobSummaryByCategory>;
  byModel: Record<string, JobSummaryByCategory>;
}

/**
 * Create initial accumulator
 */
const createInitialAccumulator = (): SummaryAccumulator => ({
  completed: ZERO,
  failed: ZERO,
  totalDuration: ZERO,
  durationCount: ZERO,
  byInstance: {},
  byJobType: {},
  byModel: {},
});

/**
 * Process single job and return updated accumulator
 */
const processJob = (acc: SummaryAccumulator, job: JobRecord): SummaryAccumulator => {
  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';

  const completedDelta = isCompleted ? ONE : ZERO;
  const failedDelta = isFailed ? ONE : ZERO;

  const durationDelta = job.totalDurationMs ?? ZERO;
  const hasDuration = job.totalDurationMs !== null;
  const durationCountDelta = hasDuration ? ONE : ZERO;

  return {
    completed: acc.completed + completedDelta,
    failed: acc.failed + failedDelta,
    totalDuration: acc.totalDuration + durationDelta,
    durationCount: acc.durationCount + durationCountDelta,
    byInstance: processJobByInstance(acc.byInstance, job, isCompleted, isFailed),
    byJobType: processJobByType(acc.byJobType, job, isCompleted, isFailed),
    byModel: processJobByModel(acc.byModel, job, isCompleted, isFailed),
  };
};

/**
 * Build summary from job records
 */
export const buildSummary = (jobs: Record<string, JobRecord>): TestSummary => {
  const jobList = Object.values(jobs);

  const acc = jobList.reduce(processJob, createInitialAccumulator());

  return {
    totalJobs: jobList.length,
    completed: acc.completed,
    failed: acc.failed,
    avgDurationMs: acc.durationCount > ZERO ? acc.totalDuration / acc.durationCount : null,
    byInstance: acc.byInstance,
    byJobType: acc.byJobType,
    byModel: acc.byModel,
  };
};
