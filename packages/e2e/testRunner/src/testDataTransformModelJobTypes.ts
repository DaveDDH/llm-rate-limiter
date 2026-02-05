/**
 * Per-model-per-jobtype enrichment for compact snapshots.
 *
 * Computes slots and inFlight for each (model, jobType) pair using:
 * - allocation.pools[model].totalSlots (per-model pool)
 * - jobTypes[type].currentRatio (global ratios)
 * - activeJobs filtered by (currentModelId, jobType)
 */
import type { ActiveJobInfo } from '@llm-rate-limiter/core';
import type { CompactModelJobTypeState, CompactModelState } from '@llm-rate-limiter/e2e-test-results';

import type { InstanceState } from './stateAggregator.js';

const ZERO = 0;
const ONE = 1;

/** InFlight counts keyed by modelId → jobType → count */
type InFlightByModel = Map<string, Map<string, number>>;

/** Extract job type ratios from stats */
const getJobTypeRatios = (state: InstanceState): Record<string, number> => {
  const ratios: Record<string, number> = {};
  const {
    stats: { jobTypes },
  } = state;
  if (jobTypes === undefined) {
    return ratios;
  }
  for (const [jtId, jtState] of Object.entries(jobTypes.jobTypes)) {
    const { currentRatio } = jtState;
    ratios[jtId] = currentRatio;
  }
  return ratios;
};

/** Check if job is actively processing (consuming a slot) */
const isProcessing = (job: ActiveJobInfo): boolean => job.status === 'processing';

/** Count processing jobs grouped by (currentModelId, jobType) */
const buildInFlightByModel = (activeJobs: ActiveJobInfo[]): InFlightByModel => {
  const counts: InFlightByModel = new Map();
  for (const job of activeJobs) {
    if (job.currentModelId === null || !isProcessing(job)) {
      continue;
    }
    let modelMap = counts.get(job.currentModelId);
    if (modelMap === undefined) {
      modelMap = new Map();
      counts.set(job.currentModelId, modelMap);
    }
    const current = modelMap.get(job.jobType) ?? ZERO;
    modelMap.set(job.jobType, current + ONE);
  }
  return counts;
};

/** Build per-jobtype state for a single model */
const buildModelJobTypes = (
  poolSlots: number,
  ratios: Record<string, number>,
  modelInFlight: Map<string, number> | undefined
): Record<string, CompactModelJobTypeState> => {
  const result: Record<string, CompactModelJobTypeState> = {};
  for (const [jtId, ratio] of Object.entries(ratios)) {
    const slots = Math.floor(poolSlots * ratio);
    const inFlight = modelInFlight?.get(jtId) ?? ZERO;
    result[jtId] = { slots, inFlight };
  }
  return result;
};

/** Create a zero-activity base model state */
const buildEmptyModelState = (): CompactModelState => ({
  rpm: ZERO,
  rpmRemaining: ZERO,
  tpm: ZERO,
  tpmRemaining: ZERO,
});

/** Enrich existing model with jobTypes breakdown */
const enrichModel = (
  modelState: CompactModelState,
  poolSlots: number,
  ratios: Record<string, number>,
  modelInFlight: Map<string, number> | undefined
): CompactModelState => {
  const modelJobTypes = buildModelJobTypes(poolSlots, ratios, modelInFlight);
  return { ...modelState, jobTypes: modelJobTypes };
};

/** Enrich compact models with per-jobtype slots and inFlight, returns new record */
export const enrichModelsWithJobTypes = (
  models: Record<string, CompactModelState>,
  state: InstanceState
): Record<string, CompactModelState> => {
  const { allocation } = state;
  if (allocation === null) {
    return models;
  }
  const ratios = getJobTypeRatios(state);
  const inFlightByModel = buildInFlightByModel(state.activeJobs);
  const enriched: Record<string, CompactModelState> = {};
  const { pools } = allocation;

  for (const [modelId, modelState] of Object.entries(models)) {
    const { [modelId]: pool } = pools;
    if (pool === undefined) {
      enriched[modelId] = modelState;
      continue;
    }
    enriched[modelId] = enrichModel(modelState, pool.totalSlots, ratios, inFlightByModel.get(modelId));
  }

  for (const [modelId, pool] of Object.entries(pools)) {
    if (enriched[modelId] !== undefined) {
      continue;
    }
    const base = buildEmptyModelState();
    enriched[modelId] = enrichModel(base, pool.totalSlots, ratios, inFlightByModel.get(modelId));
  }

  return enriched;
};
