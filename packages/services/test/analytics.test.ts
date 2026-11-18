import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gaConfig, injectGtag, mpPayloads, sendToGa, gaEventName } from '../src/analytics/index.ts'

test('gaConfig: thiếu hoặc sai Measurement ID ⇒ tắt', () => {
  assert.equal(gaConfig({}), null)
  assert.equal(gaConfig({ GA_MEASUREMENT_ID: 'UA-123' }), null)
  assert.equal(gaConfig({ GA_MEASUREMENT_ID: 'G-ABC"><script>' }), null)
  assert.deepEqual(gaConfig({ GA_MEASUREMENT_ID: ' G-ABC123 ' }), { measurementId: 'G-ABC123', apiSecret: null })
  assert.deepEqual(gaConfig({ GA_MEASUREMENT_ID: 'G-ABC123', GA_API_SECRET: 's3' }), { measurementId: 'G-ABC123', apiSecret: 's3' })
})

test('injectGtag: chèn ngay sau <head>, một lần duy nhất', () => {
  const html = '<!doctype html><html><head lang="vi"><title>x</title></head><body></body></html>'
  const out = injectGtag(html, 'G-ABC123', { game_id: 'queens' })
  assert.ok(out.startsWith('<!doctype html><html><head lang="vi"><script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123">'))
  assert.ok(out.includes(`gtag('config',"G-ABC123",{"game_id":"queens"})`))
  assert.ok(out.endsWith('<title>x</title></head><body></body></html>'))
  assert.equal(injectGtag(out, 'G-ABC123'), out)
  assert.ok(injectGtag('<p>no head</p>', 'G-ABC123').endsWith('<p>no head</p>'))
})

test('mpPayloads: gom theo người chơi, ≤25 event/request, chỉ giữ tham số phẳng', () => {
  const evs: { gameId: string; playerId: string; name: string; props: unknown }[] = Array.from({ length: 30 }, (_, i) => ({ gameId: 'rumba', playerId: 'p1', name: 'win', props: { ms: i, nested: { a: 1 }, mode: 'daily', ok: true } }))
  evs.push({ gameId: 'castle', playerId: 'p2', name: 'game-start', props: null })
  const out = mpPayloads(evs)
  assert.equal(out.length, 3)
  assert.deepEqual(out.map((p) => [p.client_id, p.events.length]), [['p1', 25], ['p1', 5], ['p2', 1]])
  assert.deepEqual(out[0]!.events[3], { name: 'win', params: { game_id: 'rumba', ms: 3, mode: 'daily', ok: 1 } })
  assert.equal(out[2]!.events[0]!.name, 'game_start')
  assert.equal(gaEventName('123'), null)
})

test('sendToGa: không có secret ⇒ không gọi mạng; lỗi mạng không ném', async () => {
  let calls = 0
  const fake = (async () => { calls++; return new Response(null, { status: 204 }) }) as typeof fetch
  const ev = [{ gameId: 'queens', playerId: 'p', name: 'start', props: {} }]
  assert.equal(await sendToGa({ measurementId: 'G-ABC123', apiSecret: null }, ev, fake), 0)
  assert.equal(await sendToGa(null, ev, fake), 0)
  assert.equal(calls, 0)
  let url = ''
  const spy = (async (u: string) => { url = u; return new Response(null, { status: 204 }) }) as unknown as typeof fetch
  assert.equal(await sendToGa({ measurementId: 'G-ABC123', apiSecret: 'k&1' }, ev, spy), 1)
  assert.ok(url.startsWith('https://www.google-analytics.com/mp/collect?measurement_id=G-ABC123&api_secret=k%261'))
  const boom = (async () => { throw new Error('offline') }) as typeof fetch
  assert.equal(await sendToGa({ measurementId: 'G-ABC123', apiSecret: 'k' }, ev, boom), 0)
})
