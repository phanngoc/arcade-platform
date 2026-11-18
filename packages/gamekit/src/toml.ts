// TOML vừa đủ cho arcade.toml — không phụ thuộc gói ngoài (repo này zero-dep).
//
// Hỗ trợ: [bảng], khoá = chuỗi "..." / '...', số nguyên, số thực, true/false,
// mảng các giá trị đó (một dòng hoặc nhiều dòng), comment #.
// KHÔNG hỗ trợ (báo lỗi rõ ràng thay vì đoán): inline table, dotted key,
// [[mảng bảng]], chuỗi nhiều dòng, ngày giờ. arcade.toml không cần chúng; nếu
// một ngày cần thì lỗi ở đây nói đúng chỗ phải mở rộng.

export type TomlValue = string | number | boolean | TomlValue[]
export type TomlTable = Record<string, TomlValue | Record<string, TomlValue>>

export class TomlError extends Error {
  line: number
  constructor(line: number, msg: string) {
    super(`dòng ${line}: ${msg}`)
    this.line = line
  }
}

export function parseToml(src: string): TomlTable {
  const root: TomlTable = {}
  let table: Record<string, TomlValue> = root as Record<string, TomlValue>
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const no = i + 1
    let line = stripComment(lines[i] ?? '', no).trim()
    if (line === '') continue
    if (line.startsWith('[[')) throw new TomlError(no, 'không hỗ trợ [[mảng bảng]]')
    if (line.startsWith('[')) {
      const m = /^\[\s*([A-Za-z0-9_-]+)\s*\]$/.exec(line)
      if (!m) throw new TomlError(no, `tên bảng không hợp lệ: ${line}`)
      const name = m[1]!
      if (name in root) throw new TomlError(no, `bảng [${name}] khai báo hai lần`)
      table = {}
      root[name] = table
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) throw new TomlError(no, `thiếu "=": ${line}`)
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new TomlError(no, `khoá không hợp lệ (dotted/quoted key không hỗ trợ): ${key}`)
    if (key in table) throw new TomlError(no, `khoá "${key}" khai báo hai lần`)
    let raw = line.slice(eq + 1).trim()
    // Mảng nhiều dòng: gom tới khi ngoặc cân bằng.
    if (raw.startsWith('[')) {
      while (!balanced(raw) && i + 1 < lines.length) {
        i++
        raw += ' ' + stripComment(lines[i] ?? '', i + 1).trim()
      }
      if (!balanced(raw)) throw new TomlError(no, 'mảng không đóng ngoặc')
    }
    const [value, restAt] = parseValue(raw, 0, no)
    if (raw.slice(restAt).trim() !== '') throw new TomlError(no, `thừa ký tự sau giá trị: ${raw.slice(restAt).trim()}`)
    table[key] = value
  }
  return root
}

function stripComment(line: string, no: number): string {
  let q: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '\\' && q === '"') { i++; continue }
      if (c === q) q = null
    } else if (c === '"' || c === "'") {
      if (line.startsWith(c.repeat(3), i)) throw new TomlError(no, 'không hỗ trợ chuỗi nhiều dòng')
      q = c
    } else if (c === '#') return line.slice(0, i)
  }
  return line
}

function balanced(s: string): boolean {
  let depth = 0
  let q: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '\\' && q === '"') { i++; continue }
      if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
    else if (c === '[') depth++
    else if (c === ']') depth--
  }
  return depth === 0
}

function parseValue(s: string, at: number, no: number): [TomlValue, number] {
  while (s[at] === ' ' || s[at] === '\t') at++
  const c = s[at]
  if (c === '"') {
    let out = ''
    for (let i = at + 1; i < s.length; i++) {
      const ch = s[i]!
      if (ch === '"') return [out, i + 1]
      if (ch === '\\') {
        const e = s[++i]
        const map: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\', r: '\r' }
        if (e === 'u') { out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; continue }
        if (e === undefined || !(e in map)) throw new TomlError(no, `escape không hợp lệ: \\${e ?? ''}`)
        out += map[e]
        continue
      }
      out += ch
    }
    throw new TomlError(no, 'chuỗi không đóng ngoặc kép')
  }
  if (c === "'") {
    const end = s.indexOf("'", at + 1)
    if (end < 0) throw new TomlError(no, 'chuỗi không đóng nháy đơn')
    return [s.slice(at + 1, end), end + 1]
  }
  if (c === '[') {
    const arr: TomlValue[] = []
    let i = at + 1
    for (;;) {
      while (/[\s,]/.test(s[i] ?? '')) i++
      if (s[i] === ']') return [arr, i + 1]
      if (i >= s.length) throw new TomlError(no, 'mảng không đóng ngoặc')
      const [v, next] = parseValue(s, i, no)
      arr.push(v)
      i = next
      while (s[i] === ' ' || s[i] === '\t') i++
      if (s[i] !== ',' && s[i] !== ']') throw new TomlError(no, `mảng thiếu dấu phẩy gần: ${s.slice(i, i + 10)}`)
    }
  }
  if (c === '{') throw new TomlError(no, 'không hỗ trợ inline table')
  const m = /^(true|false|[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/.exec(s.slice(at))
  if (!m) throw new TomlError(no, `giá trị không hợp lệ: ${s.slice(at)}`)
  const tok = m[1]!
  if (tok === 'true' || tok === 'false') return [tok === 'true', at + tok.length]
  if (/^\d{4}-/.test(s.slice(at))) throw new TomlError(no, 'không hỗ trợ ngày giờ')
  return [Number(tok.replace(/_/g, '')), at + tok.length]
}
