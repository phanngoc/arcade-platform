// Phục vụ bundle tĩnh của game. Thay thế server.js tự viết trong từng game.
import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, normalize, extname, resolve } from 'node:path'
import { sql, notFound } from '@arcade/core'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Bảng tra cho việc phục vụ file tĩnh: hostname -> game, và game -> thư mục
 * client. Cache trong RAM vì nằm trên đường nóng của MỌI request tĩnh; bảng
 * games gần như không đổi nên TTL 60s là đủ.
 *
 * `client_dir` cần thiết vì game thật không thống nhất: castle/rumba để file
 * ngay thư mục gốc, tank-battle để trong public/.
 */
class GameStatics {
  private byHost = new Map<string, string>()
  private clientDir = new Map<string, string>()
  private loadedAt = 0
  private ttlMs = 60_000

  private async fresh(): Promise<void> {
    if (Date.now() - this.loadedAt > this.ttlMs) await this.reload()
  }

  async gameFor(host: string | undefined): Promise<string | null> {
    if (!host) return null
    await this.fresh()
    // Bỏ port, hạ chữ thường: Host header có thể là "castle.bomclaw.org:443".
    const h = host.toLowerCase().split(':')[0]!
    return this.byHost.get(h) ?? null
  }

  async dirFor(gameId: string): Promise<string> {
    await this.fresh()
    return this.clientDir.get(gameId) ?? '.'
  }

  async reload(): Promise<void> {
    const rows = await sql<{ id: string; domains: string[]; client_dir: string | null }[]>`
      select id, domains, manifest->'game'->>'client_dir' as client_dir from games`
    const byHost = new Map<string, string>()
    const dirs = new Map<string, string>()
    for (const r of rows) {
      for (const d of r.domains ?? []) byHost.set(d.toLowerCase(), r.id)
      dirs.set(r.id, r.client_dir || '.')
    }
    this.byHost = byHost
    this.clientDir = dirs
    this.loadedAt = Date.now()
  }
}

/** Một bản dùng chung cho cả tiến trình: bundle server và việc dựng link mời
 *  phải nhìn cùng một bảng domain, nếu không link mời sẽ trỏ sai host. */
const statics = new GameStatics()

/** host -> gameId. Trả null nếu host không gắn với game nào. */
export async function gameForHost(host: string | undefined): Promise<string | null> {
  return statics.gameFor(host)
}

export async function bundleRoutes(app: FastifyInstance, opts: { gamesDir: string }): Promise<void> {
  const root = resolve(opts.gamesDir)
  await statics.reload()

  async function serveFile(
    _req: { headers: { host?: string }; params: unknown },
    reply: { header: (k: string, v: string) => void; send: (s: unknown) => unknown },
    gameId: string, rest: string,
  ): Promise<unknown> {
    // Chặn path traversal: ghép -> normalize -> khẳng định vẫn trong thư mục game.
    // client_dir cũng đi qua normalize để một manifest xấu ("../..") không thoát ra.
    const gameRoot = normalize(join(root, gameId, await statics.dirFor(gameId)))
    if (!gameRoot.startsWith(root + '/')) throw notFound('CLIENT_DIR_ESCAPE')
    const target = normalize(join(gameRoot, rest))
    if (!target.startsWith(gameRoot + '/') && target !== gameRoot) throw notFound('PATH_ESCAPE')

    let file = target
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    } catch { throw notFound('FILE_NOT_FOUND') }

    let size: number
    try { size = (await stat(file)).size } catch { throw notFound('FILE_NOT_FOUND') }

    reply.header('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
    reply.header('content-length', String(size))
    // Bundle chưa có version bất biến -> không cache lâu.
    reply.header('cache-control', 'no-cache')
    return reply.send(createReadStream(file))
  }

  app.get('/g/:gameId/*', async (req, reply) => {
    const { gameId } = req.params as { gameId: string }
    const rest = (req.params as Record<string, string>)['*'] || 'index.html'
    return serveFile(req, reply, gameId, rest)
  })

  app.get('/g/:gameId', async (req, reply) => reply.redirect(`/g/${(req.params as { gameId: string }).gameId}/`, 302))

  // ── Custom domain ────────────────────────────────────────────────────────
  // Route wildcard, nên router của Fastify vẫn ưu tiên mọi route tĩnh
  // (/v1/*, /g/*, /health, /metrics) — có test khẳng định điều đó.
  const serveByHost = async (req: Parameters<typeof serveFile>[0], reply: Parameters<typeof serveFile>[1]) => {
    const gameId = await statics.gameFor(req.headers.host)
    if (!gameId) throw notFound('NO_GAME_FOR_HOST')
    const rest = (req.params as Record<string, string>)['*'] || 'index.html'
    return serveFile(req, reply, gameId, rest)
  }
  app.get('/', async (req, reply) => serveByHost(req, reply))
  app.get('/*', async (req, reply) => serveByHost(req, reply))
}
