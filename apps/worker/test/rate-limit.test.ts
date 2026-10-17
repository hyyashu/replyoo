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

  it('reports how long a key stays paused', async () => {
    const limiter = createRedisRateLimiter(redis, 100)
    const key = randomUUID()
    expect(await limiter.pausedMs(key)).toBe(0)
    await limiter.pause(key, 30_000)
    const left = await limiter.pausedMs(key)
    expect(left).toBeGreaterThan(29_000)
    expect(left).toBeLessThanOrEqual(30_000)
  })

  it('frees a slot once the oldest call leaves the window', async () => {
    const limiter = createRedisRateLimiter(redis, 1)
    const key = randomUUID()
    expect(await limiter.take(key)).toBe(0)
    const wait = await limiter.take(key)
    expect(wait).toBeGreaterThan(0)
    await new Promise((resolve) => setTimeout(resolve, wait + 20))
    expect(await limiter.take(key)).toBe(0)
  })

  it('never lets more than N through when called concurrently', async () => {
    const limiter = createRedisRateLimiter(redis, 3)
    const key = randomUUID()
    const results = await Promise.all(Array.from({ length: 10 }, () => limiter.take(key)))
    expect(results.filter((ms) => ms === 0)).toHaveLength(3)
  })

  it('makes every call wait while the key is paused, and never shortens a pause', async () => {
    const limiter = createRedisRateLimiter(redis, 100)
    const key = randomUUID()
    await limiter.pause(key, 60_000)
    await limiter.pause(key, 1_000)
    const wait = await limiter.take(key)
    expect(wait).toBeGreaterThan(59_000)
    expect(wait).toBeLessThanOrEqual(60_000)
    expect(await limiter.take(randomUUID())).toBe(0)
  })
})
