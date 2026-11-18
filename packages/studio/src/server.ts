// `arcade studio [dir] [--port 4310]` — trang review cho developer. Mặt thứ ba của
// sổ đăng ký thao tác: trang chỉ gọi POST /api/call {action, args}, đúng hàm mà
// MCP gọi cho agent. Không có endpoint riêng nào làm việc mà agent không làm được.
//
// Chỉ nghe 127.0.0.1: đây là công cụ trên máy dev, có thao tác ghi (config.set,
// game.new) — không được lộ ra mạng.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGame } from '@arcade/gamekit'
import { actions, callAction, ActionError } from './action.ts'

const UI = fileURLToPath(new URL('../ui/index.html', import.meta.url))

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
}

export type StudioOpts = { target: string; port?: number; host?: string }

/** target là một game (có arcade.toml/spec.json) hoặc thư mục chứa nhiều game. */
export function context(target: string): { root: string; game: string | null } {
  const t = resolve(target)
  const isGame = existsSync(join(t, 'arcade.toml')) || existsSync(join(t, 'spec.json'))
  return isGame ? { root: resolve(t, '..'), game: t } : { root: t, game: null }
}

function send(res: ServerResponse, code: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 1_000_000) throw new ActionError('body quá lớn')
  }
  return raw ? JSON.parse(raw) : {}
}

/** /play/<đường-dẫn-game-mã-hoá>/... → file trong client_dir đã build của game đó. */
function serveGame(res: ServerResponse, root: string, rest: string): void {
  const [enc = '', ...parts] = rest.split('/')
  const dir = resolve(decodeURIComponent(enc))
  // Chỉ game nằm dưới root đang mở — không phục vụ file tuỳ ý trên máy.
  if (!(dir + sep).startsWith(resolve(root) + sep)) return send(res, 403, 'ngoài thư mục đang mở', 'text/plain; charset=utf-8')
  const c = validateGame(dir)
  const client = resolve(dir, c.manifest?.game.client_dir ?? '.')
  let file = resolve(client, decodeURIComponent(parts.join('/')) || 'index.html')
  if (!(file + sep).startsWith(client + sep) && file !== client) return send(res, 403, 'ngoài client_dir', 'text/plain; charset=utf-8')
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) return send(res, 404, `chưa có ${file} — game chưa build (npm run build)?`, 'text/plain; charset=utf-8')
  send(res, 200, readFileSync(file), TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
}

export function startStudio(o: StudioOpts): Promise<{ url: string; close(): void }> {
  const ctx = context(o.target)
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, readFileSync(UI), TYPES['.html'])
      if (req.method === 'GET' && url.pathname === '/api/context') return send(res, 200, ctx)
      if (req.method === 'GET' && url.pathname === '/api/actions') {
        return send(res, 200, actions().map((a) => ({ name: a.name, description: a.description, readOnly: a.readOnly, input: a.input })))
      }
      if (req.method === 'POST' && url.pathname === '/api/call') {
        const body = (await readBody(req)) as { action?: string; args?: unknown }
        try {
          return send(res, 200, { result: await callAction(String(body.action ?? ''), body.args ?? {}) })
        } catch (e) {
          return send(res, 200, { error: e instanceof ActionError ? e.message : String((e as Error).stack ?? e) })
        }
      }
      if (req.method === 'GET' && url.pathname.startsWith('/play/')) return serveGame(res, ctx.root, url.pathname.slice('/play/'.length))
      send(res, 404, 'không có', 'text/plain; charset=utf-8')
    } catch (e) {
      send(res, 500, { error: (e as Error).message })
    }
  })
  return new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(o.port ?? 4310, o.host ?? '127.0.0.1', () => {
      const a = server.address()
      const port = typeof a === 'object' && a ? a.port : o.port
      ok({ url: `http://127.0.0.1:${port}/`, close: () => server.close() })
    })
  })
}
