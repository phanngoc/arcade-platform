import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diff, apply, checksum, canonical, snapshot, round, type Op } from '../src/patch.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Property test: hợp đồng apply(prev, diff(prev,next)) === next.
// 10.000 cặp state ngẫu nhiên trong CI. Đây là cổng chặn quan trọng nhất của M1:
// diff sai làm client lệch server âm thầm, và bug chỉ lộ sau nhiều phút chơi.
// ─────────────────────────────────────────────────────────────────────────────

// PRNG có seed để lần chạy nào cũng tái lập được khi CI đỏ.
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function genValue(rnd: () => number, depth: number): unknown {
  const r = rnd()
  if (depth <= 0 || r < 0.42) {
    const k = rnd()
    if (k < 0.3) return Math.floor(rnd() * 2000) - 1000              // int
    if (k < 0.55) return (rnd() * 2000 - 1000)                        // float
    if (k < 0.7) return rnd() < 0.5                                   // bool
    if (k < 0.85) return Math.random().toString(36).slice(2, 8)       // string
    if (k < 0.93) return null
    return 0
  }
  if (r < 0.72) {
    const n = Math.floor(rnd() * 6)
    return Array.from({ length: n }, () => genValue(rnd, depth - 1))
  }
  const n = Math.floor(rnd() * 6)
  const o: Record<string, unknown> = {}
  for (let i = 0; i < n; i++) {
    // ~12% key local (`_`) để test luôn luật không-diff.
    const key = (rnd() < 0.12 ? '_' : '') + 'k' + Math.floor(rnd() * 8)
    o[key] = genValue(rnd, depth - 1)
  }
  return o
}

/** Đột biến state: giống cách game thật thay đổi state giữa hai tick. */
function mutate(v: unknown, rnd: () => number, depth = 3): unknown {
  if (rnd() < 0.15 || depth <= 0) return genValue(rnd, 2)
  if (Array.isArray(v)) {
    const a = v.slice()
    const k = rnd()
    if (k < 0.3 && a.length) a[Math.floor(rnd() * a.length)] = mutate(a[Math.floor(rnd() * a.length)], rnd, depth - 1)
    else if (k < 0.55) a.push(genValue(rnd, 1))               // thêm cuối (đường thường của game)
    else if (k < 0.75 && a.length) a.pop()                     // xoá cuối
    else if (k < 0.85 && a.length) a.splice(Math.floor(rnd() * a.length), 1)  // xoá giữa (đường xấu)
    else if (a.length) a[0] = mutate(a[0], rnd, depth - 1)
    return a
  }
  if (v !== null && typeof v === 'object') {
    const o = { ...(v as Record<string, unknown>) }
    const keys = Object.keys(o)
    const k = rnd()
    if (k < 0.4 && keys.length) {
      const key = keys[Math.floor(rnd() * keys.length)]!
      o[key] = mutate(o[key], rnd, depth - 1)
    } else if (k < 0.7) {
      o['k' + Math.floor(rnd() * 8)] = genValue(rnd, 2)
    } else if (keys.length) {
      delete o[keys[Math.floor(rnd() * keys.length)]!]
    }
    return o
  }
  if (typeof v === 'number') return v + (rnd() - 0.5) * 10
  if (typeof v === 'boolean') return !v
  return genValue(rnd, 1)
}

/** So sánh sau khi chuẩn hoá: diff cố ý bỏ key local và làm tròn số thực. */
function assertEquivalent(got: unknown, want: unknown, msg: string) {
  assert.equal(canonical(got), canonical(want), msg)
}

test('property: apply(prev, diff(prev,next)) tương đương next — 10.000 cặp', () => {
  const rnd = mulberry32(0xa2c4de)
  let totalOps = 0, worstOps = 0
  for (let i = 0; i < 10000; i++) {
    const prev = genValue(rnd, 3)
    const next = mutate(structuredClone(prev), rnd)
    const ops = diff(prev, next)
    totalOps += ops.length
    if (ops.length > worstOps) worstOps = ops.length
    const got = apply(structuredClone(prev), ops)
    assertEquivalent(got, next, `lệch ở cặp #${i}\nprev=${canonical(prev)}\nnext=${canonical(next)}\nops=${JSON.stringify(ops)}`)
    assert.equal(checksum(got), checksum(next), `checksum lệch ở cặp #${i}`)
  }
  console.log(`      (trung bình ${(totalOps / 10000).toFixed(2)} op/cặp, nhiều nhất ${worstOps})`)
})

test('property: state không đổi thì sinh 0 op — tick tĩnh phải tốn 0 băng thông', () => {
  const rnd = mulberry32(7)
  for (let i = 0; i < 2000; i++) {
    const v = genValue(rnd, 3)
    assert.deepEqual(diff(snapshot(v), snapshot(structuredClone(v))), [])
  }
})

// ── Các trường hợp cụ thể, đọc được ──────────────────────────────────────────

test('set / delete key của object', () => {
  assert.deepEqual(diff({ a: 1 }, { a: 2 }), [{ o: 's', p: ['a'], v: 2 }])
  assert.deepEqual(diff({ a: 1, b: 2 }, { a: 1 }), [{ o: 'd', p: ['b'] }])
  assert.deepEqual(diff({ a: 1 }, { a: 1, b: 3 }), [{ o: 's', p: ['b'], v: 3 }])
})

test('mảng: thêm cuối và xoá cuối dùng op splice, không gửi lại cả mảng', () => {
  assert.deepEqual(diff([1, 2], [1, 2, 3]), [{ o: 'i', p: [], i: 2, v: [3] }])
  assert.deepEqual(diff([1, 2, 3], [1, 2]), [{ o: 'r', p: [], i: 2, n: 1 }])
})

test('mảng: xoá giữa thì tốn nhiều op — đánh đổi đã biết của việc không dùng LCS', () => {
  const ops = diff([1, 2, 3, 4], [1, 3, 4])
  assert.equal(apply([1, 2, 3, 4], ops).join(), '1,3,4')
  assert.ok(ops.length >= 2, 'xoá giữa mảng phải sinh nhiều op — đây là giới hạn có chủ đích')
})

test('đổi kiểu thì thay cả nhánh', () => {
  assert.deepEqual(diff({ a: { b: 1 } }, { a: [1] }), [{ o: 's', p: ['a'], v: [1] }])
  assert.deepEqual(diff({ a: [1] }, { a: 5 }), [{ o: 's', p: ['a'], v: 5 }])
})

test('số thực: chênh lệch dưới 3 chữ số thập phân KHÔNG sinh op', () => {
  assert.deepEqual(diff({ x: 1.00001 }, { x: 1.00002 }), [])
  assert.deepEqual(diff({ x: 1.0 }, { x: 1.002 }), [{ o: 's', p: ['x'], v: 1.002 }])
  assert.equal(round(12.3456789), 12.346)
})

test('key local (`_`) không bao giờ được diff hay gửi đi', () => {
  assert.deepEqual(diff({ a: 1, _cache: 1 }, { a: 1, _cache: 999 }), [])
  assert.deepEqual(diff({ a: 1 }, { a: 1, _tmp: { big: 'x'.repeat(1000) } }), [])
  assert.equal(canonical({ a: 1, _c: 2 }), '{"a":1}')
})

test('set ở gốc: phải dùng giá trị apply trả về', () => {
  const ops: Op[] = diff({ a: 1 }, [1, 2])
  assert.deepEqual(apply<unknown>({ a: 1 }, ops), [1, 2])
})

test('checksum: bỏ qua key local, độc lập thứ tự key, nhạy với giá trị', () => {
  assert.equal(checksum({ a: 1, b: 2 }), checksum({ b: 2, a: 1 }))
  assert.equal(checksum({ a: 1, _x: 1 }), checksum({ a: 1, _x: 2 }))
  assert.notEqual(checksum({ a: 1 }), checksum({ a: 2 }))
})

test('state kiểu game: chỉ đổi 1 viên đạn thì patch nhỏ', () => {
  const prev = {
    phase: 'play', stage: 1,
    tanks: { p1: { x: 96, y: 400, dir: 'up', lives: 3 }, p2: { x: 200, y: 400, dir: 'down', lives: 2 } },
    bullets: [{ x: 100, y: 380, vy: -300 }, { x: 210, y: 420, vy: 300 }],
    eagle: { hp: 1 },
  }
  const next = structuredClone(prev)
  next.bullets[0]!.y = 350
  const ops = diff(prev, next)
  assert.deepEqual(ops, [{ o: 's', p: ['bullets', 0, 'y'], v: 350 }])
  assert.ok(JSON.stringify(ops).length < 60, 'patch cho một thay đổi nhỏ phải nhỏ')
})
