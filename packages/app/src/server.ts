// Composition root. Ở M1 file này gộp services (stateless) + roomd (stateful)
// vào một process. Ở M2 nó bị xoá, mỗi bên thành một deployable riêng —
// đó là lý do services/ và roomd/ không được import lẫn nhau (scripts/lint-deps.ts).
import Fastify, { type FastifyInstance } from 'fastify'
import { verify, HttpError, unauthorized, closePg, closeRedis } from '@arcade/core'
import {
  authRoutes, saveRoutes, leaderboardRoutes, bundleRoutes, telemetryRoutes,
  roomsRoutes, flushAll, submitScore, gameForHost,
} from '@arcade/services'
import { RoomManager, attachGateway } from '@arcade/roomd'
import { loadGameDefs } from './games.ts'

/** Route công khai, so khớp theo route pattern chứ không theo tiền tố URL. */
const PUBLIC_ROUTES = new Set(['/', '/*'])
const PUBLIC_PREFIXES = ['/v1/auth/guest', '/v1/auth/refresh', '/health', '/metrics', '/favicon.ico', '/g/']

export type BuildOpts = {
  gamesDir: string
  /** false để test chỉ tầng stateless (không dựng gateway/scheduler) */
  realtime?: boolean
  publicBaseUrl?: string
  nodeUrl?: string
}

export async function build(opts: BuildOpts = { gamesDir: './games' }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 256 * 1024,
  })

  // CORS: mỗi game chạy ở origin riêng nên phải mở, nhưng chỉ cho các header ta dùng.
  app.addHook('onSend', async (req, reply) => {
    reply.header('access-control-allow-origin', req.headers.origin ?? '*')
    reply.header('access-control-allow-headers', 'content-type,authorization,if-match')
    reply.header('access-control-expose-headers', 'etag')
    reply.header('access-control-allow-methods', 'GET,POST,PUT,OPTIONS')
  })
  app.options('/*', async (_req, reply) => reply.code(204).send())

  // Hook auth. Đọc Bearer -> req.actor. gameId lấy từ claim gid trong token.
  app.addHook('preHandler', async (req) => {
    // Hook này chạy cho cả route không khớp. Không bỏ qua thì mọi URL sai
    // đều trả 401 thay vì 404.
    if (!req.routeOptions?.url) return
    // Route custom domain (`/` và `/*`) phục vụ file tĩnh của game -> công khai.
    // So theo route ĐÃ KHỚP, không so theo req.url: mọi URL đều startsWith('/').
    if (PUBLIC_ROUTES.has(req.routeOptions.url)) return
    if (PUBLIC_PREFIXES.some((p) => req.url.startsWith(p))) return
    const h = req.headers.authorization
    if (!h?.startsWith('Bearer ')) throw unauthorized('TOKEN_MISSING')
    try {
      const c = await verify(h.slice(7), 'access')
      req.actor = { playerId: c.sub, gameId: c.gid, isGuest: c.gst }
    } catch {
      throw unauthorized('TOKEN_INVALID')
    }
  })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message })
    if ((err as { statusCode?: number }).statusCode === 400) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: (err as Error).message })
    }
    app.log.error({ err }, 'lỗi chưa xử lý')
    return reply.code(500).send({ error: 'INTERNAL' })
  })

  app.get('/health', async () => ({ ok: true }))
  app.get('/favicon.ico', async (_req, reply) => reply.code(204).send())

  // Đường không tồn tại phải trả 404, KHÔNG phải 401. Hook auth chạy cả cho
  // route không khớp, nên nếu thiếu handler này thì mọi URL sai đều thành 401 —
  // vừa gây nhiễu log, vừa để lộ ít thông tin hơn mức cần thiết.
  app.setNotFoundHandler(async (_req, reply) => reply.code(404).send({ error: 'NOT_FOUND' }))

  const publicBaseUrl = opts.publicBaseUrl ?? `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 8090}`
  const nodeUrl = opts.nodeUrl ?? publicBaseUrl.replace(/^http/, 'ws')

  await app.register(authRoutes)
  await app.register(saveRoutes)
  await app.register(leaderboardRoutes)
  await app.register(telemetryRoutes)
  await app.register(roomsRoutes, { wsBaseUrl: nodeUrl })
  await app.register(bundleRoutes, { gamesDir: opts.gamesDir })

  // ── tầng stateful ────────────────────────────────────────────────────────
  // Đây là chỗ DUY NHẤT services/ và roomd/ gặp nhau, và là thứ bị xoá ở M2 khi
  // tách deployable. fx được tiêm từ đây nên roomd không import services —
  // scripts/lint-deps.ts chặn nếu ai đó phá luật này.
  let manager: RoomManager | null = null
  if (opts.realtime !== false) {
    manager = new RoomManager({
      nodeUrl,
      fx: {
        submitScore: (gameId, board, playerId, score) => {
          // Điểm do room server nộp -> verified = true. Đây là khác biệt duy
          // nhất giữa bảng xếp hạng có và không có chống cheat.
          void submitScore(gameId, board, playerId, score, { verified: true })
            .catch((e: unknown) => app.log.warn({ err: e }, 'room nộp điểm lỗi'))
        },
        persist: () => { /* room.save() -> M2: ghi vào bảng riêng của game */ },
        log: (msg) => app.log.info({ src: 'roomd' }, msg),
      },
    })
    for (const def of await loadGameDefs(opts.gamesDir)) manager.registerGame(def)
    manager.start()

    const mgr = manager
    app.get('/metrics', async () => {
      const s = mgr.stats()
      return [
        `arcade_rooms_open ${s.rooms}`,
        `arcade_players_connected ${s.live}`,
        `arcade_players_total ${s.players}`,
        `arcade_tick_ms{quantile="0.5"} ${s.tickP50.toFixed(3)}`,
        `arcade_tick_ms{quantile="0.99"} ${s.tickP99.toFixed(3)}`,
        `arcade_patch_bytes_total ${s.patchBytes}`,
        `arcade_draining ${s.draining ? 1 : 0}`,
      ].join('\n') + '\n'
    })

    app.addHook('onReady', async () => {
      const gw = attachGateway(app.server, {
        manager: mgr,
        verifyToken: async (token) => {
          const c = await verify(token, 'access')
          return { playerId: c.sub, gameId: c.gid, isGuest: c.gst }
        },
        // Link mời: nếu host là custom domain của chính game đó thì dùng gốc
        // (castle.bomclaw.org/?room=XXXX); nếu không thì dùng đường /g/<id>/.
        inviteUrl: async (gameId, code, headers) => {
          const host = typeof headers['host'] === 'string' ? headers['host'] : undefined
          const xfp = headers['x-forwarded-proto']
          const proto = (Array.isArray(xfp) ? xfp[0] : xfp)?.split(',')[0]?.trim()
          if (!host) return `${publicBaseUrl}/g/${gameId}/?room=${code}`
          const origin = `${proto === 'https' ? 'https' : 'http'}://${host}`
          const owner = await gameForHost(host)
          return owner === gameId ? `${origin}/?room=${code}` : `${origin}/g/${gameId}/?room=${code}`
        },
        log: (m, extra) => app.log.info(extra ?? {}, m),
      })
      app.addHook('onClose', async () => { await gw.close() })
    })
  }

  app.addHook('onClose', async () => {
    if (manager) await manager.stop()
    await flushAll().catch(() => {})
    await Promise.all([closePg(), closeRedis()])
  })
  return app
}

// Chạy trực tiếp: node packages/app/src/server.ts
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const app = await build({ gamesDir: process.env.GAMES_DIR ?? './games' })
  const port = Number(process.env.PORT ?? 8080)
  const host = process.env.HOST ?? '127.0.0.1'
  await app.listen({ port, host })
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, async () => { await app.close(); process.exit(0) })
  }
}
