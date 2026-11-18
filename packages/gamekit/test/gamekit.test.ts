import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseToml, parseManifest, parseSpec, validateGame } from '../src/index.ts'

const TOML = `
[game]
id          = "neon-lane-runner"
name        = "Neon Lane Runner"   # comment sau giá trị
version     = "1.0.0"
engine      = "canvas2d"
orientation = "any"
client_dir  = "dist"

[runtime]
mode = "offline"

[capabilities]
save        = true
leaderboard = [
  "daily",   # nhiều dòng
  "alltime",
]

[limits]
bundle_bytes = 5_242_880
`

const SPEC = {
  id: 'neon-lane-runner', title: 'Neon', genre: 'action-arcade', loop: 'chạy, né, lặp lại',
  mode: 'offline', maxPlayers: 1, controls: { mobile: 'vuốt', desktop: 'phím mũi tên' },
  winCondition: 'đạt 1000 điểm', loseCondition: 'đâm chướng ngại', template: 'canvas2d-offline',
  balance: [{ param: 'LANE_CHANGE_S', constraint: '< GAP_S', why: 'không thì không né kịp' }],
}

test('toml: đọc đúng arcade.toml thật (comment, mảng nhiều dòng, số có _)', () => {
  const d = parseToml(TOML) as Record<string, Record<string, unknown>>
  assert.equal(d.game!.name, 'Neon Lane Runner')
  assert.deepEqual(d.capabilities!.leaderboard, ['daily', 'alltime'])
  assert.equal(d.limits!.bundle_bytes, 5242880)
  assert.equal((parseToml('a = "x # không phải comment"') as Record<string, unknown>).a, 'x # không phải comment')
})

test('toml: cú pháp không hỗ trợ báo lỗi kèm dòng, không đoán', () => {
  assert.throws(() => parseToml('[game]\nx = { a = 1 }'), /dòng 2: không hỗ trợ inline table/)
  assert.throws(() => parseToml('a.b = 1'), /dotted/)
  assert.throws(() => parseToml('[g]\n[g]'), /hai lần/)
  assert.throws(() => parseToml('a = [1, 2'), /không đóng/)
})

test('manifest: hợp lệ thì ra đúng thứ platform đọc', () => {
  const { manifest, problems } = parseManifest(TOML)
  assert.deepEqual(problems, [])
  assert.equal(manifest?.runtime.mode, 'offline')
  assert.equal(manifest?.game.client_dir, 'dist')
})

test('manifest: khoá gõ sai là lỗi, không lặng lẽ bỏ qua', () => {
  const { manifest, problems } = parseManifest(TOML.replace('leaderboard =', 'leaderbord ='))
  assert.equal(manifest, undefined)
  assert.ok(problems.some((p) => p.where === 'capabilities.leaderbord' && p.level === 'error'))
})

test('manifest: giá trị sai kiểu/enum, client_dir thoát ra ngoài', () => {
  const bad = TOML.replace('mode = "offline"', 'mode = "p2p"').replace('"dist"', '"../x"').replace('"1.0.0"', '"1.0"')
  const where = parseManifest(bad).problems.map((p) => p.where)
  for (const w of ['runtime.mode', 'game.client_dir', 'game.version']) assert.ok(where.includes(w), `thiếu lỗi ${w}: ${where}`)
})

test('manifest: khoá phòng trên game offline là cảnh báo', () => {
  const { manifest, problems } = parseManifest(TOML.replace('mode = "offline"', 'mode = "offline"\ntick_rate = 30'))
  assert.ok(manifest)
  assert.ok(problems.some((p) => p.level === 'warning' && p.where === 'runtime.tick_rate'))
})

test('spec: hợp lệ', () => {
  const { spec, problems } = parseSpec(JSON.stringify(SPEC))
  assert.ok(spec, JSON.stringify(problems))
  assert.equal(problems.length, 0)
})

test('spec: balance dạng object (kiểu các game cũ) hoặc rỗng là lỗi', () => {
  const asObj = parseSpec(JSON.stringify({ ...SPEC, balance: { gravity: 9.8 } }))
  assert.ok(asObj.problems.some((p) => p.where === 'balance' && p.level === 'error'))
  const empty = parseSpec(JSON.stringify({ ...SPEC, balance: [] }))
  assert.ok(empty.problems.some((p) => p.where === 'balance'))
})

test('spec: mode và maxPlayers phải khớp nhau', () => {
  const r = parseSpec(JSON.stringify({ ...SPEC, mode: 'authoritative', maxPlayers: 1 }))
  assert.ok(r.problems.some((p) => p.where === 'maxPlayers'))
})

test('spec: khoá thêm chỉ cảnh báo', () => {
  const r = parseSpec(JSON.stringify({ ...SPEC, knownGaps: [] }))
  assert.ok(r.spec)
  assert.ok(r.problems.some((p) => p.level === 'warning' && p.where === 'knownGaps'))
})

function gameDir(name: string, toml: string, spec: object | null, files: string[] = []) {
  const dir = join(mkdtempSync(join(tmpdir(), 'gamekit-')), name)
  mkdirSync(dir)
  writeFileSync(join(dir, 'arcade.toml'), toml)
  if (spec) writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec))
  for (const f of files) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), '') }
  return dir
}

test('validateGame: hai file khớp nhau là qua', () => {
  const c = validateGame(gameDir('neon-lane-runner', TOML, SPEC, ['dist/index.html']))
  assert.ok(c.ok, JSON.stringify(c.problems))
  assert.equal(c.problems.length, 0)
})

test('validateGame: id/mode lệch giữa spec và toml là lỗi', () => {
  const c = validateGame(gameDir('neon-lane-runner', TOML, { ...SPEC, id: 'neon', mode: 'relay', maxPlayers: 4 }, ['dist/index.html']))
  assert.equal(c.ok, false)
  const msgs = c.problems.filter((p) => p.where === 'spec.json ↔ arcade.toml').map((p) => p.message).join('\n')
  assert.match(msgs, /id khác nhau/)
  assert.match(msgs, /mode khác nhau/)
})

test('validateGame: thiếu spec.json là lỗi; thư mục khác id và chưa build là cảnh báo', () => {
  const c = validateGame(gameDir('neon-checkout', TOML, null))
  assert.equal(c.ok, false)
  assert.ok(c.problems.some((p) => p.where === 'spec.json' && p.level === 'error'))
  assert.ok(c.problems.some((p) => p.where === 'thư mục' && p.level === 'warning'))
  assert.ok(c.problems.some((p) => p.where === 'client' && p.level === 'warning'))
})
