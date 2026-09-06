import type { FastifyInstance } from 'fastify'
import { withActor, redis, key, badRequest, conflict } from '@arcade/core'

const MAX_BYTES = 64 * 1024
const CACHE_TTL = 60

export async function saveRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/save', async (req, reply) => {
    const { playerId, gameId } = req.actor
    const cached = await redis.get(key.save(gameId, playerId))
    if (cached) {
      const v = JSON.parse(cached) as { data: unknown; version: number }
      reply.header('etag', String(v.version))
      return v
    }
    const rows = await withActor(req.actor, (tx) =>
      tx`select data, version from saves where game_id = ${gameId} and player_id = ${playerId}`)
    const row = rows[0] as { data: unknown; version: number } | undefined
    const out = row ? { data: row.data, version: row.version } : { data: null, version: 0 }
    if (row) await redis.set(key.save(gameId, playerId), JSON.stringify(out), 'EX', CACHE_TTL)
    reply.header('etag', String(out.version))
    return out
  })

  app.put('/v1/save', async (req, reply) => {
    const { playerId, gameId } = req.actor
    const body = req.body as { data?: Parameters<typeof JSON.stringify>[0] } | undefined
    if (!body || body.data === undefined) throw badRequest('DATA_REQUIRED')

    const encoded = JSON.stringify(body.data)
    if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES) throw badRequest('SAVE_TOO_LARGE', `> ${MAX_BYTES} bytes`)

    // Optimistic locking: client gửi If-Match = version đang giữ.
    // Không gửi = chấp nhận ghi đè (dành cho lần ghi đầu / client đơn giản).
    const ifMatch = req.headers['if-match']
    const expected = ifMatch === undefined ? null : Number(String(ifMatch).replace(/"/g, ''))
    if (expected !== null && !Number.isInteger(expected)) throw badRequest('IF_MATCH_INVALID')

    const version = await withActor(req.actor, async (tx) => {
      const cur = await tx`select version from saves
        where game_id = ${gameId} and player_id = ${playerId}`
      const currentVersion = (cur[0] as { version: number } | undefined)?.version ?? 0

      if (expected !== null && expected !== currentVersion) {
        throw conflict('VERSION_MISMATCH', `bản trên máy chủ là ${currentVersion}, client gửi ${expected}`)
      }
      const next = currentVersion + 1
      await tx`insert into saves (game_id, player_id, data, version, updated_at)
               values (${gameId}, ${playerId}, ${tx.json(body.data as never)}, ${next}, now())
               on conflict (game_id, player_id)
               do update set data = excluded.data, version = excluded.version, updated_at = now()`
      return next
    })

    await redis.del(key.save(gameId, playerId))
    reply.header('etag', String(version))
    return { version }
  })
}
