/**
 * State diff/patch — trái tim kỹ thuật của tầng realtime.
 *
 * Hợp đồng: `apply(prev, diff(prev, next))` phải deep-equal `next`, và checksum
 * hai bên phải khớp. Nếu vi phạm, client và server lệch nhau âm thầm và bug chỉ
 * lộ ra sau nhiều phút chơi — nên có property test 10.000 cặp state trong CI.
 *
 * Ba quyết định và lý do:
 *  - Object so theo key, ARRAY SO THEO CHỈ SỐ (không LCS). LCS cho kết quả patch
 *    nhỏ hơn khi chèn giữa mảng, nhưng O(n·m) mỗi tick là không trả nổi ở 30Hz.
 *    Đổi lại: game phải giữ thứ tự mảng ổn định (thêm/xoá ở cuối), nếu không thì
 *    patch to bằng cả mảng. Ghi rõ trong tài liệu cho người viết game.
 *  - Số thực làm tròn 3 chữ số thập phân TRƯỚC khi so. Vị trí pixel không cần
 *    hơn, và đây là cách giảm băng thông rẻ nhất: bỏ nhiễu ở cuối mantissa
 *    khiến vô số "thay đổi" biến mất hoàn toàn.
 *  - Key bắt đầu bằng `_` là local-only: không diff, không gửi. Chỗ để game nhét
 *    cache/đối tượng tạm vào state mà không tốn băng thông.
 */

export type Path = (string | number)[]
export type Op =
  | { o: 's'; p: Path; v: unknown }                    // set
  | { o: 'd'; p: Path }                                 // delete key của object
  | { o: 'i'; p: Path; i: number; v: unknown[] }         // chèn vào mảng tại i
  | { o: 'r'; p: Path; i: number; n: number }            // xoá n phần tử của mảng từ i

const PRECISION = 1000   // 3 chữ số thập phân

export function round(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return n
  return Math.round(n * PRECISION) / PRECISION
}

const isLocal = (k: string) => k.charCodeAt(0) === 95 /* '_' */
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Chuẩn hoá giá trị để gửi đi: làm tròn số, bỏ key local. */
function normalize(v: unknown): unknown {
  if (typeof v === 'number') return round(v)
  if (Array.isArray(v)) return v.map(normalize)
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v)) if (!isLocal(k)) out[k] = normalize(v[k])
    return out
  }
  return v
}

function sameLeaf(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    // NaN !== NaN nhưng với state game thì coi hai NaN là không đổi,
    // nếu không mỗi tick sẽ sinh một op vô nghĩa.
    if (Number.isNaN(a) && Number.isNaN(b)) return true
    return round(a) === round(b)
  }
  return a === b
}

export function diff(prev: unknown, next: unknown, path: Path = [], out: Op[] = []): Op[] {
  if (prev === next) return out

  const pArr = Array.isArray(prev), nArr = Array.isArray(next)
  const pObj = isPlainObject(prev), nObj = isPlainObject(next)

  // Đổi kiểu (object -> mảng, mảng -> số, ...) thì thay cả nhánh.
  if ((pArr !== nArr) || (pObj !== nObj)) {
    out.push({ o: 's', p: path, v: normalize(next) })
    return out
  }

  if (pArr && nArr) {
    const a = prev as unknown[], b = next as unknown[]
    const min = Math.min(a.length, b.length)
    for (let i = 0; i < min; i++) diff(a[i], b[i], [...path, i], out)
    if (b.length > a.length) {
      out.push({ o: 'i', p: path, i: a.length, v: b.slice(a.length).map(normalize) })
    } else if (a.length > b.length) {
      out.push({ o: 'r', p: path, i: b.length, n: a.length - b.length })
    }
    return out
  }

  if (pObj && nObj) {
    const a = prev, b = next
    for (const k of Object.keys(b)) {
      if (isLocal(k)) continue
      if (!(k in a)) out.push({ o: 's', p: [...path, k], v: normalize(b[k]) })
      else diff(a[k], b[k], [...path, k], out)
    }
    for (const k of Object.keys(a)) {
      if (isLocal(k)) continue
      if (!(k in b)) out.push({ o: 'd', p: [...path, k] })
    }
    return out
  }

  if (!sameLeaf(prev, next)) out.push({ o: 's', p: path, v: normalize(next) })
  return out
}

type Container = Record<string, unknown> | unknown[]

function resolve(root: unknown, path: Path): Container | undefined {
  let cur: unknown = root
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[seg]
  }
  return cur === null || typeof cur !== 'object' ? undefined : (cur as Container)
}

/**
 * Áp patch, mutate tại chỗ. Trả về state mới — cần dùng giá trị trả về vì
 * op `set` ở gốc (path rỗng) không thể mutate mà phải thay cả object.
 */
export function apply<T>(state: T, ops: Op[]): T {
  let root: unknown = state
  for (const op of ops) {
    if (op.p.length === 0) {
      if (op.o === 's') { root = op.v; continue }
      if (op.o === 'i' && Array.isArray(root)) { (root as unknown[]).splice(op.i, 0, ...op.v); continue }
      if (op.o === 'r' && Array.isArray(root)) { (root as unknown[]).splice(op.i, op.n); continue }
      continue
    }
    if (op.o === 'i' || op.o === 'r') {
      const arr = resolve(root, op.p)
      if (!Array.isArray(arr)) continue
      if (op.o === 'i') arr.splice(op.i, 0, ...op.v)
      else arr.splice(op.i, op.n)
      continue
    }
    const parent = resolve(root, op.p.slice(0, -1))
    if (!parent) continue
    const last = op.p[op.p.length - 1]!
    if (op.o === 's') (parent as Record<string | number, unknown>)[last] = op.v
    else if (Array.isArray(parent)) parent.splice(Number(last), 1)
    else delete (parent as Record<string, unknown>)[last as string]
  }
  return root as T
}

/**
 * FNV-1a trên JSON đã chuẩn hoá (key sort, số làm tròn, bỏ key local).
 * Dùng để client phát hiện lệch state và xin lại snapshot — không dùng cho
 * mục đích bảo mật.
 */
export function checksum(v: unknown): number {
  const s = canonical(v)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return h >>> 0
}

export function canonical(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'number') return Number.isFinite(v) ? String(round(v)) : 'null'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o).filter((k) => !isLocal(k)).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
  }
  return 'null'   // undefined / function: không gửi được, coi như null
}

/** Bản sao sâu, đã chuẩn hoá — dùng làm prevState sau mỗi lần diff. */
export function snapshot<T>(v: T): T {
  return normalize(v) as T
}

export function opsBytes(ops: Op[]): number {
  return ops.length === 0 ? 0 : Buffer.byteLength(JSON.stringify(ops), 'utf8')
}
