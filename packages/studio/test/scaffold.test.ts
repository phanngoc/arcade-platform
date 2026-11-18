import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateGame } from '@arcade/gamekit'
import { scaffold } from '../src/scaffold.ts'

const tmp = () => mkdtempSync(join(tmpdir(), 'arcade-new-'))

test('new: game offline ra đời đúng hợp đồng, chỉ thiếu spec', () => {
  const r = scaffold({ id: 'dodge-x', parent: tmp(), skipSdk: true })
  assert.equal(r.template, 'vite-offline')
  for (const f of ['.gitignore', 'AGENTS.md', 'arcade.toml', 'index.html', 'package.json', 'src/engine.ts', 'src/config.ts', 'tests/engine.test.ts', 'public/arcade-bridge.js']) {
    assert.ok(existsSync(join(r.dest, f)), `thiếu ${f}`)
  }
  for (const f of ['arcade.toml', 'index.html', 'package.json', 'AGENTS.md']) {
    const s = readFileSync(join(r.dest, f), 'utf8')
    assert.ok(!/__GAME_ID__|__GAME_NAME__|__TEMPLATE__/.test(s), `${f} còn placeholder`)
  }
  const c = validateGame(r.dest)
  assert.equal(c.manifest?.game.id, 'dodge-x')
  // Chỉ spec chặn: manifest hợp lệ, spec còn mốc __FILL__.
  const errs = c.problems.filter((p) => p.level === 'error')
  assert.ok(errs.length > 0 && errs.every((p) => p.where.startsWith('spec.json')), JSON.stringify(errs))
  assert.ok(errs.some((p) => p.message.includes('__FILL__')))
})

test('new --spec: spec viết sẵn thì game qua validate ngay (trừ chưa build)', () => {
  const dir = tmp()
  const spec = {
    id: 'coins-x', title: 'Coins', genre: 'party', loop: 'nhặt xu trước đối thủ', mode: 'authoritative', maxPlayers: 4,
    controls: { mobile: 'kéo', desktop: 'WASD' }, winCondition: 'đủ 10 xu', loseCondition: 'người khác đủ 10 xu trước',
    template: 'vite-authoritative-mp', balance: [{ param: 'TICK_RATE', constraint: 'PLAYER_SPEED/TICK_RATE < PLAYER_R+COIN_R', why: 'đi xuyên xu' }],
  }
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec))
  const r = scaffold({ id: 'coins-x', parent: dir, spec: join(dir, 'spec.json'), skipSdk: true })
  assert.equal(r.template, 'vite-authoritative-mp')
  const c = validateGame(r.dest)
  assert.ok(c.ok, JSON.stringify(c.problems))
  assert.equal(c.manifest?.runtime.mode, 'authoritative')
  assert.ok(existsSync(join(r.dest, 'server/room.ts')))
})

test('new: không ghi đè, không đoán', () => {
  const dir = tmp()
  scaffold({ id: 'same-id', parent: dir, skipSdk: true })
  assert.throws(() => scaffold({ id: 'same-id', parent: dir, skipSdk: true }), /không ghi đè/)
  assert.throws(() => scaffold({ id: 'Bad_Id', parent: dir, skipSdk: true }), /kebab-case/)
  assert.throws(() => scaffold({ id: 'x-y', template: 'unity', parent: dir, skipSdk: true }), /không có template/)
})

test('new --spec: spec lệch lệnh thì từ chối', () => {
  const dir = tmp()
  const spec = { id: 'other', title: 'x', genre: 'puzzle', loop: 'x', mode: 'offline', maxPlayers: 1, controls: { mobile: 'x', desktop: 'x' },
    winCondition: 'x', loseCondition: 'x', template: 'vite-offline', balance: [{ param: 'a', constraint: 'b', why: 'c' }] }
  writeFileSync(join(dir, 's.json'), JSON.stringify(spec))
  assert.throws(() => scaffold({ id: 'mine', parent: dir, spec: join(dir, 's.json'), skipSdk: true }), /khác "mine"/)
  assert.throws(() => scaffold({ id: 'other', template: 'mp', parent: dir, spec: join(dir, 's.json'), skipSdk: true }), /spec chọn template/)
})
