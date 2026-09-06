// Composition root. Ở M1 file này gộp services (stateless) + roomd (stateful)
// vào một process. Ở M2 nó bị xoá, mỗi bên thành một deployable riêng —
// đó là lý do services/ và roomd/ không được import lẫn nhau (scripts/lint-deps.ts).
import Fastify, { type FastifyInstance } from 'fastify'
import { verify, HttpError, unauthorized, closePg, closeRedis } from '@arcade/core'
import {
  authRoutes, saveRoutes, leaderboardRoutes, bundleRoutes, telemetryRoutes, flushAll,
} from '@arcade/services'

const PUBLIC_PREFIXES = ['/v1/auth/guest', '/v1/auth/refresh', '/health', '/metrics', '/favicon.ico', '/g/']

export async function build(opts: { gamesDir: string } = { gamesDir: './games' }): Promise<FastifyInstance> {
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

  await app.register(authRoutes)
  await app.register(saveRoutes)
  await app.register(leaderboardRoutes)
  await app.register(telemetryRoutes)
  await app.register(bundleRoutes, opts)

  app.addHook('onClose', async () => {
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
