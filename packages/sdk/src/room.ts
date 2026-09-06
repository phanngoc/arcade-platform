/**
 * Phần realtime của SDK. Game chỉ thấy `room.onState(...)` và `room.send(...)`;
 * mọi thứ khác — reconnect, backoff, hàng đợi khi mất mạng, phát hiện lệch
 * state và xin snapshot — SDK lo.
 *
 * Đây chính là phần khiến game không phải viết netcode: tank-battle trước đây
 * tự làm hết những việc này trong client.js.
 */
import { apply } from '@arcade/protocol/patch'
import type { Op } from '@arcade/protocol/patch'

export const PROTOCOL_VERSION = 1

type S2C =
  | { t: 'welcome'; playerId: string; session: string; code: string; url: string; isHost: boolean }
  | { t: 'snap'; s: unknown; c: number; seq: number }
  | { t: 'patch'; ops: Op[]; c: number; seq: number }
  | { t: 'ev'; n: string; d?: unknown }
  | { t: 'join'; p: { id: string; name: string | null } }
  | { t: 'left'; p: string; r: string }
  | { t: 'ping'; id: number }
  | { t: 'err'; code: string; msg?: string }

export type RoomInfo = { code: string; url: string; playerId: string; isHost: boolean }
export type RoomOpts = { wsUrl: string; token: string; name?: string }

type Handler<T> = (v: T) => void

export class Room {
  code = ''
  url = ''
  playerId = ''
  isHost = false
  state: unknown = undefined
  connected = false

  private ws: WebSocket | null = null
  private session: string | null = null
  private seq = 0
  private queue: unknown[] = []
  private closedByUser = false
  private retry = 0
  private opts: RoomOpts
  private intent: { kind: 'create'; mode: string; opts?: unknown } | { kind: 'join'; code: string }

  private hState: Handler<unknown>[] = []
  private hEvent = new Map<string, Handler<unknown>[]>()
  private hJoin: Handler<{ id: string; name: string | null }>[] = []
  private hLeft: Handler<{ id: string; reason: string }>[] = []
  private hStatus: Handler<'connected' | 'reconnecting' | 'closed'>[] = []
  private hError: Handler<{ code: string; msg?: string }>[] = []

  constructor(opts: RoomOpts, intent: Room['intent']) {
    this.opts = opts
    this.intent = intent
  }

  onState(f: Handler<unknown>) { this.hState.push(f); return this }
  onEvent(name: string, f: Handler<unknown>) {
    const a = this.hEvent.get(name) ?? []
    a.push(f); this.hEvent.set(name, a); return this
  }
  onPlayerJoin(f: Handler<{ id: string; name: string | null }>) { this.hJoin.push(f); return this }
  onPlayerLeave(f: Handler<{ id: string; reason: string }>) { this.hLeft.push(f); return this }
  onStatus(f: Handler<'connected' | 'reconnecting' | 'closed'>) { this.hStatus.push(f); return this }
  onError(f: Handler<{ code: string; msg?: string }>) { this.hError.push(f); return this }

  /** Gửi input. Mất mạng thì xếp hàng (tối đa 50) và gửi lại sau khi nối lại. */
  send(name: string, data?: unknown): void {
    const m = { t: 'msg', n: name, d: data }
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m))
    else if (this.queue.length < 50) this.queue.push(m)
  }

  close(): void {
    this.closedByUser = true
    try { this.ws?.send(JSON.stringify({ t: 'leave' })) } catch { /* đã đứt */ }
    this.ws?.close()
    this.emit(this.hStatus, 'closed')
  }

  connect(): Promise<RoomInfo> {
    return new Promise((resolve, reject) => {
      let settled = false
      const open = () => {
        const ws = new WebSocket(this.opts.wsUrl)
        this.ws = ws

        ws.onopen = () => {
          ws.send(JSON.stringify({ t: 'hello', token: this.opts.token, v: PROTOCOL_VERSION }))
          // Có session cũ -> thử nối lại đúng phòng cũ trước khi tạo/vào mới.
          if (this.session) ws.send(JSON.stringify({ t: 'rejoin', session: this.session }))
          else if (this.intent.kind === 'create') {
            ws.send(JSON.stringify({ t: 'create', mode: this.intent.mode, opts: this.intent.opts, name: this.opts.name }))
          } else {
            ws.send(JSON.stringify({ t: 'join', code: this.intent.code, name: this.opts.name }))
          }
        }

        ws.onmessage = (e) => {
          const m = JSON.parse(String(e.data)) as S2C
          switch (m.t) {
            case 'welcome':
              this.code = m.code; this.url = m.url; this.playerId = m.playerId
              this.isHost = m.isHost; this.session = m.session
              this.connected = true; this.retry = 0
              for (const q of this.queue.splice(0)) ws.send(JSON.stringify(q))
              this.emit(this.hStatus, 'connected')
              if (!settled) { settled = true; resolve({ code: m.code, url: m.url, playerId: m.playerId, isHost: m.isHost }) }
              break
            case 'snap':
              this.state = m.s; this.seq = m.seq
              this.emit(this.hState, this.state)
              break
            case 'patch':
              // Nhảy seq = mất gói hoặc lệch -> xin lại snapshot đầy đủ.
              if (m.seq !== this.seq + 1 && this.seq !== 0) { ws.send(JSON.stringify({ t: 'resync' })); break }
              this.state = apply(this.state, m.ops)
              this.seq = m.seq
              this.emit(this.hState, this.state)
              break
            case 'ev':
              for (const f of this.hEvent.get(m.n) ?? []) f(m.d)
              break
            case 'join': this.emit(this.hJoin, m.p); break
            case 'left': this.emit(this.hLeft, { id: m.p, reason: m.r }); break
            case 'ping': ws.send(JSON.stringify({ t: 'pong', id: m.id })); break
            case 'err':
              this.emit(this.hError, { code: m.code, msg: m.msg })
              // Lỗi vào phòng là dứt điểm — nối lại cũng vô ích.
              if (['ROOM_NOT_FOUND', 'ROOM_FULL', 'ROOM_LOCKED', 'SESSION_INVALID', 'GAME_NOT_FOUND'].includes(m.code)) {
                this.closedByUser = true
                if (!settled) { settled = true; reject(new Error(m.code)) }
              }
              break
          }
        }

        ws.onclose = () => {
          this.connected = false
          if (this.closedByUser) return
          // Backoff có jitter: tránh cả phòng nối lại cùng một nhịp sau khi
          // server khởi động lại, dồn thành một đợt tải.
          this.emit(this.hStatus, 'reconnecting')
          const wait = Math.min(5000, 500 * Math.pow(1.6, this.retry++)) * (0.7 + Math.random() * 0.6)
          setTimeout(open, wait)
        }

        ws.onerror = () => { /* onclose sẽ chạy ngay sau */ }
      }
      open()
    })
  }

  private emit<T>(hs: Handler<T>[], v: T) { for (const f of hs) f(v) }
}
