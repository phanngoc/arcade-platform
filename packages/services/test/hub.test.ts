import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../../app/src/server.ts'
import { sql } from '@arcade/core'
import { HUB_GAME_ID } from '../src/hub/index.ts'

// Forge ghi file thật -> chạy trên thư mục tạm, không đụng games/ của máy.
let app: Awaited<ReturnType<typeof build>>
let dir: string
const created: string[] = []

async function hubToken() {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { gameId: HUB_GAME_ID } })
  return { authorization: `Bearer ${(r.json() as { accessToken: string }).accessToken}` }
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'arcade-forge-'))
  await sql`insert into games (id, name, manifest) values (${HUB_GAME_ID}, 'Arcade Hub',
    ${sql.json({ game: { client_dir: '.' }, runtime: { mode: 'offline' } })}) on conflict (id) do nothing`
  // Một game khác để thử token sai audience.
  await sql`insert into games (id, name, manifest) values ('test-hub-other', 'Other',
    ${sql.json({ runtime: { mode: 'offline' }, capabilities: { leaderboard: ['alltime'] } })}) on conflict (id) do nothing`
  app = await build({ gamesDir: dir, realtime: false })
})

after(async () => {
  if (created.length) await sql`delete from games where id in ${sql(created)}`
  await sql`delete from games where id = 'test-hub-other'`
  await app.close()
  await rm(dir, { recursive: true, force: true })
})

test('danh mục công khai: không cần token, không lộ hub và owner', async () => {
  const r = await app.inject({ method: 'GET', url: '/v1/games' })
  assert.equal(r.statusCode, 200)
  const b = r.json() as { games: { id: string; playUrl: string }[] }
  assert.ok(Array.isArray(b.games))
  assert.equal(b.games.some((g) => g.id === HUB_GAME_ID), false)
  assert.equal(JSON.stringify(b).includes('owner_id'), false)
})

test('template list công khai', async () => {
  const r = await app.inject({ method: 'GET', url: '/v1/forge/templates' })
  assert.equal(r.statusCode, 200)
  assert.equal((r.json() as { templates: unknown[] }).templates.length >= 2, true)
})

test('tạo game phải có token', async () => {
  const r = await app.inject({ method: 'POST', url: '/v1/forge/games', payload: { title: 'Khong Token' } })
  assert.equal(r.statusCode, 401)
})

test('token của game khác không tạo được game', async () => {
  const g = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { gameId: 'test-hub-other' } })
  const h = { authorization: `Bearer ${(g.json() as { accessToken: string }).accessToken}` }
  const r = await app.inject({ method: 'POST', url: '/v1/forge/games', headers: h, payload: { title: 'Sai Audience' } })
  assert.equal(r.statusCode, 403)
  assert.equal((r.json() as { error: string }).error, 'FORGE_WRONG_AUDIENCE')
})

test('tên game bị kiểm: rỗng và ký tự lạ đều 400', async () => {
  const h = await hubToken()
  for (const title of ['a', '<script>alert(1)</script>', 'x'.repeat(40)]) {
    const r = await app.inject({ method: 'POST', url: '/v1/forge/games', headers: h, payload: { title } })
    assert.equal(r.statusCode, 400, `title=${title}`)
  }
})

test('tạo game: job -> ready, file phục vụ được, id sạch', async () => {
  const h = await hubToken()
  const r = await app.inject({ method: 'POST', url: '/v1/forge/games', headers: h,
    payload: { title: 'Sao Băng Test', template: 'collect', hue: 200, speed: 4, density: 2 } })
  assert.equal(r.statusCode, 202)
  const { jobId, gameId } = r.json() as { jobId: string; gameId: string }
  created.push(gameId)
  assert.match(gameId, /^u-[a-z0-9-]+$/)

  let status = 'building'
  for (let i = 0; i < 40 && status !== 'ready'; i++) {
    await new Promise((res) => setTimeout(res, 50))
    const j = await app.inject({ method: 'GET', url: `/v1/forge/jobs/${jobId}`, headers: h })
    status = (j.json() as { status: string }).status
  }
  assert.equal(status, 'ready')

  // File thật nằm trong thư mục tạm và phục vụ được qua bundle server.
  const html = await readFile(join(dir, gameId, 'index.html'), 'utf8')
  assert.equal(html.includes('<canvas'), true)
  assert.equal(html.includes('Sao Băng Test'), true)
  const page = await app.inject({ method: 'GET', url: `/g/${gameId}/` })
  assert.equal(page.statusCode, 200)

  // Manifest phải là object thật (không phải chuỗi JSON) — nếu không
  // leaderboard trả BOARD_NOT_DECLARED.
  const [row] = await sql<{ m: { capabilities?: { leaderboard?: string[] } } }[]>`
    select manifest as m from games where id = ${gameId}`
  assert.deepEqual(row!.m.capabilities?.leaderboard, ['alltime'])

  // Điểm nộp được bằng token của chính game vừa tạo.
  const pg = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { gameId } })
  const ph = { authorization: `Bearer ${(pg.json() as { accessToken: string }).accessToken}` }
  const sc = await app.inject({ method: 'POST', url: '/v1/leaderboard/alltime', headers: ph, payload: { score: 7 } })
  assert.equal(sc.statusCode, 200)
})

test('cooldown chặn tạo dồn dập', async () => {
  const h = await hubToken()
  const a = await app.inject({ method: 'POST', url: '/v1/forge/games', headers: h, payload: { title: 'Lien Tiep Mot' } })
  assert.equal(a.statusCode, 202)
  created.push((a.json() as { gameId: string }).gameId)
  const b = await app.inject({ method: 'POST', url: '/v1/forge/games', headers: h, payload: { title: 'Lien Tiep Hai' } })
  assert.equal(b.statusCode, 409)
  assert.equal((b.json() as { error: string }).error, 'FORGE_COOLDOWN')
})

test('job của người khác trả 404', async () => {
  const h = await hubToken()
  const r = await app.inject({ method: 'POST', url: '/v1/forge/games', headers: h, payload: { title: 'Rieng Tu' } })
  created.push((r.json() as { gameId: string }).gameId)
  const other = await hubToken()
  const j = await app.inject({ method: 'GET', url: `/v1/forge/jobs/${(r.json() as { jobId: string }).jobId}`, headers: other })
  assert.equal(j.statusCode, 404)
})

test('metrics không lộ ra ngoài tunnel', async () => {
  const r = await app.inject({ method: 'GET', url: '/metrics', headers: { 'cf-connecting-ip': '1.2.3.4' } })
  assert.equal(r.statusCode, 404)
})
