// Phục vụ bundle tĩnh của game. Thay thế server.js tự viết trong từng game.
import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, normalize, extname, resolve } from 'node:path'
import { notFound } from '@arcade/core'

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

export async function bundleRoutes(app: FastifyInstance, opts: { gamesDir: string }): Promise<void> {
  const root = resolve(opts.gamesDir)

  app.get('/g/:gameId/*', async (req, reply) => {
    const { gameId } = req.params as { gameId: string; '*': string }
    const rest = (req.params as Record<string, string>)['*'] || 'index.html'

    // Chặn path traversal: ghép rồi normalize rồi khẳng định vẫn nằm trong thư mục game.
    const gameRoot = join(root, gameId)
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
    // Bundle chưa có version bất biến ở M0 -> không cache lâu.
    reply.header('cache-control', 'no-cache')
    return reply.send(createReadStream(file))
  })

  app.get('/g/:gameId', async (req, reply) => reply.redirect(`/g/${(req.params as { gameId: string }).gameId}/`, 302))
}
