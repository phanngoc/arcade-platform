/**
 * Nạp room module vào một vm context hẹp.
 *
 * ⚠ `node:vm` KHÔNG PHẢI ranh giới bảo mật — có kỹ thuật thoát context đã biết.
 * Ở M1 chấp nhận được vì chỉ chạy code của chính mình. Cổng chặn cứng: không
 * nhận room module của người ngoài và không mở Forge công khai cho tới khi thay
 * bằng isolated-vm (tiến trình riêng, heap riêng) hoặc Durable Objects.
 * Xem IMPLEMENTATION §4.4.
 *
 * Cái `vm` LÀM được và ta dựa vào: tuỳ chọn `timeout` khiến V8 **kết thúc** một
 * script đang chạy. Nhờ vậy `onTick` lặp vô hạn bị giết thay vì treo cả process.
 * Đây là lý do mọi hook được gọi qua một compiled script có timeout, chứ không
 * gọi thẳng hàm JS lấy ra từ context.
 */
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

export type RoomModule = {
  initialState?: () => unknown
  onCreate?: (room: unknown, opts: unknown) => void
  onJoin?: (room: unknown, player: unknown) => void
  onMessage?: (room: unknown, player: unknown, type: string, payload: unknown) => void
  onTick?: (room: unknown, dt: number) => void
  onLeave?: (room: unknown, player: unknown, reason: string) => void
  onDispose?: (room: unknown) => void
  view?: (room: unknown, player: unknown) => unknown
  onScoreSubmit?: (room: unknown, player: unknown, score: number) => boolean
  config?: { tickRate?: number; maxPlayers?: number }
}

export type SandboxOpts = {
  filename?: string
  loadTimeoutMs?: number
  onLog?: (...a: unknown[]) => void
}

export class SandboxError extends Error {
  hook: string
  /** Stack trong vm — dòng đầu tiên chỉ đúng chỗ trong room module. Giữ lại
   *  vì nếu chỉ có message thì lỗi trong module gần như không truy được. */
  moduleStack: string | null
  constructor(hook: string, cause: unknown) {
    // Lỗi ném từ trong vm là instance của Error THUỘC REALM KHÁC, nên
    // `cause instanceof Error` của host luôn false. Phải duck-type, nếu không
    // sẽ mất sạch stack đúng lúc cần nó nhất.
    const e = cause as { message?: string; stack?: string } | null
    const stack = e && typeof e === 'object' && typeof e.stack === 'string' ? e.stack : null
    const first = stack ? stack.split('\n').slice(0, 4).map((s) => s.trim()).join(' | ') : null
    const msg = e && typeof e === 'object' && typeof e.message === 'string' ? e.message : String(cause)
    super(`room module lỗi ở ${hook}: ${msg}` + (first ? ` [${first}]` : ''))
    this.hook = hook
    this.moduleStack = first
  }
}

const INVOKE = new vm.Script('__arcade_invoke(__h, __a, __b, __c, __d)', { filename: 'arcade:invoke' })

export class Sandbox {
  private ctx: vm.Context
  private hooks: Set<string>
  logs: string[] = []

  constructor(source: string, opts: SandboxOpts = {}) {
    const onLog = opts.onLog ?? (() => {})
    const sandbox: Record<string, unknown> = {
      // Chỉ những gì gameplay 2D thật cần. Không fs, không net, không process,
      // không require, không setTimeout (nhịp là việc của scheduler).
      Math, JSON, Number, String, Boolean, Array, Object, Date: Object.freeze({ now: Date.now }),
      isNaN, isFinite, parseInt, parseFloat, structuredClone,
      console: { log: onLog, warn: onLog, error: onLog },
      module: { exports: {} as Record<string, unknown> },
      exports: {} as Record<string, unknown>,
    }
    sandbox['globalThis'] = sandbox
    this.ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })

    // Room module ở M1 dùng CommonJS (`module.exports = {...}`). ESM trong vm cần
    // cờ --experimental-vm-modules; sẽ có khi chuyển sang isolated-vm ở M2.
    try {
      new vm.Script(source, { filename: opts.filename ?? 'room.js' })
        .runInContext(this.ctx, { timeout: opts.loadTimeoutMs ?? 1000 })
    } catch (e) {
      throw new SandboxError('load', e)
    }

    const mod = (this.ctx as { module: { exports: Record<string, unknown> } }).module.exports
    const resolved = (mod && typeof mod === 'object' && 'default' in mod ? mod['default'] : mod) as Record<string, unknown>
    if (!resolved || typeof resolved !== 'object') {
      throw new SandboxError('load', 'module.exports phải là object chứa các hook')
    }
    ;(this.ctx as Record<string, unknown>)['__arcade_mod'] = resolved

    // API mà room module gọi. Định nghĩa NGAY TRONG context: mọi phương thức chỉ
    // đẩy lệnh vào room._out (mảng thuần) — không có hàm nào của host đi vào vm.
    // Host đọc _out sau khi hook trả về và thực thi tuần tự.
    new vm.Script(`
      globalThis.__arcade_wrap = function (room) {
        if (room.__wrapped) return room
        room.__wrapped = true
        room.broadcast = function (n, d) { room._out.push(['bc', n, d]) }
        room.send      = function (id, n, d) { room._out.push(['snd', id, n, d]) }
        room.lock      = function () { room._out.push(['lock', true]) }
        room.unlock    = function () { room._out.push(['lock', false]) }
        room.dispose   = function () { room._out.push(['dispose']) }
        room.log       = function () { room._out.push(['log', Array.prototype.join.call(arguments, ' ')]) }
        room.save      = function (k, v) { room._out.push(['save', k, v]) }
        room.leaderboard = function (board) {
          return { submit: function (pid, score) { room._out.push(['score', board, pid, score]) } }
        }
        return room
      }
      globalThis.__arcade_invoke = function (h, a, b, c, d) {
        var f = __arcade_mod[h]
        if (!f) return undefined
        return f(a && a._out ? __arcade_wrap(a) : a, b, c, d)
      }
    `, { filename: 'arcade:bootstrap' }).runInContext(this.ctx)

    this.hooks = new Set(Object.keys(resolved).filter((k) => typeof resolved[k] === 'function'))
  }

  has(hook: keyof RoomModule): boolean { return this.hooks.has(hook) }

  get config(): { tickRate?: number; maxPlayers?: number } {
    const m = (this.ctx as Record<string, unknown>)['__arcade_mod'] as Record<string, unknown>
    const c = m['config']
    return (c && typeof c === 'object' ? c : {}) as { tickRate?: number; maxPlayers?: number }
  }

  /**
   * Gọi một hook với ngân sách thời gian. Vượt ngân sách -> V8 kết thúc script
   * và ném ra ngoài; RoomHost quyết định dispose phòng.
   */
  call<T = unknown>(hook: keyof RoomModule, timeoutMs: number, a?: unknown, b?: unknown, c?: unknown, d?: unknown): T {
    if (!this.hooks.has(hook)) return undefined as T
    const g = this.ctx as Record<string, unknown>
    g['__h'] = hook; g['__a'] = a; g['__b'] = b; g['__c'] = c; g['__d'] = d
    try {
      return INVOKE.runInContext(this.ctx, { timeout: timeoutMs }) as T
    } catch (e) {
      throw new SandboxError(hook as string, e)
    } finally {
      // Bỏ tham chiếu để hook trước không giữ object sống qua tick sau.
      g['__a'] = g['__b'] = g['__c'] = g['__d'] = undefined
    }
  }

  static fromFile(path: string, opts: SandboxOpts = {}): Sandbox {
    return new Sandbox(readFileSync(path, 'utf8'), { ...opts, filename: path })
  }
}
