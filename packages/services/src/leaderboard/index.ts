import type { FastifyInstance } from 'fastify'
import { sql, badRequest, forbidden } from '@arcade/core'
import { submit, top, around, flushAll } from './store.ts'

export { flushAll, flushDirty } from './store.ts'

type Manifest = {
  runtime?: { mode?: string }
  capabilities?: { leaderboard?: string[] }
}

const manifestCache = new Map<string, Manifest>()
async function manifest(gameId: string): Promise<Manifest> {
  const hit = manifestCache.get(gameId)
  if (hit) return hit
  const [row] = await sql<{ manifest: Manifest }[]>`select manifest from games where id = ${gameId}`
  const m = row?.manifest ?? {}
  manifestCache.set(gameId, m)
  return m
}

export async function leaderboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/leaderboard/:board', async (req) => {
    const { gameId, playerId } = req.actor
    const { board } = req.params as { board: string }
    const q = req.query as { top?: string; around?: string; n?: string }
    const n = Math.min(Number(q.n ?? 20) || 20, 100)

    if (q.around) {
      const target = q.around === 'me' ? playerId : q.around
      return { entries: await around(gameId, board, target, Math.min(n, 25)) }
    }
    return { entries: await top(gameId, board, n) }
  })

  app.post('/v1/leaderboard/:board', async (req) => {
    const { gameId, playerId } = req.actor
    const { board } = req.params as { board: string }
    const body = (req.body ?? {}) as { score?: number; name?: string }

    if (typeof body.score !== 'number' || !Number.isFinite(body.score)) throw badRequest('SCORE_REQUIRED')

    const m = await manifest(gameId)
    const allowed = m.capabilities?.leaderboard ?? []
    if (!allowed.includes(board)) throw badRequest('BOARD_NOT_DECLARED', `arcade.toml chưa khai báo bảng "${board}"`)

    // Ở mode authoritative, chỉ room server được nộp điểm. Client nộp bị từ chối
    // thẳng — chứ không nhận rồi âm thầm đánh dấu unverified.
    if (m.runtime?.mode === 'authoritative') {
      throw forbidden('CLIENT_SUBMIT_FORBIDDEN', 'mode authoritative: chỉ room server được nộp điểm')
    }

    // Game offline không có server làm chứng -> verified = false, và hiển thị đúng như vậy.
    const r = await submit(gameId, board, playerId, Math.trunc(body.score), {
      name: body.name?.slice(0, 24),
      verified: false,
    })
    return { ...r, verified: false }
  })

  // Write-behind: đẩy điểm sang Postgres theo lô. Chu kỳ 5s -> cửa sổ mất tối đa 5s
  // nếu Redis chết, và lần khởi động sau sẽ nạp lại từ Postgres.
  let closing = false
  const timer = setInterval(() => {
    if (closing) return
    flushAll().catch((e) => app.log.error({ err: e }, 'leaderboard write-behind lỗi'))
  }, 5000)
  timer.unref()
  app.addHook('onClose', async () => {
    closing = true
    clearInterval(timer)
    // Đẩy nốt trước khi tắt. Nuốt lỗi: nếu pool đã đóng thì không có gì cứu được
    // ở đây, và ném ra sẽ che mất lỗi thật của quá trình tắt.
    await flushAll().catch(() => {})
  })
}
