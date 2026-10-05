import { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { inject } from 'vitest'
import { createRedisRateLimiter } from '../src/rate-limit'

const redis = new Redis(inject('redisUrl'))
afterAll(async () => {
  await redis.quit()
})

describe('createRedisRateLimiter', () => {
  it('allows N calls per second per key', async () => {
    const limiter = createRedisRateLimiter(redis, 2)
    const key = randomUUID()
    const results = [await limiter.take(key), await limiter.take(key), await limiter.take(key)]
    expect(results.slice(0, 2)).toEqual([0, 0])
    expect(results[2]).toBeGreaterThan(0)
    expect(results[2]).toBeLessThanOrEqual(1000)
    expect(await limiter.take(randomUUID())).toBe(0)
  })
})
