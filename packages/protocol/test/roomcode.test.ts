import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateCode, normalizeCode, CODE_LENGTH, CODE_SPACE } from '../src/roomcode.ts'

test('mã sinh ra đúng độ dài và không chứa ký tự dễ nhầm', () => {
  for (let i = 0; i < 5000; i++) {
    const c = generateCode()
    assert.equal(c.length, CODE_LENGTH)
    for (const ch of c) assert.ok(!'01OILZS28'.includes(ch), `ký tự dễ nhầm: ${ch} trong ${c}`)
  }
})

test('chuẩn hoá: hoa hoá, bỏ khoảng trắng và gạch', () => {
  assert.equal(normalizeCode('k3f9'), 'K3F9')
  assert.equal(normalizeCode(' K3-F9 '), 'K3F9')
})

test('từ chối ký tự ngoài bảng chữ thay vì đoán', () => {
  // Đoán O -> 0 sẽ đưa người chơi vào đúng một phòng khác. Báo lỗi tốt hơn.
  assert.equal(normalizeCode('K3FO'), null)
  assert.equal(normalizeCode('K3F1'), null)
  assert.equal(normalizeCode('K3F'), null)
  assert.equal(normalizeCode('K3F9X'), null)
})

test('không gian mã đủ lớn cho quy mô M1', () => {
  assert.ok(CODE_SPACE > 300000, `chỉ có ${CODE_SPACE} mã`)
})
