import { Redis } from 'ioredis'
export { key, hashTag } from './keys.ts'

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:56379', {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
})

export async function closeRedis(): Promise<void> {
  await redis.quit()
}
