import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { RateLimiter } from './deps'

const WINDOW_MS = 1000

/**
 * Sliding one-second window per key, checked and recorded in one script so concurrent workers cannot both take
 * the last slot. A pause set by `pause` (Meta told us to back off) wins over the window. Uses the Redis clock so
 * workers with skewed clocks share one view. Returns 0 to go now, else the ms until a slot frees up.
 */
const TAKE = `
local paused = redis.call('PTTL', KEYS[2])
if paused > 0 then return paused end
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], now, ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window)
  return 0
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return math.max(1, tonumber(oldest[2]) + window - now)
`

/** Extends a pause, never shortens one. */
const PAUSE = `
if redis.call('PTTL', KEYS[1]) < tonumber(ARGV[1]) then
  redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
end
return 0
`

export function createRedisRateLimiter(redis: Redis, perSecond: number): RateLimiter {
  return {
    async take(key) {
      const result = await redis.eval(TAKE, 2, `ratelimit:${key}`, `ratelimit-pause:${key}`, WINDOW_MS, perSecond, randomUUID())
      return Number(result)
    },
    async pause(key, ms) {
      await redis.eval(PAUSE, 1, `ratelimit-pause:${key}`, Math.max(1, Math.ceil(ms)))
    },
  }
}
