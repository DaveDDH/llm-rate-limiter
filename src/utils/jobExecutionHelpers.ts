/**
 * Helper utilities for job execution in the multi-model rate limiter.
 */
import type { ArgsWithoutModelId, JobUsage, ModelRateLimitConfig, ModelsConfig } from '../multiModelTypes.js';

const ZERO = 0;

/** Internal marker class for delegation */
export class DelegationError extends Error {
  public readonly isDelegation = true;
  constructor() {
    super('Delegation requested');
  }
}

export const isDelegationError = (error: unknown): error is DelegationError =>
  error instanceof DelegationError;

/** Build job arguments by merging modelId with user-provided args. */
export function buildJobArgs<Args extends ArgsWithoutModelId>(
  modelId: string,
  args: Args | undefined
): { modelId: string } & Args {
  if (args === undefined) {
    const result: { modelId: string } & ArgsWithoutModelId = { modelId };
    return result as { modelId: string } & Args;
  }
  return { modelId, ...args };
}

/** Calculate total cost from usage array */
export const calculateTotalCost = (usage: JobUsage): number =>
  usage.reduce((total, entry) => total + entry.cost, ZERO);

/** Calculate the maximum estimated value across all models for a given resource property */
export const calculateMaxEstimatedResource = (
  models: ModelsConfig,
  getter: (config: ModelRateLimitConfig) => number | undefined
): number => {
  let max = ZERO;
  for (const modelConfig of Object.values(models)) {
    const estimated = getter(modelConfig) ?? ZERO;
    max = Math.max(max, estimated);
  }
  return max;
};

/** Wait for any model to have capacity, optionally excluding some models */
export const waitForModelCapacity = async (
  getAvailable: (exclude: ReadonlySet<string>) => string | null,
  excludeModels: ReadonlySet<string>,
  pollIntervalMs: number
): Promise<string> => {
  const { promise, resolve } = Promise.withResolvers<string>();
  const checkCapacity = (): void => {
    const availableModel = getAvailable(excludeModels);
    if (availableModel !== null) {
      resolve(availableModel);
      return;
    }
    setTimeout(checkCapacity, pollIntervalMs);
  };
  checkCapacity();
  return await promise;
};
