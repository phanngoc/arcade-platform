import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
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
