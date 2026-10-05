import type { Redis } from 'ioredis'
import type { RateLimiter } from './deps'

/** Fixed one-second window per key. Good enough to stay under Meta's per-account send limits. */
export function createRedisRateLimiter(redis: Redis, perSecond: number): RateLimiter {
  return {
    async take(key) {
      const now = Date.now()
      const redisKey = `ratelimit:${key}:${Math.floor(now / 1000)}`
      const count = await redis.incr(redisKey)
      if (count === 1) await redis.pexpire(redisKey, 2000)
      return count <= perSecond ? 0 : 1000 - (now % 1000)
    },
  }
}
