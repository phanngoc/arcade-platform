/**
 * @arcade/client — SDK trình duyệt, KHÔNG dependency.
 *
 * Ràng buộc cứng: phải chạy được bằng <script src>, không cần npm/bundler.
 * 3 game tham chiếu đều không có build step; SDK bắt buộc bundler thì chính
 * bộ test đầu tiên không dùng được nó. Ngân sách: ≤12KB gzip.
 */

import { Room, type RoomInfo } from './room.ts'
export { Room, type RoomInfo } from './room.ts'

export type InitOpts = { gameId: string; baseUrl?: string; storage?: Storage | null }
export type Me = { playerId: string; isGuest: boolean }
export type SaveDoc<T = unknown> = { data: T | null; version: number }
export type Entry = { playerId: string; score: number; name: string | null; verified: boolean; rank: number }

class ArcadeError extends Error {
  code: string
  status: number
  constructor(status: number, code: string, message?: string) {
    super(message ?? code)
    this.code = code
    this.status = status
  }
}

function defaultBase(): string {
  if (typeof location === 'undefined') return 'http://127.0.0.1:8090'
  // Game chạy ở /g/<id>/... trên cùng origin với API -> lấy luôn origin đó.
  return location.origin
}

class Client {
  gameId: string
  baseUrl: string
  private store: Storage | null
  private access: string | null = null
  private refresh: string | null = null
  private me: Me | null = null
  private refreshing: Promise<void> | null = null
  private queue: { name: string; props?: Record<string, unknown> }[] = []

  constructor(o: InitOpts) {
    this.gameId = o.gameId
    this.baseUrl = (o.baseUrl ?? defaultBase()).replace(/\/$/, '')
    this.store = o.storage === undefined ? safeLocalStorage() : o.storage
    const raw = this.store?.getItem(this.skey())
    if (raw) {
      try {
        const s = JSON.parse(raw) as { a: string; r: string; p: string; g: boolean }
        this.access = s.a; this.refresh = s.r; this.me = { playerId: s.p, isGuest: s.g }
      } catch { /* bỏ qua phiên hỏng */ }
    }
    if (typeof setInterval !== 'undefined') {
      const t = setInterval(() => void this.flushEvents(), 5000)
      ;(t as unknown as { unref?: () => void }).unref?.()
    }
  }

  private skey() { return 'arcade:' + this.gameId }
  private persist() {
    if (!this.store || !this.access || !this.refresh || !this.me) return
    try {
      this.store.setItem(this.skey(), JSON.stringify({
        a: this.access, r: this.refresh, p: this.me.playerId, g: this.me.isGuest,
      }))
    } catch { /* private mode: chấp nhận không nhớ phiên */ }
  }

  private async req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, retry = true): Promise<{ body: T; headers: Headers }> {
    const h: Record<string, string> = { ...headers }
    if (body !== undefined) h['content-type'] = 'application/json'
    if (this.access) h['authorization'] = 'Bearer ' + this.access

    const res = await fetch(this.baseUrl + path, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (res.status === 401 && retry && this.refresh) {
      await this.doRefresh()
      return this.req<T>(method, path, body, headers, false)
    }
    const text = await res.text()
    const parsed = text ? JSON.parse(text) : null
    if (!res.ok) {
      const e = parsed as { error?: string; message?: string } | null
      throw new ArcadeError(res.status, e?.error ?? 'HTTP_' + res.status, e?.message)
    }
    return { body: parsed as T, headers: res.headers }
  }

  private doRefresh(): Promise<void> {
    // Gộp nhiều request 401 cùng lúc vào một lần refresh.
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      try {
        const r = await fetch(this.baseUrl + '/v1/auth/refresh', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refresh }),
        })
        if (!r.ok) { this.clear(); throw new ArcadeError(401, 'SESSION_EXPIRED') }
        const j = await r.json() as { accessToken: string }
        this.access = j.accessToken
        this.persist()
      } finally { this.refreshing = null }
    })()
    return this.refreshing
  }

  private clear() {
    this.access = this.refresh = null; this.me = null
    try { this.store?.removeItem(this.skey()) } catch { /* ignore */ }
  }

  auth = {
    /** Guest-first: gọi được nhiều lần, lần sau dùng lại phiên đã lưu. */
    guest: async (): Promise<Me> => {
      if (this.me && this.access) return this.me
      const { body } = await this.req<{ playerId: string; isGuest: boolean; accessToken: string; refreshToken: string }>(
        'POST', '/v1/auth/guest', { gameId: this.gameId })
      this.access = body.accessToken; this.refresh = body.refreshToken
      this.me = { playerId: body.playerId, isGuest: body.isGuest }
      this.persist()
      return this.me
    },
    link: async (email: string): Promise<Me> => {
      const { body } = await this.req<{ playerId: string; isGuest: boolean; accessToken: string }>(
        'POST', '/v1/auth/link', { email })
      this.access = body.accessToken
      this.me = { playerId: body.playerId, isGuest: body.isGuest }
      this.persist()
      return this.me
    },
    get current(): Me | null { return null },
  }

  get playerId(): string | null { return this.me?.playerId ?? null }

  save = {
    get: async <T = unknown>(): Promise<SaveDoc<T>> => {
      const { body } = await this.req<SaveDoc<T>>('GET', '/v1/save')
      return body
    },
    /** version: truyền vào để tránh ghi đè bản mới hơn (nhiều tab). Ném VERSION_MISMATCH nếu lệch. */
    set: async <T>(data: T, version?: number): Promise<number> => {
      const h: Record<string, string> = version === undefined ? {} : { 'if-match': String(version) }
      const { body } = await this.req<{ version: number }>('PUT', '/v1/save', { data }, h)
      return body.version
    },
  }

  leaderboard(board: string) {
    return {
      submit: async (score: number, name?: string): Promise<{ score: number; rank: number; verified: boolean }> => {
        const { body } = await this.req<{ score: number; rank: number; verified: boolean }>(
          'POST', '/v1/leaderboard/' + encodeURIComponent(board), { score, name })
        return body
      },
      top: async (n = 20): Promise<Entry[]> => {
        const { body } = await this.req<{ entries: Entry[] }>('GET', `/v1/leaderboard/${encodeURIComponent(board)}?n=${n}`)
        return body.entries
      },
      around: async (n = 5): Promise<Entry[]> => {
        const { body } = await this.req<{ entries: Entry[] }>('GET', `/v1/leaderboard/${encodeURIComponent(board)}?around=me&n=${n}`)
        return body.entries
      },
    }
  }

  /** Realtime. Chỉ dùng được với game khai báo mode authoritative/relay. */
  rooms = {
    create: async (mode = 'default', opts?: unknown, name?: string): Promise<Room> => {
      const r = new Room({ wsUrl: await this.pickNode(), token: this.access!, name }, { kind: 'create', mode, opts })
      await r.connect()
      return r
    },
    join: async (code: string, name?: string): Promise<Room> => {
      // Hỏi API node nào đang giữ phòng rồi nối THẲNG tới node đó.
      const { body } = await this.req<{ wsUrl: string }>('POST', '/v1/rooms/join', { code })
      const r = new Room({ wsUrl: body.wsUrl, token: this.access!, name }, { kind: 'join', code })
      await r.connect()
      return r
    },
    /** Mã phòng trong URL (?room=XXXX) — đường vào từ link mời. */
    codeFromUrl: (): string | null => {
      if (typeof location === 'undefined') return null
      return new URLSearchParams(location.search).get('room')
    },
  }

  private async pickNode(): Promise<string> {
    const { body } = await this.req<{ wsUrl: string }>('POST', '/v1/rooms/pick')
    return body.wsUrl
  }

  /** Gộp lô, gửi mỗi 5s. Không await — telemetry không được làm chậm game. */
  track(name: string, props?: Record<string, unknown>): void {
    this.queue.push({ name, props })
    if (this.queue.length >= 50) void this.flushEvents()
  }

  async flushEvents(): Promise<void> {
    if (!this.queue.length || !this.access) return
    const events = this.queue.splice(0, 50)
    try { await this.req('POST', '/v1/events', { events }) } catch { /* rơi lô này, không ném ra game */ }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    localStorage.setItem('__arcade_probe', '1'); localStorage.removeItem('__arcade_probe')
    return localStorage
  } catch { return null }   // private mode / site data bị chặn
}

export const Arcade = {
  /** Khởi tạo + đăng nhập guest trong một bước — đây là 99% cách dùng thật. */
  async init(opts: InitOpts): Promise<Client> {
    const c = new Client(opts)
    await c.auth.guest()
    return c
  },
  /** Tạo client chưa đăng nhập, khi game muốn tự quyết thời điểm. */
  create(opts: InitOpts): Client { return new Client(opts) },
}

export type ArcadeClient = Client
export default Arcade
