import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { actions, callAction, checkArgs, toolList, scaffold } from '../src/index.ts'

const CLI = resolve(import.meta.dirname, '../../cli/src/index.ts')

test('sổ đăng ký: mỗi action có tên nhóm.việc, mô tả đủ để agent chọn, schema đúng dạng', () => {
  const list = actions()
  assert.ok(list.length >= 6)
  for (const a of list) {
    assert.match(a.name, /^[a-z]+(\.[a-z][a-zA-Z]*)+$/)
    assert.ok(a.description.length >= 40, `${a.name}: mô tả quá ngắn để agent chọn đúng tool`)
    assert.equal(a.input.type, 'object')
    for (const r of a.input.required ?? []) assert.ok(r in a.input.properties, `${a.name}: required "${r}" không có trong properties`)
  }
  // Tên tool MCP chỉ được [a-zA-Z0-9_-] — dấu chấm bị client từ chối.
  for (const t of toolList()) assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/)
})

test('checkArgs: thiếu, thừa, sai kiểu, sai enum đều nói đúng khoá', () => {
  const s = { type: 'object', properties: { dir: { type: 'string', description: 'x' }, n: { type: 'integer', description: 'x' }, t: { type: 'string', description: 'x', enum: ['a'] } }, required: ['dir'] } as const
  assert.match(checkArgs(s, {})!, /thiếu "dir"/)
  assert.match(checkArgs(s, { dir: 'x', zz: 1 })!, /khoá lạ "zz"/)
  assert.match(checkArgs(s, { dir: 1 })!, /"dir" phải là string/)
  assert.match(checkArgs(s, { dir: 'x', n: 1.5 })!, /"n" phải là integer/)
  assert.match(checkArgs(s, { dir: 'x', t: 'b' })!, /một trong: a/)
  assert.equal(checkArgs(s, { dir: 'x', n: 2, t: 'a' }), null)
})

test('callAction: game.new rồi spec.validate/spec.get/manifest.get/games.list trên chính nó', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-'))
  scaffold({ id: 'mini-game', parent: root, skipSdk: true })
  const dir = join(root, 'mini-game')
  const v = (await callAction('spec.validate', { dir })) as { ok: boolean; problems: { where: string }[] }
  assert.equal(v.ok, false) // spec còn __FILL__
  const s = (await callAction('spec.get', { dir })) as { spec: { id: string } }
  assert.equal(s.spec.id, 'mini-game')
  const m = (await callAction('manifest.get', { dir })) as { runtime: { mode: string } }
  assert.equal(m.runtime.mode, 'offline')
  const g = (await callAction('games.list', { root })) as { games: { id: string; ok: boolean }[] }
  assert.deepEqual(g.games.map((x) => [x.id, x.ok]), [['mini-game', false]])
  await assert.rejects(callAction('spec.validate', {}), /thiếu "dir"/)
  await assert.rejects(callAction('nope.nope'), /không có action/)
})

test('assets.list: kích thước, loại, asset thừa, % ngân sách', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'assets-')), 'gg')
  mkdirSync(join(dir, 'public/sprites'), { recursive: true })
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'arcade.toml'), '[game]\nid="gg"\nname="G"\nversion="1.0.0"\nengine="canvas2d"\norientation="any"\nclient_dir="dist"\n[runtime]\nmode="offline"\n[limits]\nbundle_bytes=1000\n')
  writeFileSync(join(dir, 'public/sprites/hero.png'), Buffer.alloc(300))
  writeFileSync(join(dir, 'public/sprites/old.png'), Buffer.alloc(50))
  writeFileSync(join(dir, 'main.ts'), "const img = 'sprites/hero.png'")
  writeFileSync(join(dir, 'dist/index.html'), Buffer.alloc(250))
  const r = (await callAction('assets.list', { dir })) as {
    assets: { path: string; bytes: number; referenced: boolean }[]; unreferenced: string[]; bundle: { percent: number | null }; byKind: Record<string, { count: number }>
  }
  assert.deepEqual(r.assets.map((a) => [a.path, a.bytes, a.referenced]), [['public/sprites/hero.png', 300, true], ['public/sprites/old.png', 50, false]])
  assert.deepEqual(r.unreferenced, ['public/sprites/old.png'])
  assert.equal(r.byKind.image?.count, 2)
  assert.equal(r.bundle.percent, 25)
})

/** Nói chuyện với `arcade mcp` qua stdio như một agent thật. */
async function mcp(lines: object[]): Promise<Record<string, any>[]> {
  const p = spawn(process.execPath, [CLI, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  for (const l of lines) p.stdin.write(JSON.stringify(l) + '\n')
  p.stdin.end()
  await new Promise((r) => p.on('close', r))
  return out.trim().split('\n').map((l) => JSON.parse(l))
}

test('arcade mcp: initialize → tools/list → tools/call (thành công và lỗi action)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-'))
  scaffold({ id: 'mcp-game', parent: root, skipSdk: true })
  const res = await mcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'manifest_get', arguments: { dir: join(root, 'mcp-game') } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'spec_validate', arguments: {} } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'no_such' } },
  ])
  assert.deepEqual(res.map((r) => r.id), [1, 2, 3, 4, 5]) // notification không được trả lời
  assert.equal(res[0]!.result.serverInfo.name, 'arcade')
  const names = res[1]!.result.tools.map((t: { name: string }) => t.name)
  for (const n of ['game_new', 'spec_validate', 'spec_get', 'manifest_get', 'games_list', 'assets_list']) assert.ok(names.includes(n), `thiếu tool ${n}`)
  assert.equal(res[2]!.result.structuredContent.game.id, 'mcp-game')
  assert.equal(res[3]!.result.isError, true) // lỗi action = kết quả cho agent đọc, không phải lỗi giao thức
  assert.match(res[3]!.result.content[0].text, /thiếu "dir"/)
  assert.equal(res[4]!.error.code, -32602)
})

test('gameplay: balance.check, curves.get, bot.simulate, bot.replay đọc từ src/studio.ts của game', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gp-'))
  scaffold({ id: 'gp-dodge', parent: root, skipSdk: true })
  const dir = join(root, 'gp-dodge')
  const b = (await callAction('balance.check', { dir })) as { ok: boolean; config: Record<string, number>; balance: { param: string }[] }
  assert.equal(b.ok, true)
  assert.equal(b.config.PLAYER_SPEED, 9)
  const c = (await callAction('curves.get', { dir })) as { curves: { id: string; points: [number, number][] }[] }
  assert.deepEqual(c.curves.map((x) => x.id), ['fallSpeed', 'spawnEvery'])
  const s = (await callAction('bot.simulate', { dir, seeds: 4 })) as { total: number; runs: { seed: number }[] }
  assert.deepEqual(s.runs.map((r) => r.seed), [1, 2, 3, 4])
  const r = (await callAction('bot.replay', { dir, seed: 1, every: 1 })) as { frames: { shapes: unknown[] }[]; world: { w: number } }
  assert.equal(r.world.w, 10)
  assert.ok(r.frames.length > 3 && r.frames.every((f) => f.shapes.length > 0))
  await assert.rejects(callAction('bot.simulate', { dir, seeds: 999 }), /1\.\.200/)
})

test('config.set: sửa số, giữ comment, kiểm lại balance; số làm game không nạp được thì trả lại file cũ', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cfg-'))
  scaffold({ id: 'cfg-dodge', parent: root, skipSdk: true })
  const dir = join(root, 'cfg-dodge')
  const file = join(dir, 'src/config.ts')
  const r = (await callAction('config.set', { dir, name: 'PLAYER_SPEED', value: 2 })) as { old: number; ok: boolean; balance: { param: string; ok: boolean }[] }
  assert.equal(r.old, 9)
  assert.equal(r.ok, false) // tốc độ 2 không né kịp khối rộng nhất
  assert.equal(r.balance.find((x) => x.param === 'PLAYER_SPEED')?.ok, false)
  assert.match(readFileSync(file, 'utf8'), /^export const PLAYER_SPEED = 2; \/\/ u\/s$/m)
  await assert.rejects(callAction('config.set', { dir, name: 'NOPE', value: 1 }), /không thấy/)
  await assert.rejects(callAction('config.set', { dir, name: 'lower', value: 1 }), /HẰNG_SỐ/)
  // Game nạp lỗi sau khi sửa → file trở lại nguyên trạng.
  writeFileSync(join(dir, 'src/studio.ts'), readFileSync(join(dir, 'src/studio.ts'), 'utf8') + '\nif (C.PLAYER_SPEED === 7) throw new Error("boom")\n')
  const before = readFileSync(file, 'utf8')
  await assert.rejects(callAction('config.set', { dir, name: 'PLAYER_SPEED', value: 7 }), /boom/)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('arcade studio: trang + /api/call đi qua cùng sổ đăng ký; /play chỉ phục vụ trong thư mục đang mở', async () => {
  const { startStudio } = await import('../src/index.ts')
  const root = mkdtempSync(join(tmpdir(), 'ui-'))
  scaffold({ id: 'ui-game', parent: root, skipSdk: true })
  const s = await startStudio({ target: root, port: 0 })
  try {
    const html = await fetch(s.url).then((r) => r.text())
    assert.match(html, /Arcade Studio/)
    const ctx = await fetch(s.url + 'api/context').then((r) => r.json())
    assert.equal(ctx.game, null)
    const ok = await fetch(s.url + 'api/call', { method: 'POST', body: JSON.stringify({ action: 'manifest.get', args: { dir: join(root, 'ui-game') } }) }).then((r) => r.json())
    assert.equal(ok.result.game.id, 'ui-game')
    const bad = await fetch(s.url + 'api/call', { method: 'POST', body: JSON.stringify({ action: 'spec.validate', args: {} }) }).then((r) => r.json())
    assert.match(bad.error, /thiếu "dir"/)
    const outside = await fetch(s.url + 'play/' + encodeURIComponent('/etc') + '/passwd')
    assert.equal(outside.status, 403)
  } finally {
    s.close()
  }
})
