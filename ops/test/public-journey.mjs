// Kiểm tra hành trình công khai thật trên HTTPS bằng trình duyệt thật.
//   1. mở danh mục   2. mở 1 game có sẵn   3. tạo game qua form   4. chơi game vừa tạo
// Chạy: node ops/test/public-journey.mjs [baseUrl]
import { chromium, devices } from '/Users/ngocp/goterm-workspace/arcade-2026-09-07/neon-lane-runner/node_modules/playwright/index.mjs'

const BASE = process.argv[2] ?? 'https://play.bomclaw.org'
const fails = []
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) fails.push(name)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'] })   // kiểm luôn mobile
const page = await ctx.newPage()

await page.goto(BASE, { waitUntil: 'networkidle' })
const cards = await page.locator('#list a.card').count()
ok('danh mục hiện game', cards >= 10, `${cards} thẻ`)

// không tràn ngang trên màn hình điện thoại
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
ok('không tràn ngang trên mobile', overflow <= 1, `thừa ${overflow}px`)

// vùng chạm của thẻ đủ lớn
const box = await page.locator('#list a.card').first().boundingBox()
ok('thẻ game đủ lớn để chạm', box.height >= 44, `${Math.round(box.height)}px`)

// mở một game có sẵn
const href = await page.locator('#list a.card').first().getAttribute('href')
const g = await ctx.newPage()
const resp = await g.goto(new URL(href, BASE).href, { waitUntil: 'domcontentloaded' })
ok('game có sẵn mở được', resp.status() === 200, `HTTP ${resp.status()} ${href}`)
await g.close()

// mọi game trong danh mục phải mở được và có canvas/khung chơi, không lỗi tải asset
const hrefs = await page.locator('#list a.card').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
for (const h of hrefs) {
  const t = await ctx.newPage()
  const bad = []
  t.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + new URL(r.url()).pathname) })
  const rr = await t.goto(new URL(h, BASE).href, { waitUntil: 'load' })
  await t.waitForTimeout(600)
  // rumba là puzzle dựng bằng DOM chứ không phải canvas -> chấp nhận cả lưới ô bấm được
  const playable = await t.evaluate(() =>
    !!document.querySelector('canvas, #game, [data-game]') ||
    document.querySelectorAll('button, [role=button], td, .cell').length > 3)
  ok(`mở ${h}`, rr.status() === 200 && playable && bad.length === 0,
     `HTTP ${rr.status()}${playable ? '' : ', KHÔNG thấy canvas'}${bad.length ? ', lỗi tải: ' + bad.join(', ') : ''}`)
  await t.close()
}

// tạo game qua đúng form người dùng bấm
await page.click('#tab-make')
const title = 'QA ' + Math.random().toString(36).slice(2, 7)
await page.fill('#title', title)
await page.click('#tpl button >> nth=1')          // Né thiên thạch
await page.click('#submit')
await page.waitForSelector('#status.ok a', { timeout: 30000 })
const playUrl = await page.locator('#status a').getAttribute('href')
ok('form tạo game trả về link chơi', !!playUrl, playUrl)

// chơi thật: bấm Chơi rồi xem điểm có tăng không
const p2 = await ctx.newPage()
const r2 = await p2.goto(new URL(playUrl, BASE).href, { waitUntil: 'domcontentloaded' })
ok('game vừa tạo mở được', r2.status() === 200, `HTTP ${r2.status()}`)
ok('game vừa tạo có canvas', await p2.locator('canvas#c').count() === 1)
await p2.click('#go')
await p2.waitForTimeout(2500)
const score = Number(await p2.locator('#score').textContent())
ok('game chạy thật (điểm tăng khi chơi)', score > 0, `điểm ${score}`)
const drawn = await p2.evaluate(() => {
  const c = document.getElementById('c'), x = c.getContext('2d')
  const d = x.getImageData(0, 0, Math.min(80, c.width), Math.min(80, c.height)).data
  let s = new Set()
  for (let i = 0; i < d.length; i += 4) s.add(d[i] + ',' + d[i+1] + ',' + d[i+2])
  return s.size
})
ok('canvas vẽ thật (nhiều màu)', drawn > 1, `${drawn} màu khác nhau`)

// đường nộp điểm của game vừa tạo (đúng lời gọi mà game chạy khi thua)
const board = await p2.evaluate(async (id) => {
  const a = await (await fetch('/v1/auth/guest', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: id }) })).json()
  const h = { 'content-type': 'application/json', authorization: 'Bearer ' + a.accessToken }
  const post = await fetch('/v1/leaderboard/alltime', { method: 'POST', headers: h,
    body: JSON.stringify({ score: 123 }) })
  const r = await (await fetch('/v1/leaderboard/alltime?limit=5', { headers: h })).json()
  return { status: post.status, n: r.entries.length }
}, playUrl.split('/g/')[1].replace('/', ''))
ok('điểm ghi được lên leaderboard của platform', board.status === 200 && board.n > 0,
   `HTTP ${board.status}, ${board.n} bản ghi`)

await browser.close()
console.log(fails.length ? `\n✗ ${fails.length} mục hỏng` : '\n✓ toàn bộ hành trình công khai chạy được')
process.exit(fails.length ? 1 : 0)
