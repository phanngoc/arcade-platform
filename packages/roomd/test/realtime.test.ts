import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { build } from '../../app/src/server.ts'
import { sql, redis, resolveRoom, mintAccess } from '@arcade/core'
import { apply, checksum, PROTOCOL_VERSION, type S2C } from '@arcade/protocol'

// ─────────────────────────────────────────────────────────────────────────────
// G4 — cổng multiplayer. Client headless thật, WebSocket thật, Postgres + Redis
// thật. Đây là cổng quyết định M1 đỗ hay trượt.
// ─────────────────────────────────────────────────────────────────────────────

const PORT = 8097
const FIXTURES = 'packages/roomd/test/fixtures'
const MP = 'test-mp'
const VIEW = 'test-view'
let app: Awaited<ReturnType<typeof build>>

/** Client tối giản: giữ state bằng cách áp patch — đúng như SDK thật làm. */
class TestClient {
  ws: WebSocket
  state: unknown = undefined
  seq = 0
  serverChecksum = 0
  events: { n: string; d?: unknown }[] = []
  welcome: Extract<S2C, { t: 'welcome' }> | null = null
  errors: string[] = []
  left: { p: string; r: string }[] = []
  private waiters: { pred: () => boolean; resolve: () => void }[] = []
  private token: string

  constructor(token: string) {
    this.token = token
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
    this.ws.on('message', (raw) => this.onMessage(JSON.parse(String(raw)) as S2C))
    this.ws.on('error', () => { /* test tự đóng */ })
  }

  private onMessage(m: S2C) {
    switch (m.t) {
      case 'welcome': this.welcome = m; break
      case 'snap':    this.state = m.s; this.seq = m.seq; this.serverChecksum = m.c; break
      case 'patch':   this.state = apply(this.state, m.ops); this.seq = m.seq; this.serverChecksum = m.c; break
      case 'ev':      this.events.push({ n: m.n, d: m.d }); break
      case 'left':    this.left.push({ p: m.p, r: m.r }); break
      case 'ping':    this.send({ t: 'pong', id: m.id }); break
      case 'err':     this.errors.push(m.code); break
    }
    for (const w of [...this.waiters]) {
      if (w.pred()) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve() }
    }
  }

  send(m: unknown) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)) }

  async hello(): Promise<this> {
    if (this.ws.readyState !== 1) {
      await new Promise<void>((r, j) => { this.ws.once('open', () => r()); this.ws.once('error', j) })
    }
    this.send({ t: 'hello', token: this.token, v: PROTOCOL_VERSION })
    return this
  }

  waitFor(pred: () => boolean, what = 'điều kiện', ms = 5000): Promise<void> {
    if (pred()) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error(`hết ${ms}ms chờ ${what}`)), ms)
      this.waiters.push({ pred, resolve: () => { clearTimeout(to); resolve() } })
    })
  }
  close() { this.ws.close() }
}

const open: TestClient[] = []
async function client(gameId = MP, playerId?: string): Promise<TestClient> {
  let token: string
  if (playerId) token = await mintAccess(playerId, gameId, true)
  else {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { gameId } })
    if (r.statusCode !== 200) throw new Error(`guest auth ${r.statusCode}: ${r.body}`)
    token = (r.json() as { accessToken: string }).accessToken
  }
  const c = new TestClient(token)
  open.push(c)
  return c.hello()
}

/** Tạo phòng và chờ welcome — dùng ở hầu hết test. */
async function host(gameId = MP, opts?: unknown): Promise<TestClient> {
  const a = await client(gameId)
  a.send({ t: 'create', mode: 'coop', name: 'A', opts })
  await a.waitFor(() => !!a.welcome, 'welcome của host')
  return a
}

before(async () => {
  for (const [id, tick, max] of [[MP, 20, 2], [VIEW, 20, 3]] as const) {
    await sql`insert into games (id, name, manifest) values (${id}, ${id}, ${sql.json({
      runtime: { mode: 'authoritative', tick_rate: tick, max_players: max, reconnect_window_sec: 5, idle_timeout_sec: 2 },
      capabilities: { leaderboard: ['daily'] },
    })}) on conflict (id) do update set manifest = excluded.manifest`
    await sql`delete from leaderboard_entries where game_id = ${id}`
    await redis.del(`lb:{${id}}:daily`, `lbm:{${id}}:daily`, `lbd:{${id}}`, `lbh:{${id}}:daily`)
  }
  app = await build({ gamesDir: FIXTURES, publicBaseUrl: `http://127.0.0.1:${PORT}` })
  await app.listen({ port: PORT, host: '127.0.0.1' })
})

after(async () => {
  for (const c of open) c.close()
  await sql`delete from leaderboard_entries where game_id in (${MP}, ${VIEW})`
  await sql`delete from games where id in (${MP}, ${VIEW})`
  await app.close()
})

test('G4: hai client vào cùng phòng, state HỘI TỤ với checksum của server', async () => {
  const a = await host(MP, { stage: 3 })
  const code = a.welcome!.code
  assert.match(code, /^[ACDEFGHJKMNPQRTUVWXY34679]{4}$/, 'mã phòng không chứa ký tự dễ nhầm')
  assert.ok(a.welcome!.url.includes(`room=${code}`), 'welcome phải kèm link mời')

  const b = await client()
  b.send({ t: 'join', code, name: 'B' })
  await b.waitFor(() => !!b.welcome, 'welcome của B')

  await a.waitFor(() => ((a.state as { n?: number })?.n ?? 0) > 3, 'A nhận tick')
  await b.waitFor(() => ((b.state as { n?: number })?.n ?? 0) > 3, 'B nhận tick')
  await a.waitFor(() => checksum(a.state) === a.serverChecksum, 'A khớp checksum server')
  await b.waitFor(() => checksum(b.state) === b.serverChecksum, 'B khớp checksum server')

  const sa = a.state as { phase: string; stage: number; hits: Record<string, number> }
  assert.equal(sa.phase, 'play')
  assert.equal(sa.stage, 3, 'opts phải tới được onCreate')
  assert.equal(Object.keys(sa.hits).length, 2, 'cả hai người chơi có trong state')
})

test('G4: input của một người hiện ra trong state của cả hai', async () => {
  const a = await host()
  const b = await client()
  b.send({ t: 'join', code: a.welcome!.code }); await b.waitFor(() => !!b.welcome, 'B vào phòng')

  const aid = a.welcome!.playerId
  for (let i = 0; i < 5; i++) a.send({ t: 'msg', n: 'bump' })
  await b.waitFor(() => ((b.state as { hits: Record<string, number> }).hits[aid] ?? 0) >= 5, 'B thấy input của A')
  assert.equal((b.state as { hits: Record<string, number> }).hits[aid], 5)
})

test('G4: broadcast của room module tới mọi người', async () => {
  const a = await host()
  const b = await client()
  b.send({ t: 'join', code: a.welcome!.code }); await b.waitFor(() => !!b.welcome, 'B vào phòng')
  a.send({ t: 'msg', n: 'shout' })
  await b.waitFor(() => b.events.some((e) => e.n === 'shouted'), 'B nhận broadcast')
})

test('G4: reconnect trong cửa sổ -> state giữ nguyên', async () => {
  const a = await host()
  const { code, session, playerId } = a.welcome!
  for (let i = 0; i < 3; i++) a.send({ t: 'msg', n: 'bump' })
  await a.waitFor(() => ((a.state as { hits: Record<string, number> }).hits[playerId] ?? 0) >= 3, 'A đếm tới 3')

  a.ws.terminate()                                  // ngắt thô, không close sạch
  await new Promise((r) => setTimeout(r, 300))

  const again = await client(MP, playerId)          // đúng người chơi cũ
  again.send({ t: 'rejoin', session })
  await again.waitFor(() => !!again.welcome, 'welcome sau rejoin')
  assert.equal(again.welcome!.code, code)
  await again.waitFor(
    () => ((again.state as { hits?: Record<string, number> })?.hits?.[playerId] ?? -1) === 3,
    'state giữ nguyên sau reconnect')
})

test('G4: view() giấu thông tin — mỗi người chỉ thấy phần của mình', async () => {
  const a = await host(VIEW)
  const b = await client(VIEW)
  b.send({ t: 'join', code: a.welcome!.code }); await b.waitFor(() => !!b.welcome, 'B vào phòng')

  await a.waitFor(() => ((a.state as { pot?: number })?.pot ?? 0) > 2, 'A nhận tick')
  await b.waitFor(() => ((b.state as { pot?: number })?.pot ?? 0) > 2, 'B nhận tick')

  const ha = Object.keys((a.state as { hands: Record<string, unknown> }).hands)
  const hb = Object.keys((b.state as { hands: Record<string, unknown> }).hands)
  assert.deepEqual(ha, [a.welcome!.playerId], 'A chỉ thấy tay của A')
  assert.deepEqual(hb, [b.welcome!.playerId], 'B chỉ thấy tay của B')
  assert.equal(checksum(a.state), a.serverChecksum, 'checksum phải tính trên view của A')
})

test('G4: phòng không tồn tại -> ROOM_NOT_FOUND', async () => {
  const a = await client()
  a.send({ t: 'join', code: 'QQQQ' })
  await a.waitFor(() => a.errors.length > 0, 'lỗi trả về')
  assert.equal(a.errors[0], 'ROOM_NOT_FOUND')
})

test('G4: phòng đầy -> người thứ ba bị từ chối ROOM_FULL', async () => {
  const a = await host()
  const code = a.welcome!.code
  const b = await client(); b.send({ t: 'join', code }); await b.waitFor(() => !!b.welcome, 'B vào phòng')
  const c = await client(); c.send({ t: 'join', code })
  await c.waitFor(() => c.errors.length > 0, 'lỗi trả về')
  assert.equal(c.errors[0], 'ROOM_FULL')
})

test('rate limit: gửi vượt msg_per_sec thì bị DROP, không bị ngắt kết nối', async () => {
  const a = await host()
  for (let i = 0; i < 200; i++) a.send({ t: 'msg', n: 'bump' })
  await a.waitFor(() => a.errors.includes('RATE_LIMITED'), 'cảnh báo rate limit')
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(a.ws.readyState, 1, 'kết nối phải còn sống — không đá oan người lag')
})

test('watchdog: onMessage lặp vô hạn bị giết, host sống, phòng bị thu hồi', async () => {
  const a = await host()
  a.send({ t: 'msg', n: 'boom' })
  await a.waitFor(() => a.errors.includes('MODULE_ERROR'), 'lỗi MODULE_ERROR')
  const health = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(health.statusCode, 200, 'server phải còn sống sau khi module treo')
})

test('registry: mã phòng resolve được qua REST, chuẩn hoá chữ thường', async () => {
  const a = await host()
  const code = a.welcome!.code
  assert.ok(await resolveRoom(MP, code), 'phòng phải nằm trong registry Redis')

  const tok = await mintAccess(a.welcome!.playerId, MP, true)
  const r = await app.inject({
    method: 'POST', url: '/v1/rooms/join',
    headers: { authorization: `Bearer ${tok}` }, payload: { code: code.toLowerCase() },
  })
  assert.equal(r.statusCode, 200)
  const body = r.json() as { code: string; wsUrl: string }
  assert.equal(body.code, code)
  assert.ok(body.wsUrl.endsWith('/ws'))
})

test('điểm do room server nộp được đánh dấu verified', async () => {
  const a = await host()
  a.send({ t: 'msg', n: 'score', d: { score: 555 } })
  await new Promise((r) => setTimeout(r, 400))
  const tok = await mintAccess(a.welcome!.playerId, MP, true)
  const top = await app.inject({
    method: 'GET', url: '/v1/leaderboard/daily?n=5', headers: { authorization: `Bearer ${tok}` },
  })
  const mine = (top.json() as { entries: { score: number; verified: boolean }[] }).entries.find((e) => e.score === 555)
  assert.ok(mine, 'điểm phải lên bảng')
  assert.equal(mine.verified, true, 'điểm qua room server phải verified')
})

test('/metrics phơi số đo phòng và tick', async () => {
  const r = await app.inject({ method: 'GET', url: '/metrics' })
  assert.equal(r.statusCode, 200)
  for (const k of ['arcade_rooms_open', 'arcade_tick_ms', 'arcade_patch_bytes_total']) {
    assert.ok(r.body.includes(k), `thiếu số đo ${k}`)
  }
})
