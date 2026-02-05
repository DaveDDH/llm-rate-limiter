/**
 * Lua scripts for statistics and monitoring operations.
 */

/**
 * Get all instances data for stats (pool-based).
 * KEYS: [instances, allocations]
 * Returns: JSON array of instance stats
 */
export const GET_STATS_SCRIPT = `
local instancesKey = KEYS[1]
local allocationsKey = KEYS[2]

local instancesData = redis.call('HGETALL', instancesKey)
local stats = {}
local totalInFlight = 0
local totalAllocated = 0

for i = 1, #instancesData, 2 do
  local instId = instancesData[i]
  local instData = cjson.decode(instancesData[i+1])
  local allocJson = redis.call('HGET', allocationsKey, instId)
  local allocation = 0
  local pools = nil
  if allocJson then
    local allocData = cjson.decode(allocJson)
    pools = allocData.pools
    -- Sum total slots across all pools
    if pools then
      for _, pool in pairs(pools) do
        allocation = allocation + (pool.totalSlots or 0)
      end
    end
  end

  -- Count total in-flight from pool-based tracking (by model)
  local inFlight = 0
  if instData.inFlightByModel then
    for _, count in pairs(instData.inFlightByModel) do
      inFlight = inFlight + count
    end
  end

  totalInFlight = totalInFlight + inFlight
  totalAllocated = totalAllocated + allocation

  table.insert(stats, {
    id = instId,
    inFlight = inFlight,
    inFlightByModel = instData.inFlightByModel,
    allocation = allocation,
    pools = pools,
    lastHeartbeat = instData.lastHeartbeat
  })
end

return cjson.encode({
  totalInstances = #stats,
  totalInFlight = totalInFlight,
  totalAllocated = totalAllocated,
  instances = stats
})
`;
