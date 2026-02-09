/**
 * Lua scripts for instance lifecycle management (register, unregister, heartbeat, cleanup).
 */
import { REALLOCATION_LOGIC } from './luaReallocationLogic.js';

/**
 * Register a new instance and recalculate allocations.
 * KEYS: [instances, allocations, channel, modelCapacities, jobTypeResources]
 * ARGV: [instanceId, timestamp]
 * Returns: allocation JSON for this instance
 */
export const REGISTER_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local channel = KEYS[3]
local modelCapacitiesKey = KEYS[4]
local jobTypeResourcesKey = KEYS[5]
local instanceId = ARGV[1]
local timestamp = tonumber(ARGV[2])

-- Add instance with 0 in-flight (pool-based: track by model only)
local instanceData = {
  lastHeartbeat = timestamp,
  inFlightByModel = {}
}
redis.call('HSET', instancesKey, instanceId, cjson.encode(instanceData))

-- Recalculate allocations
recalculateAllocations(instancesKey, allocationsKey, channel, modelCapacitiesKey, jobTypeResourcesKey)

-- Return this instance's allocation
local allocJson = redis.call('HGET', allocationsKey, instanceId)
return allocJson or cjson.encode({instanceCount=0, pools={}})
`;

/**
 * Unregister an instance and recalculate allocations.
 * KEYS: [instances, allocations, channel, modelCapacities, jobTypeResources]
 * ARGV: [instanceId]
 * Returns: "OK"
 */
export const UNREGISTER_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local channel = KEYS[3]
local modelCapacitiesKey = KEYS[4]
local jobTypeResourcesKey = KEYS[5]
local instanceId = ARGV[1]

-- Remove instance
redis.call('HDEL', instancesKey, instanceId)
redis.call('HDEL', allocationsKey, instanceId)

-- Recalculate remaining allocations
recalculateAllocations(instancesKey, allocationsKey, channel, modelCapacitiesKey, jobTypeResourcesKey)

return 'OK'
`;

/**
 * Send heartbeat, update lastHeartbeat, and recalculate allocations.
 * Periodic reallocation ensures allocations stay fresh when time windows reset.
 * KEYS: [instances, allocations, channel, modelCapacities, jobTypeResources]
 * ARGV: [instanceId, timestamp]
 * Returns: "1" (success) or "0" (instance not found)
 */
export const HEARTBEAT_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local channel = KEYS[3]
local modelCapacitiesKey = KEYS[4]
local jobTypeResourcesKey = KEYS[5]
local instanceId = ARGV[1]
local timestamp = tonumber(ARGV[2])

local instJson = redis.call('HGET', instancesKey, instanceId)
if not instJson then return "0" end

local inst = cjson.decode(instJson)
inst.lastHeartbeat = timestamp
redis.call('HSET', instancesKey, instanceId, cjson.encode(inst))

recalculateAllocations(instancesKey, allocationsKey, channel, modelCapacitiesKey, jobTypeResourcesKey)

return "1"
`;

/**
 * Cleanup stale instances and recalculate allocations.
 * KEYS: [instances, allocations, channel, modelCapacities, jobTypeResources]
 * ARGV: [cutoffTimestamp]
 * Returns: number of instances removed
 */
export const CLEANUP_SCRIPT = `
${REALLOCATION_LOGIC}

local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]
local channel = KEYS[3]
local modelCapacitiesKey = KEYS[4]
local jobTypeResourcesKey = KEYS[5]
local cutoff = tonumber(ARGV[1])

local instancesData = redis.call('HGETALL', instancesKey)
local removed = 0

for i = 1, #instancesData, 2 do
  local data = cjson.decode(instancesData[i+1])
  if data.lastHeartbeat < cutoff then
    redis.call('HDEL', instancesKey, instancesData[i])
    redis.call('HDEL', allocationsKey, instancesData[i])
    removed = removed + 1
  end
end

if removed > 0 then
  recalculateAllocations(instancesKey, allocationsKey, channel, modelCapacitiesKey, jobTypeResourcesKey)
end

return removed
`;
