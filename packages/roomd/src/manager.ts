/**
 * RoomManager — sở hữu mọi phòng trên node này, và MỘT bộ định giờ duy nhất.
 *
 * Một setInterval 10ms chạy scheduler cho tất cả phòng, KHÔNG phải một timer
 * mỗi phòng: hàng nghìn timer làm event loop của Node tệ đi rõ rệt và là một
 * trong hai lý do chính khiến số CCU/vCPU sụt.
 */
import { generateCode } from '@arcade/protocol'
import { claimRoom, renewRoom, releaseRoom, type RoomEntry } from '@arcade/core'
import { RoomHost, type RoomLimits, type RoomSideEffects, type PlayerConn } from './room.ts'
import { Sandbox } from './sandbox.ts'

export const SCHEDULER_MS = 10
const RENEW_EVERY_MS = 30_000

export type GameDef = {
  gameId: string
  mode: 'authoritative' | 'relay' | 'offline'
  roomSource: string | null          // mã nguồn room module; null = relay/offline
  limits?: Partial<RoomLimits>
}

export class RoomManager {
  rooms = new Map<string, RoomHost>()          // key: `${gameId}:${code}`
  draining = false
  private timer: NodeJS.Timeout | null = null
  private lastRenew = 0
  private nodeUrl: string
  private fx: RoomSideEffects
  private games = new Map<string, GameDef>()

  constructor(o: { nodeUrl: string; fx: RoomSideEffects }) {
    this.nodeUrl = o.nodeUrl
    this.fx = o.fx
  }

  registerGame(def: GameDef): void { this.games.set(def.gameId, def) }
  game(gameId: string): GameDef | undefined { return this.games.get(gameId) }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.step(), SCHEDULER_MS)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    for (const r of this.rooms.values()) r.dispose('shutdown')
    await Promise.all([...this.rooms.values()].map((r) => releaseRoom(r.gameId, r.code)))
    this.rooms.clear()
  }

  private key(gameId: string, code: string) { return `${gameId}:${code}` }

  async create(gameId: string, mode: string, opts: unknown): Promise<RoomHost | { err: 'DRAINING' | 'GAME_NOT_FOUND' | 'MODULE_ERROR'; msg?: string }> {
    if (this.draining) return { err: 'DRAINING' }
    const def = this.games.get(gameId)
    if (!def) return { err: 'GAME_NOT_FOUND' }

    // Cấp mã: thử tối đa 8 lần. Registry là nơi kiểm trùng, nên "mã duy nhất"
    // đúng trên toàn cụm chứ không chỉ trên node này.
    let code: string | null = null
    const entry: RoomEntry = { node: this.nodeUrl, mode, createdAt: Date.now() }
    for (let i = 0; i < 8; i++) {
      const c = generateCode()
      if (await claimRoom(gameId, c, entry)) { code = c; break }
    }
    if (!code) return { err: 'MODULE_ERROR', msg: 'không cấp được mã phòng' }

    let sandbox: Sandbox | null = null
    if (def.roomSource) {
      try {
        sandbox = new Sandbox(def.roomSource, {
          filename: `${gameId}/room.js`,
          onLog: (...a) => this.fx.log(`[${gameId}:${code}] ` + a.map(String).join(' ')),
        })
      } catch (e) {
        await releaseRoom(gameId, code)
        return { err: 'MODULE_ERROR', msg: e instanceof Error ? e.message : String(e) }
      }
    }

    const room = new RoomHost({ gameId, code, mode, sandbox, limits: def.limits, opts, fx: this.fx })
    this.rooms.set(this.key(gameId, code), room)
    return room
  }

  get(gameId: string, code: string): RoomHost | undefined { return this.rooms.get(this.key(gameId, code)) }

  /** Một nhịp scheduler: tick các phòng tới hạn, thu hồi phòng hết hạn, gia hạn registry. */
  private step(): void {
    const nowClock = Number(process.hrtime.bigint() / 1000n) / 1000
    const now = Date.now()

    for (const [k, room] of this.rooms) {
      if (room.disposed) { this.retire(k, room); continue }
      if (room.expired(now)) { room.dispose('idle timeout'); this.retire(k, room); continue }
      room.reapDisconnected(now)
      if (nowClock >= room.nextTickAt) room.tick(nowClock)
    }

    if (now - this.lastRenew > RENEW_EVERY_MS) {
      this.lastRenew = now
      // Node còn sống thì gia hạn. Node chết -> key hết hạn -> mã tự giải phóng.
      // Đang drain thì KHÔNG gia hạn: phòng hiện có chơi tiếp, nhưng node này
      // biến khỏi registry nên không nhận phòng mới.
      if (!this.draining) {
        for (const room of this.rooms.values()) {
          void renewRoom(room.gameId, room.code, { node: this.nodeUrl, mode: room.mode, createdAt: room.createdAt })
        }
      }
    }
  }

  private retire(k: string, room: RoomHost): void {
    this.rooms.delete(k)
    void releaseRoom(room.gameId, room.code)
    this.fx.log(`phòng ${room.code} đóng: ${room.disposeReason ?? 'kết thúc'} (đỉnh ${room.peakPlayers} người, ${room.tickCount} tick)`)
  }

  /**
   * Drain: rút khỏi registry để không nhận phòng mới, chờ phòng hiện có kết thúc
   * tự nhiên. KHÔNG kill phòng đang chơi. Viết ở M1 kể cả khi chỉ có một node —
   * lúc có ba node thì đã quá muộn để nghĩ.
   */
  async drain(opts: { timeoutMs?: number; onProgress?: (left: number) => void } = {}): Promise<boolean> {
    this.draining = true
    await Promise.all([...this.rooms.values()].map((r) => releaseRoom(r.gameId, r.code)))
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000)
    while (this.rooms.size > 0 && Date.now() < deadline) {
      opts.onProgress?.(this.rooms.size)
      await new Promise((r) => setTimeout(r, 500))
    }
    return this.rooms.size === 0
  }

  stats() {
    let players = 0, live = 0, patchBytes = 0
    const cpu: number[] = []
    for (const r of this.rooms.values()) {
      players += r.players.size; live += r.liveCount; patchBytes += r.patchBytes
      cpu.push(...r.cpuMs)
    }
    cpu.sort((a, b) => a - b)
    const q = (f: number) => (cpu.length ? cpu[Math.min(cpu.length - 1, Math.floor(cpu.length * f))]! : 0)
    return {
      rooms: this.rooms.size, players, live, patchBytes,
      tickP50: q(0.5), tickP99: q(0.99), draining: this.draining,
    }
  }
}

export type { PlayerConn }
