/** LLM Rate Limiter with per-model limits and automatic fallback. */
import type { ResourceEstimationsPerJob } from './jobTypeTypes.js';
import type {
  LLMRateLimiterConfig,
  LLMRateLimiterInstance,
  ModelsConfig,
  ValidatedLLMRateLimiterConfig,
} from './multiModelTypes.js';
import { LLMRateLimiter } from './utils/rateLimiterClass.js';

/** Create a new LLM Rate Limiter with optional job type support. */
export const createLLMRateLimiter = <
  T extends ModelsConfig,
  J extends ResourceEstimationsPerJob = ResourceEstimationsPerJob,
>(
  config: ValidatedLLMRateLimiterConfig<T, J>
): LLMRateLimiterInstance<J extends ResourceEstimationsPerJob<infer K> ? K : string> =>
  new LLMRateLimiter(config as LLMRateLimiterConfig) as LLMRateLimiterInstance<
    J extends ResourceEstimationsPerJob<infer K> ? K : string
  >;
