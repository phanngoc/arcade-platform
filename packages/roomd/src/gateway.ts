/**
 * Gateway WebSocket. Một kết nối = một người chơi trong một phòng.
 *
 * Xác thực bằng CHÍNH JWT của REST API (claim `gid` quyết định game) — không có
 * đường đăng nhập riêng cho WebSocket, nên không có bề mặt auth thứ hai để sai.
 */
import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { decode, encode, normalizeCode, PROTOCOL_VERSION, type S2C, type ErrCode } from '@arcade/protocol'
import { putSession, getSession, dropSession } from '@arcade/core'
import type { RoomManager } from './manager.ts'
import type { PlayerConn } from './room.ts'

const PING_EVERY_MS = 5000
const PONG_TIMEOUT_MS = 15000
const HELLO_TIMEOUT_MS = 5000

type Conn = {
  ws: WebSocket
  playerId: string | null
  gameId: string | null
  isGuest: boolean
  code: string | null
  session: string | null
  lastPong: number
  pingId: number
  helloAt: number
  /** Hàng đợi tuần tự hoá xử lý message của CHÍNH kết nối này. */
  chain: Promise<void>
}

export type GatewayDeps = {
  manager: RoomManager
  verifyToken: (token: string) => Promise<{ playerId: string; gameId: string; isGuest: boolean }>
  publicBaseUrl: string
  log: (msg: string, extra?: Record<string, unknown>) => void
}

export function attachGateway(server: Server, deps: GatewayDeps): { wss: WebSocketServer; close: () => Promise<void> } {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 })
  const conns = new Set<Conn>()

  const send = (ws: WebSocket, m: S2C) => { if (ws.readyState === 1) ws.send(encode(m)) }
  const fail = (c: Conn, code: ErrCode, msg?: string) => {
    send(c.ws, { t: 'err', code, msg })
    c.ws.close(1008, code)
  }

  wss.on('connection', (ws) => {
    const c: Conn = {
      ws, playerId: null, gameId: null, isGuest: true, code: null, session: null,
      lastPong: Date.now(), pingId: 0, helloAt: Date.now(), chain: Promise.resolve(),
    }
    conns.add(c)

    // Xử lý TUẦN TỰ theo từng kết nối. onMessage là async (verify token, đọc
    // registry), nên nếu gọi song song thì client gửi liền `hello` + `create`
    // sẽ bị xử lý ngược thứ tự: `create` chạy khi hello chưa verify xong và bị
    // từ chối TOKEN_INVALID. Client thật gửi đúng kiểu đó.
    ws.on('message', (raw) => {
      const s = String(raw)
      c.chain = c.chain.then(() => onMessage(c, s)).catch((e: unknown) => {
        deps.log('lỗi xử lý message', { err: e instanceof Error ? e.message : String(e) })
      })
    })
    ws.on('close', () => {
      conns.delete(c)
      if (c.gameId && c.code && c.playerId) {
        deps.manager.get(c.gameId, c.code)?.markDisconnected(c.playerId)
      }
    })
    ws.on('error', () => { /* close sẽ chạy ngay sau */ })
  })

  async function onMessage(c: Conn, raw: string): Promise<void> {
    const m = decode(raw)
    if (!m) return fail(c, 'BAD_MESSAGE')

    if (m.t === 'hello') {
      if (m.v !== PROTOCOL_VERSION) return fail(c, 'PROTOCOL_VERSION', `server dùng v${PROTOCOL_VERSION}`)
      try {
        const a = await deps.verifyToken(m.token)
        c.playerId = a.playerId; c.gameId = a.gameId; c.isGuest = a.isGuest
      } catch { return fail(c, 'TOKEN_INVALID') }
      return
    }

    if (!c.playerId || !c.gameId) return fail(c, 'TOKEN_INVALID', 'phải gửi hello trước')
    const gameId = c.gameId, playerId = c.playerId

    switch (m.t) {
      case 'create': {
        const r = await deps.manager.create(gameId, m.mode, m.opts)
        if ('err' in r) return fail(c, r.err, r.msg)
        await enter(c, r.code, m.name ?? null, true)
        return
      }
      case 'join': {
        const code = normalizeCode(m.code)
        if (!code) return fail(c, 'ROOM_NOT_FOUND', 'mã phòng không hợp lệ')
        const room = deps.manager.get(gameId, code)
        if (!room) return fail(c, 'ROOM_NOT_FOUND')
        const can = room.canJoin()
        if (!can.ok) return fail(c, can.code)
        await enter(c, code, m.name ?? null, false)
        return
      }
      case 'rejoin': {
        const s = await getSession(gameId, m.session)
        if (!s || s.playerId !== playerId) return fail(c, 'SESSION_INVALID')
        const room = deps.manager.get(gameId, s.code)
        if (!room) return fail(c, 'ROOM_NOT_FOUND')
        c.code = s.code; c.session = m.session
        const ok = room.reattach(playerId, (msg) => send(c.ws, msg))
        if (!ok) return fail(c, 'SESSION_INVALID')
        send(c.ws, {
          t: 'welcome', playerId, session: m.session, code: s.code,
          url: inviteUrl(gameId, s.code), isHost: false,
        })
        return
      }
      case 'msg': {
        if (!c.code) return fail(c, 'NOT_IN_ROOM')
        const room = deps.manager.get(gameId, c.code)
        if (!room) return fail(c, 'ROOM_NOT_FOUND')
        // Rate limit ở tầng gateway: vượt thì DROP, không ngắt kết nối —
        // ngắt kết nối vì lag mạng sẽ đá oan người chơi thật.
        if (!room.enqueue(playerId, m.n, m.d)) send(c.ws, { t: 'err', code: 'RATE_LIMITED' })
        return
      }
      case 'pong':
        c.lastPong = Date.now()
        return
      case 'resync': {
        if (!c.code) return fail(c, 'NOT_IN_ROOM')
        const room = deps.manager.get(gameId, c.code)
        const p = room?.players.get(playerId)
        if (room && p) room.sendSnapshot(p)
        return
      }
      case 'leave': {
        if (c.code) deps.manager.get(gameId, c.code)?.removePlayer(playerId, 'left')
        if (c.session && c.gameId) await dropSession(c.gameId, c.session)
        c.ws.close(1000, 'left')
        return
      }
    }
  }

  function inviteUrl(gameId: string, code: string): string {
    return `${deps.publicBaseUrl}/g/${gameId}/?room=${code}`
  }

  async function enter(c: Conn, code: string, name: string | null, isHost: boolean): Promise<void> {
    const gameId = c.gameId!, playerId = c.playerId!
    const room = deps.manager.get(gameId, code)
    if (!room) return fail(c, 'ROOM_NOT_FOUND')

    const session = randomUUID()
    c.code = code; c.session = session
    await putSession(session, { code, playerId, gameId }, room.limits.reconnectWindowSec + 60)

    const conn: PlayerConn = {
      id: playerId, name, isHost, session, live: true, disconnectedAt: 0,
      prevView: undefined, msgTokens: room.limits.msgPerSec, lastRefill: Date.now(),
      send: (m) => send(c.ws, m),
      sendRaw: (frame) => { if (c.ws.readyState === 1) c.ws.send(frame) },
    }
    send(c.ws, { t: 'welcome', playerId, session, code, url: inviteUrl(gameId, code), isHost })
    room.addPlayer(conn)
  }

  // Ping/pong: phát hiện kết nối chết mà TCP chưa báo (mạng di động rất hay thế).
  const heartbeat = setInterval(() => {
    const now = Date.now()
    for (const c of conns) {
      if (!c.playerId && now - c.helloAt > HELLO_TIMEOUT_MS) { c.ws.close(1008, 'hello timeout'); continue }
      if (now - c.lastPong > PONG_TIMEOUT_MS) { c.ws.terminate(); continue }
      send(c.ws, { t: 'ping', id: ++c.pingId })
    }
  }, PING_EVERY_MS)
  heartbeat.unref()

  return {
    wss,
    close: async () => {
      clearInterval(heartbeat)
      for (const c of conns) c.ws.close(1001, 'server shutdown')
      await new Promise<void>((r) => wss.close(() => r()))
    },
  }
}
