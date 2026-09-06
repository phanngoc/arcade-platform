/**
 * RoomHost — một phòng đang chạy. State nằm trong RAM của process này,
 * KHÔNG nằm trong Redis: 30Hz × N phòng ghi Redis sẽ giết cả Redis lẫn biên
 * lợi nhuận. Redis chỉ giữ metadata (code -> node) qua registry.
 *
 * Quyết định an toàn quan trọng: KHÔNG truyền hàm nào của host vào vm context.
 * Room module không gọi `room.broadcast()` của host — nó đẩy lệnh vào `room._out`
 * (mảng thuần), host đọc và thực thi sau khi hook trả về. Vừa bớt một đường
 * thoát sandbox, vừa khiến mọi tác động ra ngoài của module trở nên tuần tự và
 * quan sát được. `_out` bắt đầu bằng `_` nên diff bỏ qua, không tốn băng thông.
 */
import { diff, apply, checksum, snapshot, opsBytes, encode, type Op, type S2C } from '@arcade/protocol'
import { Sandbox, SandboxError } from './sandbox.ts'

export type PlayerConn = {
  id: string
  name: string | null
  isHost: boolean
  session: string
  send: (m: S2C) => void
  /** gửi frame ĐÃ serialize — cho phép serialize một lần rồi phát cho cả phòng */
  sendRaw: (frame: string) => void
  /** false khi đang mất kết nối và còn trong cửa sổ reconnect */
  live: boolean
  disconnectedAt: number
  prevView: unknown
  msgTokens: number
  lastRefill: number
}

export type RoomLimits = {
  tickRate: number
  maxPlayers: number
  stateBytes: number
  cpuMsPerTick: number
  msgPerSec: number
  idleTimeoutSec: number
  reconnectWindowSec: number
}

export const DEFAULT_LIMITS: RoomLimits = {
  tickRate: 30, maxPlayers: 4, stateBytes: 65536, cpuMsPerTick: 8,
  msgPerSec: 30, idleTimeoutSec: 60, reconnectWindowSec: 30,
}

type OutCmd =
  | ['bc', string, unknown]            // broadcast event
  | ['snd', string, string, unknown]   // send tới 1 người
  | ['lock', boolean]
  | ['dispose']
  | ['score', string, string, number]  // board, playerId, score
  | ['save', string, unknown]
  | ['log', string]

export type RoomSideEffects = {
  submitScore: (gameId: string, board: string, playerId: string, score: number) => void
  persist: (gameId: string, key: string, value: unknown) => void
  log: (msg: string) => void
}

const CLOCK = () => Number(process.hrtime.bigint() / 1000n) / 1000   // ms, độ phân giải cao

export class RoomHost {
  gameId: string
  code: string
  mode: string
  limits: RoomLimits
  players = new Map<string, PlayerConn>()
  seq = 0
  locked = false
  disposed = false
  disposeReason: string | null = null
  createdAt = Date.now()
  lastEmptyAt: number | null = Date.now()
  peakPlayers = 0
  tickMs: number
  nextTickAt: number
  tickCount = 0
  cpuMs: number[] = []
  patchBytes = 0
  private overruns = 0
  private sandbox: Sandbox | null
  private state: Record<string, unknown>
  private prev: unknown
  private inbox: { pid: string; type: string; payload: unknown }[] = []
  private fx: RoomSideEffects
  private lastTickClock = CLOCK()
  /** Object truyền vào module. Tạo MỘT lần rồi mutate — cấp phát mỗi tick ở
   *  30Hz × N phòng là nguồn áp lực GC lớn nhất mà ta tự gây ra. */
  private roomObj: Record<string, unknown>
  private playersDirty = true

  constructor(o: {
    gameId: string; code: string; mode: string; sandbox: Sandbox | null
    limits?: Partial<RoomLimits>; opts?: unknown; fx: RoomSideEffects
  }) {
    this.gameId = o.gameId
    this.code = o.code
    this.mode = o.mode
    this.sandbox = o.sandbox
    this.fx = o.fx
    const cfg = o.sandbox?.config ?? {}
    this.limits = {
      ...DEFAULT_LIMITS,
      ...(cfg.tickRate ? { tickRate: cfg.tickRate } : {}),
      ...(cfg.maxPlayers ? { maxPlayers: cfg.maxPlayers } : {}),
      ...o.limits,
    }
    this.tickMs = 1000 / this.limits.tickRate
    this.nextTickAt = CLOCK() + this.tickMs

    this.state = (this.sandbox?.call<Record<string, unknown>>('initialState', 200) as Record<string, unknown>) ?? {}
    if (typeof this.state !== 'object' || this.state === null) this.state = {}
    this.roomObj = { state: this.state, code: this.code, players: [], tick: 0, _out: [] as OutCmd[] }
    this.callHook('onCreate', o.opts)
    this.prev = snapshot(this.state)
  }

  // ── vòng đời người chơi ────────────────────────────────────────────────────

  get liveCount(): number {
    let n = 0
    for (const p of this.players.values()) if (p.live) n++
    return n
  }

  canJoin(): { ok: true } | { ok: false; code: 'ROOM_FULL' | 'ROOM_LOCKED' } {
    if (this.locked) return { ok: false, code: 'ROOM_LOCKED' }
    if (this.players.size >= this.limits.maxPlayers) return { ok: false, code: 'ROOM_FULL' }
    return { ok: true }
  }

  addPlayer(p: PlayerConn): void {
    this.players.set(p.id, p)
    this.playersDirty = true
    this.lastEmptyAt = null
    this.peakPlayers = Math.max(this.peakPlayers, this.players.size)
    this.callHook('onJoin', { id: p.id, name: p.name, isHost: p.isHost })
    this.broadcastExcept(p.id, { t: 'join', p: { id: p.id, name: p.name } })
    this.sendSnapshot(p)
  }

  /** Mất kết nối: GIỮ chỗ trong cửa sổ reconnect, không gọi onLeave ngay. */
  markDisconnected(pid: string): void {
    const p = this.players.get(pid)
    if (!p) return
    p.live = false
    p.disconnectedAt = Date.now()
    this.playersDirty = true
    if (this.liveCount === 0) this.lastEmptyAt = Date.now()
  }

  reattach(pid: string, send: (m: S2C) => void): boolean {
    const p = this.players.get(pid)
    if (!p) return false
    p.send = send
    p.live = true
    this.playersDirty = true
    p.disconnectedAt = 0
    this.lastEmptyAt = null
    this.sendSnapshot(p)
    return true
  }

  removePlayer(pid: string, reason: 'left' | 'timeout' | 'kicked' | 'disposed'): void {
    const p = this.players.get(pid)
    if (!p) return
    this.players.delete(pid)
    this.playersDirty = true
    this.callHook('onLeave', { id: p.id, name: p.name, isHost: p.isHost }, reason)
    this.broadcast({ t: 'left', p: pid, r: reason })
    if (this.liveCount === 0) this.lastEmptyAt = Date.now()
  }

  // ── input ─────────────────────────────────────────────────────────────────

  /** Trả false nếu bị rate limit (token bucket theo từng người chơi). */
  enqueue(pid: string, type: string, payload: unknown): boolean {
    const p = this.players.get(pid)
    if (!p) return false
    const now = Date.now()
    const elapsed = (now - p.lastRefill) / 1000
    p.msgTokens = Math.min(this.limits.msgPerSec, p.msgTokens + elapsed * this.limits.msgPerSec)
    p.lastRefill = now
    if (p.msgTokens < 1) return false
    p.msgTokens -= 1
    // Chặn trần hàng đợi: người chơi lag không được làm phồng bộ nhớ của phòng.
    if (this.inbox.length < this.limits.msgPerSec * 2) this.inbox.push({ pid, type, payload })
    return true
  }

  // ── tick ──────────────────────────────────────────────────────────────────

  tick(nowClock: number): void {
    if (this.disposed) return
    const t0 = CLOCK()
    const dt = Math.min((t0 - this.lastTickClock) / 1000, 0.25)   // chặn dt sau khi process bị treo
    this.lastTickClock = t0

    try {
      for (const m of this.inbox) {
        const p = this.players.get(m.pid)
        if (p) this.messageHook({ id: p.id, name: p.name, isHost: p.isHost }, m.type, m.payload)
      }
      this.inbox.length = 0
      this.tickHook(dt)
    } catch (e) {
      this.fail(e instanceof SandboxError ? e.message : String(e))
      return
    }

    this.drainOut()
    if (this.disposed) return

    const size = Buffer.byteLength(JSON.stringify(this.stateForWire()), 'utf8')
    if (size > this.limits.stateBytes) {
      this.fail(`state ${size} byte > giới hạn ${this.limits.stateBytes}`)
      return
    }

    this.publish()
    this.tickCount++

    const spent = CLOCK() - t0
    this.cpuMs.push(spent)
    if (this.cpuMs.length > 300) this.cpuMs.shift()
    // Vượt ngân sách CPU liên tục 30 tick -> phòng bị thu hồi. Một game xấu
    // không được kéo sập host.
    if (spent > this.limits.cpuMsPerTick) {
      if (++this.overruns >= 30) this.fail(`vượt ngân sách CPU ${this.limits.cpuMsPerTick}ms trong 30 tick liên tiếp`)
    } else this.overruns = 0

    this.nextTickAt = nowClock + this.tickMs
  }

  /** Diff và gửi. Không có `view()` thì diff MỘT lần và serialize MỘT lần cho cả phòng. */
  private publish(): void {
    const hasView = this.sandbox?.has('view') ?? false
    if (!hasView) {
      const cur = this.stateForWire()
      const ops = diff(this.prev, cur)
      if (!ops.length) return
      this.prev = snapshot(cur)
      this.seq++
      const frame = encode({ t: 'patch', ops, c: checksum(cur), seq: this.seq })
      this.patchBytes += frame.length
      for (const p of this.players.values()) if (p.live) p.sendRaw(frame)
      return
    }
    // Có view(): mỗi người một góc nhìn -> phải diff riêng. Đắt hơn nhiều,
    // chỉ dùng khi game thật cần giấu thông tin.
    this.seq++
    for (const p of this.players.values()) {
      if (!p.live) continue
      let view: unknown
      try {
        view = this.callHook('view', { id: p.id, name: p.name, isHost: p.isHost })
      } catch { view = this.stateForWire() }
      const ops = diff(p.prevView, view)
      if (!ops.length) continue
      p.prevView = snapshot(view)
      this.patchBytes += opsBytes(ops) + 40
      p.send({ t: 'patch', ops, c: checksum(view), seq: this.seq })
    }
  }

  private stateForWire(): Record<string, unknown> { return this.state }

  sendSnapshot(p: PlayerConn): void {
    let view: unknown = this.stateForWire()
    if (this.sandbox?.has('view')) {
      try { view = this.callHook('view', { id: p.id, name: p.name, isHost: p.isHost }) } catch { /* dùng state đầy đủ */ }
    }
    p.prevView = snapshot(view)
    p.send({ t: 'snap', s: view, c: checksum(view), seq: this.seq })
  }

  // ── lệnh module đẩy ra ────────────────────────────────────────────────────

  private drainOut(): void {
    const out = this.roomObj['_out'] as OutCmd[] | undefined
    if (!Array.isArray(out) || !out.length) return
    for (const cmd of out) {
      switch (cmd[0]) {
        case 'bc':    this.broadcast({ t: 'ev', n: cmd[1], d: cmd[2] }); break
        case 'snd':   this.players.get(cmd[1])?.send({ t: 'ev', n: cmd[2], d: cmd[3] }); break
        case 'lock':  this.locked = cmd[1]; break
        case 'score': this.fx.submitScore(this.gameId, cmd[1], cmd[2], cmd[3]); break
        case 'save':  this.fx.persist(this.gameId, cmd[1], cmd[2]); break
        case 'log':   this.fx.log(cmd[1]); break
        case 'dispose': this.dispose('disposed by module'); break
      }
    }
    out.length = 0
  }

  // ── hook ──────────────────────────────────────────────────────────────────

  private tickHook(dt: number): void {
    this.sandbox?.call('onTick', this.limits.cpuMsPerTick * 4, this.roomArg(), dt)
  }

  /** onMessage nhận (room, player, type, payload) — gộp type+payload thành một
   *  object để vừa khung 4 tham số của sandbox.call. */
  private messageHook(player: unknown, type: string, payload: unknown): void {
    this.sandbox?.call('onMessage', this.limits.cpuMsPerTick * 4, this.roomArg(), player, type, payload)
  }

  private callHook<T = unknown>(hook: 'onCreate' | 'onJoin' | 'onLeave' | 'onDispose' | 'view', a?: unknown, b?: unknown): T | undefined {
    if (!this.sandbox) return undefined
    try {
      return this.sandbox.call<T>(hook, 100, this.roomArg(), a, b)
    } catch (e) {
      this.fx.log(e instanceof Error ? e.message : String(e))
      if (hook !== 'view') this.fail(e instanceof Error ? e.message : String(e))
      return undefined
    }
  }

  /** Object truyền vào module: dữ liệu thuần + helper do chính vm định nghĩa. */
  private roomArg(): Record<string, unknown> {
    if (this.playersDirty) {
      this.roomObj['players'] = Array.from(this.players.values())
        .map((p) => ({ id: p.id, name: p.name, isHost: p.isHost, live: p.live }))
      this.playersDirty = false
    }
    this.roomObj['tick'] = this.tickCount
    return this.roomObj
  }

  // ── kết thúc ──────────────────────────────────────────────────────────────

  broadcast(m: S2C): void { for (const p of this.players.values()) if (p.live) p.send(m) }
  broadcastExcept(pid: string, m: S2C): void {
    for (const p of this.players.values()) if (p.live && p.id !== pid) p.send(m)
  }

  private fail(reason: string): void {
    this.fx.log(`phòng ${this.code} lỗi: ${reason}`)
    this.broadcast({ t: 'err', code: 'MODULE_ERROR', msg: reason })
    this.dispose(reason)
  }

  dispose(reason: string): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeReason = reason
    try { this.callHook('onDispose') } catch { /* đang tắt rồi */ }
    this.drainOut()      // để onDispose kịp flush điểm và save
    this.broadcast({ t: 'left', p: '*', r: 'disposed' })
    this.sandbox = null
  }

  /** Phòng nên bị thu hồi chưa? */
  expired(now = Date.now()): boolean {
    if (this.disposed) return true
    if (this.lastEmptyAt === null) return false
    return now - this.lastEmptyAt > this.limits.idleTimeoutSec * 1000
  }

  /** Người mất kết nối quá cửa sổ reconnect thì bỏ hẳn. */
  reapDisconnected(now = Date.now()): void {
    for (const p of [...this.players.values()]) {
      if (!p.live && now - p.disconnectedAt > this.limits.reconnectWindowSec * 1000) {
        this.removePlayer(p.id, 'timeout')
      }
    }
  }

  stats() {
    const s = [...this.cpuMs].sort((a, b) => a - b)
    const q = (f: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))]! : 0)
    return {
      code: this.code, players: this.players.size, live: this.liveCount, tick: this.tickCount,
      p50: q(0.5), p99: q(0.99), patchBytes: this.patchBytes, seq: this.seq,
    }
  }
}
