import type { FastifyInstance } from 'fastify'
import { sql } from '@arcade/core'

type Ev = { name: string; props?: Record<string, unknown>; ts?: string }
const queue: { gameId: string; playerId: string; name: string; props: unknown }[] = []

export async function telemetryRoutes(app: FastifyInstance): Promise<void> {
  // Gộp lô, fire-and-forget: telemetry không bao giờ được làm chậm hay làm hỏng request game.
  app.post('/v1/events', async (req) => {
    const { gameId, playerId } = req.actor
    const body = (req.body ?? {}) as { events?: Ev[] }
    for (const e of (body.events ?? []).slice(0, 50)) {
      if (typeof e?.name !== 'string') continue
      queue.push({ gameId, playerId, name: e.name.slice(0, 64), props: e.props ?? null })
    }
    return { accepted: true }
  })

  let closing = false
  const timer = setInterval(async () => {
    if (closing || !queue.length) return
    const batch = queue.splice(0, 500)
    try {
      await sql.begin(async (tx) => {
        for (const e of batch) {
          await tx`insert into events (game_id, player_id, name, props)
                   values (${e.gameId}, ${e.playerId}, ${e.name}, ${tx.json(e.props as never)})`
        }
      })
    } catch (e) {
      app.log.warn({ err: e }, 'telemetry flush lỗi — bỏ lô này')
    }
  }, 3000)
  timer.unref()
  app.addHook('onClose', async () => { closing = true; clearInterval(timer) })
}
