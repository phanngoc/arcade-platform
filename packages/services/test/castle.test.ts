import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from '../../app/src/server.ts'
import { sql } from '@arcade/core'
import {
  upgradeCost, statMult, xpToNext, addXp, matchReward, progressQuests, loadout, unlocks, UNITS,
} from '../src/castle/economy.ts'
import { orderCodeOf } from '../src/shop/index.ts'

// Chạy trên DB riêng (DATABASE_URL=.../arcade_castle_test). Không mock Postgres.
let app: Awaited<ReturnType<typeof build>>
const players: string[] = []

async function guest() {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { gameId: 'castle' } })
  const b = r.json() as { accessToken: string; playerId: string }
  players.push(b.playerId)
  return { id: b.playerId, h: { authorization: `Bearer ${b.accessToken}` } }
}
type G = Awaited<ReturnType<typeof guest>>
const post = (g: G, url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: g.h, payload: payload as object })
const get = (g: G, url: string) => app.inject({ method: 'GET', url, headers: g.h })
let seq = 0
const mid = () => `m-${Date.now()}-${seq++}-xxxxxxxx`

before(async () => {
  delete process.env.PAYMENTS_LIVE
  process.env.SEPAY_API_KEY = 'test-key'
  app = await build({ gamesDir: '.', realtime: false })
})
after(async () => {
  if (players.length) await sql`delete from players where id = any(${players}::uuid[])`
  await app.close()
})

// ── kinh tế (hàm thuần) ──────────────────────────────────────────────────────
test('economy: bảng §2.3 cộng đúng 786 thẻ / 30.600 vàng / 1.389 XP mỗi quân', () => {
  let c = 0, g = 0, x = 0
  for (let l = 2; l <= 9; l++) { const k = upgradeCost(l); c += k.cards; g += k.gold; x += k.xp }
  assert.deepEqual([c, g, x], [786, 30600, 1389])
  assert.throws(() => upgradeCost(10))
  assert.equal(statMult(1), 1); assert.equal(statMult(5), 1.16); assert.equal(statMult(9), 1.32)
})

test('economy: XP người chơi 100+40n, trần 30, tổng ≈ 20.300', () => {
  assert.equal(xpToNext(1), 140)
  let total = 0
  for (let n = 1; n < 30; n++) total += xpToNext(n)
  assert.equal(total, 20300)
  assert.deepEqual(addXp(1, 0, 140 + 180), { level: 3, xp: 0, gained: [2, 3] })
  assert.equal(addXp(29, 0, 1e9).level, 30)
  assert.deepEqual(unlocks(1), []); assert.deepEqual(unlocks(3), ['daily_quests', 'standard'])
})

test('economy: thưởng trận §2.4 + 3 thắng đầu ngày + lần đầu qua màn', () => {
  const base = { mode: 'standard' as const, stage: 0, bestStage: 0 }
  assert.deepEqual(matchReward({ ...base, won: false, firstWinsToday: 0 }), { gold: 20, cards: 2, xp: 10 })
  assert.deepEqual(matchReward({ ...base, won: true, firstWinsToday: 2 }), { gold: 120, cards: 12, xp: 50 })
  assert.deepEqual(matchReward({ ...base, won: true, firstWinsToday: 3 }), { gold: 60, cards: 8, xp: 30 })
  assert.deepEqual(matchReward({ mode: 'campaign', stage: 4, bestStage: 3, won: true, firstWinsToday: 3 }),
    { gold: 60 + 800, cards: 28, xp: 80 })
  let q = { played: 0, won: 0, done: [] as string[] }, gold = 0, cards = 0, xp = 0
  for (let i = 0; i < 6; i++) { const r = progressQuests(q, true); q = r.state; gold += r.reward.gold; cards += r.reward.cards; xp += r.reward.xp }
  assert.deepEqual([gold, cards, xp], [150, 20, 60])
})

// ── API ──────────────────────────────────────────────────────────────────────
test('match: <20s bị từ chối, matchId trùng 409, thưởng đúng, đã ghi server', async () => {
  const a = await guest()
  assert.equal((await post(a, '/v1/castle/match', { matchId: mid(), mode: 'campaign', stage: 1, won: true, durationMs: 5000, cardUnit: 'knight' })).statusCode, 400)
  const id = mid()
  const r = await post(a, '/v1/castle/match', { matchId: id, mode: 'campaign', stage: 1, won: true, durationMs: 60000, cardUnit: 'knight' })
  assert.equal(r.statusCode, 200)
  // 60+60 thắng-đầu +200 qua màn 1; lên cấp 2 (XP 30+20+50=100 < 140 ⇒ chưa)
  assert.deepEqual(r.json().reward, { gold: 320, cards: 32, xp: 100 })
  assert.equal(r.json().profile.cards.knight, 32)
  assert.equal((await post(a, '/v1/castle/match', { matchId: id, mode: 'campaign', stage: 1, won: true, durationMs: 60000, cardUnit: 'knight' })).statusCode, 409)
  // Standard khoá dưới cấp 3
  assert.equal((await post(a, '/v1/castle/match', { matchId: mid(), mode: 'standard', won: true, durationMs: 60000, cardUnit: 'knight' })).statusCode, 403)
})

test('match: quá 40 trận/ngày thì ghi nhận nhưng không thưởng', async () => {
  const a = await guest()
  await sql`insert into castle_profiles (player_id) values (${a.id})`
  for (let i = 0; i < 40; i++) {
    await sql`insert into castle_matches (match_id, player_id, mode, won, duration_ms, rewarded, day)
      values (${mid()}, ${a.id}, 'campaign', false, 30000, true, (now() at time zone 'Asia/Ho_Chi_Minh')::date)`
  }
  const r = await post(a, '/v1/castle/match', { matchId: mid(), mode: 'campaign', stage: 1, won: true, durationMs: 60000, cardUnit: 'archer' })
  assert.equal(r.json().rewarded, false)
  assert.deepEqual(r.json().reward, { gold: 0, cards: 0, xp: 0 })
})

test('upgrade: thiếu tài nguyên 409 NOT_ENOUGH; đủ thì trừ đúng và lên cấp', async () => {
  const a = await guest()
  assert.equal((await post(a, '/v1/castle/upgrade', { unit: 'giant' })).json().error, 'NOT_ENOUGH')
  await sql`insert into castle_profiles (player_id, gold, cards) values (${a.id}, 100, ${sql.json({ giant: 5 })})
            on conflict (player_id) do update set gold = 100, cards = excluded.cards`
  const r = await post(a, '/v1/castle/upgrade', { unit: 'giant' })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().profile.units.giant, 2)
  assert.equal(r.json().profile.gold, 50)
  assert.equal(r.json().profile.cards.giant, 3)
  assert.equal(r.json().profile.xp, 4)
})

test('pass: nhận 1 lần/ngày; Plus cộng thêm 430 vàng', async () => {
  const a = await guest()
  const r = await post(a, '/v1/castle/pass/claim', { unit: 'archer' })
  assert.deepEqual(r.json().reward, { gold: 215, cards: 14, xp: 0 })
  assert.equal((await post(a, '/v1/castle/pass/claim', { unit: 'archer' })).statusCode, 409)
  const b = await guest()
  const o = (await post(b, '/v1/orders', { sku: 'castle.pass.s1' })).json()
  await post(b, '/v1/pay/sandbox/confirm', { orderId: o.orderId })
  assert.equal((await post(b, '/v1/castle/pass/claim', { unit: 'archer' })).json().reward.gold, 645)
})

test('orders: gói vàng 1/ngày, thẻ tự chọn 3/tuần ISO, starter 1/tài khoản, pass 1/mùa, skin once', async () => {
  const a = await guest()
  const buy = async (sku: string, unit?: string) => {
    const r = await post(a, '/v1/orders', { sku, unit })
    if (r.statusCode !== 200) return r.json().error as string
    const c = await post(a, '/v1/pay/sandbox/confirm', { orderId: r.json().orderId })
    assert.equal(c.statusCode, 200)
    return 'ok'
  }
  assert.equal(await buy('castle.gold.daily'), 'ok')
  assert.equal(await buy('castle.gold.daily'), 'LIMIT_REACHED')
  for (let i = 0; i < 3; i++) assert.equal(await buy('castle.cards.pick', 'bomber'), 'ok')
  assert.equal(await buy('castle.cards.pick', 'bomber'), 'LIMIT_REACHED')
  assert.equal(await buy('castle.starter', 'bomber'), 'ok')
  assert.equal(await buy('castle.starter', 'bomber'), 'LIMIT_REACHED')
  assert.equal(await buy('castle.pass.s1'), 'ok')
  assert.equal(await buy('castle.pass.s1'), 'LIMIT_REACHED')
  // starter đã cho skin băng ⇒ không bán skin băng nữa
  assert.equal(await buy('castle.skin.ice'), 'LIMIT_REACHED')
  const p = (await get(a, '/v1/castle/profile')).json()
  assert.equal(p.gold, 1500 + 2000)
  assert.equal(p.cards.bomber, 150 + 100)
  assert.ok(p.entitlements.includes('castle.skin.ice'))
  assert.equal(p.pass.active, true)
  const shop = (await get(a, '/v1/shop?game=castle')).json() as { sku: string; limitLeft: number }[]
  assert.equal(shop.find((s) => s.sku === 'castle.gold.daily')!.limitLeft, 0)
  assert.equal(shop.find((s) => s.sku === 'castle.skin.bamboo')!.limitLeft, 1)
  // đơn đang chờ (chưa trả) cũng giữ chỗ: không tạo được đơn thứ hai cùng lúc
  const b = await guest()
  assert.equal((await post(b, '/v1/orders', { sku: 'castle.skin.bamboo' })).statusCode, 200)
  assert.equal((await post(b, '/v1/orders', { sku: 'castle.skin.bamboo' })).json().error, 'LIMIT_REACHED')
})

test('order: trả về code ARC+8, QR SePay (số tiền + mã đơn), sandbox=true; trạng thái pending→paid', async () => {
  const a = await guest()
  const o = (await post(a, '/v1/orders', { sku: 'castle.skin.redstone' })).json()
  assert.match(o.code, /^ARC[A-Z0-9]{8}$/)
  assert.equal(o.amount, 39000); assert.equal(o.sandbox, true); assert.equal(o.qr.content, o.code)
  const u = new URL(o.qr.imageUrl)
  assert.equal(u.origin + u.pathname, 'https://qr.sepay.vn/img')
  assert.equal(u.searchParams.get('amount'), '39000'); assert.equal(u.searchParams.get('des'), o.code)
  assert.equal((await get(a, `/v1/orders/${o.orderId}`)).json().status, 'pending')
  await post(a, '/v1/pay/sandbox/confirm', { orderId: o.orderId })
  assert.equal((await get(a, `/v1/orders/${o.orderId}`)).json().status, 'paid')
  assert.deepEqual((await get(a, '/v1/entitlements?game=castle')).json(), ['castle.skin.redstone'])
})

const hook = (payload: object, key = 'test-key') =>
  app.inject({ method: 'POST', url: '/v1/pay/webhook', payload, headers: { authorization: `Apikey ${key}` } })
let sepayId = 900_000_000 + Math.floor(Math.random() * 1e6)
const sepay = (over: Record<string, unknown>) => ({
  id: ++sepayId, gateway: 'MBBank', transactionDate: '2026-11-13 10:00:00', accountNumber: '0123', subAccount: null,
  code: null, content: '', transferType: 'in', description: '', transferAmount: 0, accumulated: 0, referenceCode: 'FT1', ...over,
})
const events = async (txn: string) =>
  sql<{ outcome: string }[]>`select outcome from payment_events where provider_txn = ${'sepay:' + txn}`

test('SePay webhook: key sai 401 (không ghi), sai số tiền không cấp + ghi lại, đúng thì cấp, gửi trùng không cấp hai lần', async () => {
  const a = await guest()
  const o = (await post(a, '/v1/orders', { sku: 'castle.gold.daily' })).json()
  const ok = sepay({ code: o.code, content: `${o.code} chuyen tien`, transferAmount: 15000 })
  const bad = await hook(ok, 'wrong-key')
  assert.equal(bad.statusCode, 401)
  assert.equal((await events(String(ok.id))).length, 0)
  const noHeader = await app.inject({ method: 'POST', url: '/v1/pay/webhook', payload: ok })
  assert.equal(noHeader.statusCode, 401)
  const low = sepay({ code: o.code, content: o.code, transferAmount: 1000 })
  const wrongAmt = await hook(low)
  assert.equal(wrongAmt.statusCode, 200)
  assert.equal(wrongAmt.json().success, true)
  assert.equal(wrongAmt.json().outcome, 'amount_mismatch')
  assert.deepEqual((await events(String(low.id))).map((e) => e.outcome), ['amount_mismatch'])
  assert.equal((await get(a, '/v1/castle/profile')).json().gold, 0)
  assert.equal((await get(a, `/v1/orders/${o.orderId}`)).json().status, 'pending')
  const r1 = await hook(ok)
  const r2 = await hook(ok)
  assert.equal(r1.json().outcome, 'granted')
  assert.equal(r2.json().duplicate, true)
  assert.equal((await get(a, '/v1/castle/profile')).json().gold, 1500)
  // giao dịch khác cho đơn đã trả: ghi lại, không cấp thêm
  const again = await hook(sepay({ code: o.code, content: o.code, transferAmount: 15000 }))
  assert.equal(again.json().outcome, 'already_paid')
  assert.equal((await get(a, '/v1/castle/profile')).json().gold, 1500)
})

test('SePay webhook: nội dung không có mã, mã lạ, tiền ra => ghi lại, không cấp; mã lấy từ nội dung khi code=null', async () => {
  const a = await guest()
  const o = (await post(a, '/v1/orders', { sku: 'castle.skin.bamboo' })).json()
  const none = sepay({ content: 'chuyen tien mua do', transferAmount: o.amount })
  assert.equal((await hook(none)).json().outcome, 'no_code')
  assert.deepEqual((await events(String(none.id))).map((e) => e.outcome), ['no_code'])
  assert.equal((await hook(sepay({ content: 'ARCZZZZZZZZ', transferAmount: o.amount }))).json().outcome, 'unknown_order')
  assert.equal((await hook(sepay({ code: o.code, content: o.code, transferAmount: o.amount, transferType: 'out' }))).json().outcome, 'ignored_out')
  assert.equal((await get(a, `/v1/orders/${o.orderId}`)).json().status, 'pending')
  // ngân hàng có thể chèn tiền tố / viết thường: vẫn khớp
  const r = await hook(sepay({ code: null, content: `MBVCB.123.${o.code.toLowerCase()}.CT tu 0123`, transferAmount: o.amount }))
  assert.equal(r.json().outcome, 'granted')
  assert.deepEqual((await get(a, '/v1/entitlements?game=castle')).json(), ['castle.skin.bamboo'])
  assert.equal(orderCodeOf({ code: 'ARCABCDEFGH' }), 'ARCABCDEFGH')
  assert.equal(orderCodeOf({ code: null, content: 'khong co ma' }), null)
})

test('SePay webhook: thiếu id bị 400; sandbox confirm gửi trùng = duplicate', async () => {
  assert.equal((await hook({ transferType: 'in', content: 'x' })).statusCode, 400)
  const a = await guest()
  const o = (await post(a, '/v1/orders', { sku: 'castle.skin.redstone' })).json()
  assert.equal((await post(a, '/v1/pay/sandbox/confirm', { orderId: o.orderId })).json().outcome, 'granted')
  assert.equal((await post(a, '/v1/pay/sandbox/confirm', { orderId: o.orderId })).json().duplicate, true)
})

test('PAYMENTS_LIVE=true mà thiếu SEPAY_API_KEY: webhook 503, không nhận key sandbox', async () => {
  const k = process.env.SEPAY_API_KEY
  process.env.PAYMENTS_LIVE = 'true'; delete process.env.SEPAY_API_KEY
  try {
    assert.equal((await hook(sepay({ content: 'x' }), 'sandbox-sepay-key')).statusCode, 503)
  } finally { delete process.env.PAYMENTS_LIVE; process.env.SEPAY_API_KEY = k }
})

test('sandbox confirm bị tắt khi PAYMENTS_LIVE=true', async () => {
  const a = await guest()
  const o = (await post(a, '/v1/orders', { sku: 'castle.skin.bamboo' })).json()
  process.env.PAYMENTS_LIVE = 'true'
  try {
    const r = await post(a, '/v1/pay/sandbox/confirm', { orderId: o.orderId })
    assert.equal(r.statusCode, 403)
    assert.equal(r.json().error, 'SANDBOX_DISABLED')
    assert.equal((await post(a, '/v1/orders', { sku: 'castle.skin.redstone' })).json().sandbox, false)
  } finally { delete process.env.PAYMENTS_LIVE }
  assert.equal((await get(a, `/v1/orders/${o.orderId}`)).json().status, 'pending')
})

test('Đấu Chuẩn: người chi tối đa (quân cấp 9) bị ép cấp 5 y như người free; bảng standard chỉ nhận trận standard', async () => {
  const whale = await guest(), free = await guest()
  const max = Object.fromEntries(UNITS.map((u) => [u, 9]))
  await sql`insert into castle_profiles (player_id, level, units, gold) values
    (${whale.id}, 3, ${sql.json(max)}, 999999), (${free.id}, 3, '{}'::jsonb, 0)`
  const lw = (await get(whale, '/v1/castle/loadout?mode=standard')).json()
  const lf = (await get(free, '/v1/castle/loadout?mode=standard')).json()
  assert.deepEqual(lw, lf)
  for (const u of UNITS) { assert.equal(lw.units[u], 5); assert.equal(lw.mult[u], 1.16) }
  assert.deepEqual(loadout('standard', max), loadout('standard', {}))
  // chiến dịch thì cấp quân có hiệu lực (khác nhau)
  assert.equal((await get(whale, '/v1/castle/loadout?mode=campaign')).json().units.giant, 9)

  const camp = mid()
  await post(whale, '/v1/castle/match', { matchId: camp, mode: 'campaign', stage: 20, won: true, durationMs: 90000, cardUnit: 'giant' })
  const r = await post(whale, '/v1/leaderboard/standard', { score: 5000, matchId: camp })
  assert.equal(r.json().error, 'MODE_NOT_STANDARD')
  assert.equal((await post(whale, '/v1/leaderboard/standard', { score: 5000 })).json().error, 'MATCH_ID_REQUIRED')
  // trận standard của người khác cũng không dùng được
  const sf = mid()
  await post(free, '/v1/castle/match', { matchId: sf, mode: 'standard', won: true, durationMs: 90000, cardUnit: 'knight' })
  assert.equal((await post(whale, '/v1/leaderboard/standard', { score: 5000, matchId: sf })).json().error, 'MATCH_NOT_FOUND')
  const sw = mid()
  await post(whale, '/v1/castle/match', { matchId: sw, mode: 'standard', won: true, durationMs: 90000, cardUnit: 'knight' })
  const okW = await post(whale, '/v1/leaderboard/standard', { score: 100, matchId: sw })
  const okF = await post(free, '/v1/leaderboard/standard', { score: 100, matchId: sf })
  assert.equal(okW.statusCode, 200); assert.equal(okF.statusCode, 200)
  assert.equal(okW.json().verified, okF.json().verified)
})

test('castle routes từ chối token của game khác', async () => {
  await sql`insert into games (id, name, manifest) values ('test-other', 'Other', '{}'::jsonb) on conflict do nothing`
  const r = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { gameId: 'test-other' } })
  const b = r.json() as { accessToken: string; playerId: string }
  players.push(b.playerId)
  const p = await app.inject({ method: 'GET', url: '/v1/castle/profile', headers: { authorization: `Bearer ${b.accessToken}` } })
  assert.equal(p.statusCode, 403)
})
