import { createLLMRateLimiter } from '@llm-rate-limiter/core';
import { createRedisBackend } from '@llm-rate-limiter/redis';

// Create rate limiter with Redis backend
const limiter = createLLMRateLimiter({
  backend: createRedisBackend('YOUR_REDIS_CONNECTION_STR'),
  models: {
    'gpt-5.2': {
      requestsPerMinute: 500,
      pricing: {
        input: 0.03,
        output: 0.06,
        cached: 0.015,
      },
    },
  },
  resourceEstimationsPerJob: {
    createRecipe: { estimatedUsedTokens: 10000 },
  },
});

// Start (registers with Redis for slot allocation)
await limiter.start();

// Use normally...
const result = await limiter.queueJob({
  jobId: 'job-id',
  jobType: 'createRecipe',
  job: ({ modelId }, resolve) => {
    const usage = { inputTokens: 100, cachedTokens: 0, outputTokens: 500 };
    resolve({ ...usage, modelId });
    return {
      requestCount: 0,
      usage: {
        input: 100,
        cached: 0,
        output: 0,
      },
      data: 'Lorem ipsum...',
    };
  },
});

console.log(result.data); // Lorem ipsum...

// Stop (unregisters from Redis)
limiter.stop();
