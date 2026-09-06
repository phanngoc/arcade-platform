import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from '../../app/src/server.ts'
import { sql, redis, key } from '@arcade/core'
import { flushAll } from '../src/leaderboard/index.ts'

// Không mock Postgres: RLS chính là thứ cần test, và mock cho cảm giác an toàn giả.
let app: Awaited<ReturnType<typeof build>>
const GAME = 'test-game'

async function guest(gameId = GAME) {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { gameId } })
  const b = r.json() as { accessToken: string; playerId: string }
  return { tok: b.accessToken, id: b.playerId, h: { authorization: `Bearer ${b.accessToken}` } }
}

/** Xoá sạch một bảng ở cả Redis lẫn Postgres. Không có nó thì các test
 *  leaderboard nhìn thấy điểm của nhau và thứ hạng sai một cách khó hiểu. */
async function resetBoard(board = 'daily') {
  await sql`delete from leaderboard_entries where game_id = ${GAME} and board = ${board}`
  await redis.del(key.board(GAME, board), key.boardMeta(GAME, board),
                  key.boardDirty(GAME), key.boardHydrated(GAME, board))
}

before(async () => {
  await sql`insert into games (id, name, manifest) values (
    ${GAME}, 'Test',
    ${sql.json({ runtime: { mode: 'offline' }, capabilities: { save: true, leaderboard: ['daily'] } })}
  ) on conflict (id) do nothing`
  await sql`insert into games (id, name, manifest) values (
    'test-auth', 'TestAuthoritative',
    ${sql.json({ runtime: { mode: 'authoritative' }, capabilities: { leaderboard: ['daily'] } })}
  ) on conflict (id) do nothing`
  app = await build({ gamesDir: '.' })
  await resetBoard()
})

after(async () => {
  await sql`delete from leaderboard_entries where game_id in (${GAME}, 'test-auth')`
  await sql`delete from saves where game_id = ${GAME}`
  await sql`delete from games where id in (${GAME}, 'test-auth')`
  await app.close()
})

test('guest auth cấp token cho game có thật', async () => {
  const a = await guest()
  assert.match(a.id, /^[0-9a-f-]{36}$/)
  assert.ok(a.tok.length > 40)
})

test('guest auth từ chối game không tồn tại', async () => {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { gameId: 'khong-co' } })
  assert.equal(r.statusCode, 404)
})

test('save: ghi rồi đọc lại đúng, version tăng dần', async () => {
  const a = await guest()
  assert.equal((await app.inject({ method: 'PUT', url: '/v1/save', headers: a.h, payload: { data: { lv: 1 } } })).json().version, 1)
  assert.equal((await app.inject({ method: 'PUT', url: '/v1/save', headers: a.h, payload: { data: { lv: 2 } } })).json().version, 2)
  const g = await app.inject({ method: 'GET', url: '/v1/save', headers: a.h })
  assert.deepEqual(g.json(), { data: { lv: 2 }, version: 2 })
})

test('save: If-Match cũ bị từ chối 409 (hai tab ghi đè nhau)', async () => {
  const a = await guest()
  await app.inject({ method: 'PUT', url: '/v1/save', headers: a.h, payload: { data: { x: 1 } } })
  const stale = await app.inject({ method: 'PUT', url: '/v1/save', headers: { ...a.h, 'if-match': '0' }, payload: { data: { x: 2 } } })
  assert.equal(stale.statusCode, 409)
  assert.equal(stale.json().error, 'VERSION_MISMATCH')
  const ok = await app.inject({ method: 'PUT', url: '/v1/save', headers: { ...a.h, 'if-match': '1' }, payload: { data: { x: 2 } } })
  assert.equal(ok.statusCode, 200)
})

test('save: RLS — người chơi không đọc được save của người khác', async () => {
  const a = await guest(), b = await guest()
  await app.inject({ method: 'PUT', url: '/v1/save', headers: a.h, payload: { data: { secret: 'cua-A' } } })
  assert.deepEqual((await app.inject({ method: 'GET', url: '/v1/save', headers: b.h })).json(), { data: null, version: 0 })
})

test('save: quá 64KB bị từ chối', async () => {
  const a = await guest()
  const r = await app.inject({ method: 'PUT', url: '/v1/save', headers: a.h, payload: { data: { blob: 'x'.repeat(70000) } } })
  assert.equal(r.statusCode, 400)
  assert.equal(r.json().error, 'SAVE_TOO_LARGE')
})

test('không có token thì 401', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/v1/save' })).statusCode, 401)
})

test('leaderboard: giữ điểm cao nhất, không ghi đè bằng điểm thấp hơn', async () => {
  await resetBoard()
  const a = await guest()
  await app.inject({ method: 'POST', url: '/v1/leaderboard/daily', headers: a.h, payload: { score: 1000, name: 'A' } })
  const low = await app.inject({ method: 'POST', url: '/v1/leaderboard/daily', headers: a.h, payload: { score: 400, name: 'A' } })
  assert.equal(low.json().score, 1000)
})

test('leaderboard: xếp hạng và around', async () => {
  await resetBoard()
  const [a, b, c] = [await guest(), await guest(), await guest()]
  await app.inject({ method: 'POST', url: '/v1/leaderboard/daily', headers: a.h, payload: { score: 10, name: 'A' } })
  await app.inject({ method: 'POST', url: '/v1/leaderboard/daily', headers: b.h, payload: { score: 30, name: 'B' } })
  await app.inject({ method: 'POST', url: '/v1/leaderboard/daily', headers: c.h, payload: { score: 20, name: 'C' } })
  const top = (await app.inject({ method: 'GET', url: '/v1/leaderboard/daily?n=3', headers: a.h })).json().entries
  assert.deepEqual(top.map((e: { name: string }) => e.name), ['B', 'C', 'A'])
  assert.deepEqual(top.map((e: { rank: number }) => e.rank), [1, 2, 3])
  const around = (await app.inject({ method: 'GET', url: '/v1/leaderboard/daily?around=me&n=1', headers: c.h })).json().entries
  assert.ok(around.some((e: { name: string }) => e.name === 'C'))
})

test('leaderboard: bảng chưa khai báo trong manifest bị từ chối', async () => {
  const a = await guest()
  const r = await app.inject({ method: 'POST', url: '/v1/leaderboard/weekly', headers: a.h, payload: { score: 1 } })
  assert.equal(r.json().error, 'BOARD_NOT_DECLARED')
})

test('leaderboard: mode authoritative thì client không được nộp điểm', async () => {
  const a = await guest('test-auth')
  const r = await app.inject({ method: 'POST', url: '/v1/leaderboard/daily', headers: a.h, payload: { score: 999 } })
  assert.equal(r.statusCode, 403)
  assert.equal(r.json().error, 'CLIENT_SUBMIT_FORBIDDEN')
})

test('write-behind: điểm xuống được Postgres, và nạp lại được sau khi mất Redis', async () => {
  await resetBoard()
  const a = await guest()
  await app.inject({ method: 'POST', url: '/v1/leaderboard/daily', headers: a.h, payload: { score: 777, name: 'Flush' } })
  await flushAll()
  const [row] = await sql<{ score: string; meta: { name?: string } | null }[]>`
    select score, meta from leaderboard_entries where game_id = ${GAME} and player_id = ${a.id}`
  assert.equal(Number(row!.score), 777)
  assert.equal(row!.meta?.name, 'Flush', 'tên phải nằm ở Postgres, không chỉ ở Redis')

  // Mô phỏng Redis chết: xoá sạch key của game này rồi đọc lại.
  await redis.del(key.board(GAME, 'daily'), key.boardMeta(GAME, 'daily'), key.boardHydrated(GAME, 'daily'))
  const top = (await app.inject({ method: 'GET', url: '/v1/leaderboard/daily?n=10', headers: a.h })).json().entries
  const mine = top.find((e: { playerId: string }) => e.playerId === a.id)
  assert.equal(mine.score, 777)
  assert.equal(mine.name, 'Flush')
})

test('bundle: chặn path traversal đã mã hoá', async () => {
  for (const u of ['/g/castle/%2e%2e/%2e%2e/.env', '/g/castle/..%2f..%2f.env']) {
    const r = await app.inject({ method: 'GET', url: u })
    assert.equal(r.statusCode, 404, u)
  }
})

test('đường không tồn tại trả 404, không phải 401', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/khong-ton-tai' })).statusCode, 404)
})
