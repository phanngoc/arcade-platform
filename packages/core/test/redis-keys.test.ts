import { test } from 'node:test'
import assert from 'node:assert/strict'
import { key, hashTag } from '../src/keys.ts'

// Trên Redis Cluster, lệnh nhiều key chỉ chạy khi các key cùng hash slot.
// Hash tag {game_id} là thứ ép điều đó. Test này chặn việc vô tình thêm một
// key không có hash tag — lỗi chỉ lộ ra khi đã lên Cluster, tức là quá muộn.
test('mọi key của một game dùng chung hash tag', () => {
  const g = 'castle'
  const keys = [
    key.boardHydrated(g, 'daily'),
    key.board(g, 'daily'), key.boardMeta(g, 'daily'), key.boardDirty(g),
    key.save(g, 'p1'), key.room(g, 'K3F9'), key.session(g, 't'), key.rate(g, 'p1', 'msg'),
  ]
  for (const k of keys) assert.equal(hashTag(k), g, `thiếu/sai hash tag: ${k}`)
})

test('game khác nhau thì hash tag khác nhau', () => {
  assert.notEqual(hashTag(key.board('castle', 'daily')), hashTag(key.board('rumba', 'daily')))
})

test('hashTag trả null khi không có tag', () => {
  assert.equal(hashTag('lb:castle:daily'), null)
})
