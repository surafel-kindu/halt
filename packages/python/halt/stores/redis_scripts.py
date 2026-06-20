"""Lua scripts for atomic rate limiting in Redis.

Each script performs the full check-and-consume in a single round trip so the
decision is atomic even under concurrent access from many workers/processes.
Every script touches exactly one key (KEYS[1]) and reads the clock from the
Redis server (``TIME``), so it is safe on Redis Cluster and immune to
client clock skew.

ARGV (shared by all scripts):
    ARGV[1] = limit   (requests per window)
    ARGV[2] = window  (seconds)
    ARGV[3] = burst   (capacity, for token/leaky bucket)
    ARGV[4] = cost    (tokens this request consumes)
    ARGV[5] = ttl     (seconds to keep the key alive)

Return (shared by all scripts), a 5-element array:
    {allowed(1|0), limit, remaining, reset_at(unix s), retry_after(s, -1 = none)}
"""

# Shared Lua prelude: derive a float ``now`` (seconds) from the Redis server clock.
_NOW = """
local t = redis.call('TIME')
local now = tonumber(t[1]) + (tonumber(t[2]) / 1000000)
"""

TOKEN_BUCKET_LUA = (
    _NOW
    + """
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local rate = limit / window

local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens, last
if data[1] then
  tokens = tonumber(data[1])
  last = tonumber(data[2])
else
  tokens = capacity
  last = now
end

local elapsed = now - last
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + elapsed * rate)

local needed = capacity - tokens
local resetAt = math.floor(now + (needed / rate))

if tokens >= cost then
  tokens = tokens - cost
  redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', now)
  redis.call('PEXPIRE', KEYS[1], ttl * 1000)
  return {1, limit, math.floor(tokens), resetAt, -1}
else
  local deficit = cost - tokens
  local retryAfter = math.floor(deficit / rate) + 1
  redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', now)
  redis.call('PEXPIRE', KEYS[1], ttl * 1000)
  return {0, limit, 0, resetAt, retryAfter}
end
"""
)

FIXED_WINDOW_LUA = (
    _NOW
    + """
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

local data = redis.call('HMGET', KEYS[1], 'count', 'start')
local count, start
if data[1] then
  count = tonumber(data[1])
  start = tonumber(data[2])
else
  count = 0
  start = now
end

if (now - start) >= window then
  count = 0
  start = now
end

local resetAt = math.floor(start + window)

if (count + cost) <= limit then
  count = count + cost
  redis.call('HMSET', KEYS[1], 'count', count, 'start', start)
  redis.call('PEXPIRE', KEYS[1], ttl * 1000)
  return {1, limit, limit - count, resetAt, -1}
else
  redis.call('HMSET', KEYS[1], 'count', count, 'start', start)
  redis.call('PEXPIRE', KEYS[1], ttl * 1000)
  local retryAfter = math.floor(resetAt - now) + 1
  return {0, limit, 0, resetAt, retryAfter}
end
"""
)

LEAKY_BUCKET_LUA = (
    _NOW
    + """
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local leakRate = limit / window

local data = redis.call('HMGET', KEYS[1], 'level', 'ts')
local level, last
if data[1] then
  level = tonumber(data[1])
  last = tonumber(data[2])
else
  level = 0
  last = now
end

local elapsed = now - last
if elapsed < 0 then elapsed = 0 end
level = math.max(0, level - (elapsed * leakRate))

local resetAt
if level > 0 then
  resetAt = math.floor(now + (level / leakRate))
else
  resetAt = math.floor(now)
end

if (level + cost) <= capacity then
  level = level + cost
  redis.call('HMSET', KEYS[1], 'level', level, 'ts', now)
  redis.call('PEXPIRE', KEYS[1], ttl * 1000)
  return {1, capacity, math.floor(capacity - level), resetAt, -1}
else
  local spaceNeeded = level + cost - capacity
  local retryAfter = math.floor(spaceNeeded / leakRate) + 1
  redis.call('HMSET', KEYS[1], 'level', level, 'ts', now)
  redis.call('PEXPIRE', KEYS[1], ttl * 1000)
  return {0, capacity, 0, resetAt, retryAfter}
end
"""
)

SLIDING_WINDOW_LUA = (
    _NOW
    + """
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

-- Drop entries older than the sliding window.
local windowStart = now - window
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', windowStart)

local count = redis.call('ZCARD', KEYS[1])

-- Oldest remaining entry determines when capacity frees up.
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local resetAt
if oldest[2] then
  resetAt = math.floor(tonumber(oldest[2]) + window)
else
  resetAt = math.floor(now + window)
end

if (count + cost) <= limit then
  -- Unique members so concurrent requests in the same instant don't collide.
  math.randomseed(math.floor(now * 1000000))
  for i = 1, cost do
    local member = string.format('%d-%d-%d', math.floor(now * 1000000), i, math.random(1, 1000000000))
    redis.call('ZADD', KEYS[1], now, member)
  end
  redis.call('PEXPIRE', KEYS[1], ttl * 1000)
  return {1, limit, limit - (count + cost), resetAt, -1}
else
  redis.call('PEXPIRE', KEYS[1], ttl * 1000)
  local retryAfter
  if oldest[2] then
    retryAfter = math.floor(tonumber(oldest[2]) + window - now) + 1
  else
    retryAfter = math.floor(window) + 1
  end
  return {0, limit, 0, resetAt, retryAfter}
end
"""
)

# Algorithm value (from core.policy ``Algorithm``) -> Lua script.
SCRIPTS = {
    "token_bucket": TOKEN_BUCKET_LUA,
    "fixed_window": FIXED_WINDOW_LUA,
    "sliding_window": SLIDING_WINDOW_LUA,
    "leaky_bucket": LEAKY_BUCKET_LUA,
}
