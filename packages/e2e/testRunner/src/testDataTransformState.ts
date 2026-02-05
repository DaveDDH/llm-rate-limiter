/**
 * State transformation helpers
 */
import type {
  CompactInstanceState,
  CompactModelState,
  StateSnapshot,
} from '@llm-rate-limiter/e2e-test-results';

import type { InstanceState } from './stateAggregator.js';
import { enrichModelsWithJobTypes } from './testDataTransformModelJobTypes.js';
import type { RawSnapshot } from './testDataTransformTypes.js';

const ZERO = 0;

interface RpmStats {
  current: number;
  remaining: number;
}

interface TpmStats {
  current: number;
  remaining: number;
}

interface ConcurrencyStats {
  active: number;
  available: number;
}

/**
 * Check if value is a record
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Check if value has the required numeric properties
 */
const hasNumericProperty = (value: object, key: string): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  const { [key]: prop } = value;
  return typeof prop === 'number';
};

/**
 * Check if RPM stats object is valid
 */
const isRpmStats = (value: unknown): value is RpmStats =>
  typeof value === 'object' &&
  value !== null &&
  hasNumericProperty(value, 'current') &&
  hasNumericProperty(value, 'remaining');

/**
 * Check if TPM stats object is valid
 */
const isTpmStats = (value: unknown): value is TpmStats =>
  typeof value === 'object' &&
  value !== null &&
  hasNumericProperty(value, 'current') &&
  hasNumericProperty(value, 'remaining');

/**
 * Check if concurrency stats object is valid
 */
const isConcurrencyStats = (value: unknown): value is ConcurrencyStats =>
  typeof value === 'object' &&
  value !== null &&
  hasNumericProperty(value, 'active') &&
  hasNumericProperty(value, 'available');

/**
 * Check if RPM has activity
 */
const hasRpmActivity = (rpm: RpmStats | undefined): boolean => (rpm?.current ?? ZERO) > ZERO;

/**
 * Check if TPM has activity
 */
const hasTpmActivity = (tpm: TpmStats | undefined): boolean => (tpm?.current ?? ZERO) > ZERO;

/**
 * Check if concurrency has activity
 */
const hasConcurrencyActivity = (conc: ConcurrencyStats | undefined): boolean => (conc?.active ?? ZERO) > ZERO;

/**
 * Check if model has activity
 */
const hasModelActivity = (
  rpm: RpmStats | undefined,
  tpm: TpmStats | undefined,
  conc: ConcurrencyStats | undefined
): boolean => hasRpmActivity(rpm) || hasTpmActivity(tpm) || hasConcurrencyActivity(conc);

/**
 * Extract stats from record
 */
const extractStats = (
  stats: Record<string, unknown>
): { rpm: RpmStats | undefined; tpm: TpmStats | undefined; conc: ConcurrencyStats | undefined } => {
  const { requestsPerMinute: rpmValue, tokensPerMinute: tpmValue, concurrency: concValue } = stats;

  return {
    rpm: isRpmStats(rpmValue) ? rpmValue : undefined,
    tpm: isTpmStats(tpmValue) ? tpmValue : undefined,
    conc: isConcurrencyStats(concValue) ? concValue : undefined,
  };
};

/**
 * Build base result
 */
const buildBaseResult = (rpm: RpmStats | undefined, tpm: TpmStats | undefined): CompactModelState => ({
  rpm: rpm?.current ?? ZERO,
  rpmRemaining: rpm?.remaining ?? ZERO,
  tpm: tpm?.current ?? ZERO,
  tpmRemaining: tpm?.remaining ?? ZERO,
});

/**
 * Transform model stats to compact format
 */
export const transformModelState = (stats: Record<string, unknown>): CompactModelState | null => {
  const { rpm, tpm, conc } = extractStats(stats);

  if (!hasModelActivity(rpm, tpm, conc)) {
    return null;
  }

  const result = buildBaseResult(rpm, tpm);

  if (conc !== undefined) {
    const { active, available } = conc;
    result.concurrent = active;
    result.concurrentAvailable = available;
  }

  return result;
};

/**
 * Check if value is an object record
 */
const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Transform single model entry
 */
const transformSingleModel = (modelData: unknown): CompactModelState | null => {
  if (!isObjectRecord(modelData)) {
    return null;
  }
  return transformModelState(modelData);
};

/**
 * Transform models from instance stats
 */
const transformModels = (stats: Record<string, unknown>): Record<string, CompactModelState> => {
  const models: Record<string, CompactModelState> = {};
  const { models: modelsValue } = stats;

  if (!isObjectRecord(modelsValue)) {
    return models;
  }

  for (const [modelId, modelData] of Object.entries(modelsValue)) {
    const compact = transformSingleModel(modelData);
    if (compact !== null) {
      models[modelId] = compact;
    }
  }

  return models;
};

/**
 * Convert stats to record for transformation functions
 */
const statsToRecord = (stats: InstanceState['stats']): Record<string, unknown> => {
  const { models, memory, jobTypes } = stats;
  return { models, memory, jobTypes };
};

/**
 * Transform instance state to compact format
 */
export const transformInstanceState = (state: InstanceState): CompactInstanceState => {
  const statsRecord = statsToRecord(state.stats);
  const models = enrichModelsWithJobTypes(transformModels(statsRecord), state);

  return {
    activeJobs: state.activeJobs.length,
    activeJobIds: state.activeJobs.map((j) => j.jobId),
    models,
  };
};

/**
 * Transform snapshots to compact format
 */
export const buildSnapshots = (rawSnapshots: RawSnapshot[]): StateSnapshot[] =>
  rawSnapshots.map((raw) => {
    const instances: Record<string, CompactInstanceState> = {};

    for (const inst of raw.instances) {
      instances[inst.instanceId] = transformInstanceState(inst);
    }

    return {
      timestamp: raw.timestamp,
      trigger: raw.label,
      instances,
    };
  });
