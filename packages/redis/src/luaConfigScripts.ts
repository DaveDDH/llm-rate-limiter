/**
 * Lua scripts for configuration initialization.
 */

/**
 * Initialize multi-dimensional config (model capacities and job type resources).
 * KEYS: [modelCapacities, jobTypeResources]
 * ARGV: [modelCapacitiesJson, jobTypeResourcesJson]
 * Returns: "OK"
 */
export const INIT_CONFIG_SCRIPT = `
local modelCapacitiesKey = KEYS[1]
local jobTypeResourcesKey = KEYS[2]
local modelCapacitiesJson = ARGV[1]
local jobTypeResourcesJson = ARGV[2]

-- Clear existing and set new model capacities
redis.call('DEL', modelCapacitiesKey)
local modelCapacities = cjson.decode(modelCapacitiesJson)
for modelId, config in pairs(modelCapacities) do
  redis.call('HSET', modelCapacitiesKey, modelId, cjson.encode(config))
end

-- Clear existing and set new job type resources
redis.call('DEL', jobTypeResourcesKey)
local jobTypeResources = cjson.decode(jobTypeResourcesJson)
for jobTypeId, config in pairs(jobTypeResources) do
  redis.call('HSET', jobTypeResourcesKey, jobTypeId, cjson.encode(config))
end

return 'OK'
`;
