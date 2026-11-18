// arcade.toml → manifest. Đây là hợp đồng giữa một game và platform: thứ
// platform đọc (games.manifest trong DB) phải đến từ đây, không chép tay vào
// seed SQL — chép tay là cách toml và DB trôi khỏi nhau.
//
// Khoá lạ là LỖI, không phải cảnh báo: `leaderbord = [...]` gõ sai thì game
// mất bảng xếp hạng mà không ai biết. Thêm một khoá mới = thêm vào SCHEMA ở
// dưới, cùng chỗ platform đọc nó.

import { parseToml, TomlError, type TomlTable } from './toml.ts'

export const MODES = ['offline', 'authoritative', 'relay'] as const
export type Mode = (typeof MODES)[number]

export type Manifest = {
  game: {
    id: string
    name: string
    version: string
    engine: 'canvas2d' | 'dom' | 'webgl'
    orientation: 'portrait' | 'landscape' | 'any'
    client_dir?: string
    tagline?: string
  }
  runtime: {
    mode: Mode
    tick_rate?: number
    max_players?: number
    idle_timeout_sec?: number
    reconnect_window_sec?: number
  }
  capabilities: {
    save?: boolean
    leaderboard?: string[]
  }
  limits: {
    bundle_bytes?: number
    state_bytes?: number
    msg_per_sec?: number
    cpu_ms_per_tick?: number
  }
}

export type Problem = { level: 'error' | 'warning'; where: string; message: string }

type Field =
  | { t: 'string'; required?: boolean; enum?: readonly string[]; pattern?: RegExp; hint?: string }
  | { t: 'int'; required?: boolean; min?: number; max?: number }
  | { t: 'bool'; required?: boolean }
  | { t: 'strings'; pattern?: RegExp }

export const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const BOARD = /^[a-z0-9_-]{1,32}$/

// Một nguồn: bảng này vừa kiểm tra vừa là tài liệu của arcade.toml.
export const SCHEMA: Record<keyof Manifest, Record<string, Field>> = {
  game: {
    id: { t: 'string', required: true, pattern: ID_RE, hint: 'kebab-case, 2–48 ký tự' },
    name: { t: 'string', required: true },
    version: { t: 'string', required: true, pattern: SEMVER, hint: 'semver, vd 1.0.0' },
    engine: { t: 'string', required: true, enum: ['canvas2d', 'dom', 'webgl'] },
    orientation: { t: 'string', required: true, enum: ['portrait', 'landscape', 'any'] },
    client_dir: { t: 'string', pattern: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+$/, hint: 'đường dẫn tương đối trong repo game, không có ..' },
    tagline: { t: 'string' },
  },
  runtime: {
    mode: { t: 'string', required: true, enum: MODES },
    tick_rate: { t: 'int', min: 1, max: 60 },
    max_players: { t: 'int', min: 1, max: 64 },
    idle_timeout_sec: { t: 'int', min: 5, max: 3600 },
    reconnect_window_sec: { t: 'int', min: 0, max: 600 },
  },
  capabilities: {
    save: { t: 'bool' },
    leaderboard: { t: 'strings', pattern: BOARD },
  },
  limits: {
    bundle_bytes: { t: 'int', min: 1, max: 50 * 1024 * 1024 },
    state_bytes: { t: 'int', min: 1 },
    msg_per_sec: { t: 'int', min: 1 },
    cpu_ms_per_tick: { t: 'int', min: 1 },
  },
}

// Chỉ có nghĩa khi có phòng: game offline mang chúng là dấu hiệu chép nhầm template.
const ROOM_ONLY = ['tick_rate', 'max_players', 'idle_timeout_sec', 'reconnect_window_sec']

export function parseManifest(src: string): { manifest?: Manifest; problems: Problem[] } {
  const problems: Problem[] = []
  const err = (where: string, message: string) => problems.push({ level: 'error', where, message })
  let doc: TomlTable
  try {
    doc = parseToml(src)
  } catch (e) {
    err('arcade.toml', e instanceof TomlError ? e.message : String(e))
    return { problems }
  }
  for (const k of Object.keys(doc)) {
    if (!(k in SCHEMA)) err(k, `bảng hoặc khoá không biết: [${k}] (có: ${Object.keys(SCHEMA).join(', ')})`)
  }
  const out: Record<string, Record<string, unknown>> = {}
  for (const [tname, fields] of Object.entries(SCHEMA)) {
    const t = doc[tname]
    if (t !== undefined && (typeof t !== 'object' || Array.isArray(t))) {
      err(tname, `[${tname}] phải là một bảng`)
      continue
    }
    const table = (t ?? {}) as Record<string, unknown>
    out[tname] = {}
    for (const k of Object.keys(table)) {
      if (!(k in fields)) err(`${tname}.${k}`, `khoá không biết (có: ${Object.keys(fields).join(', ')})`)
    }
    for (const [k, f] of Object.entries(fields)) {
      const where = `${tname}.${k}`
      const v = table[k]
      if (v === undefined) {
        if ('required' in f && f.required) err(where, 'bắt buộc')
        continue
      }
      const bad = checkField(f, v)
      if (bad) err(where, bad)
      else out[tname]![k] = v
    }
  }
  const runtime = out.runtime as Manifest['runtime'] | undefined
  if (runtime?.mode === 'offline') {
    for (const k of ROOM_ONLY) {
      if (k in runtime) problems.push({ level: 'warning', where: `runtime.${k}`, message: 'game offline không có phòng — khoá này không có tác dụng' })
    }
  }
  if (runtime?.mode && runtime.mode !== 'offline' && runtime.max_players === undefined) {
    problems.push({ level: 'warning', where: 'runtime.max_players', message: `mode ${runtime.mode} nên khai max_players (mặc định của platform có thể không hợp game)` })
  }
  if (problems.some((p) => p.level === 'error')) return { problems }
  return { manifest: out as unknown as Manifest, problems }
}

function checkField(f: Field, v: unknown): string | null {
  switch (f.t) {
    case 'string':
      if (typeof v !== 'string' || v === '') return 'phải là chuỗi khác rỗng'
      if (f.enum && !f.enum.includes(v)) return `"${v}" không hợp lệ (một trong: ${f.enum.join(', ')})`
      if (f.pattern && !f.pattern.test(v)) return `"${v}" không hợp lệ${f.hint ? ` (${f.hint})` : ''}`
      return null
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v)) return 'phải là số nguyên'
      if (f.min !== undefined && v < f.min) return `phải ≥ ${f.min}`
      if (f.max !== undefined && v > f.max) return `phải ≤ ${f.max}`
      return null
    case 'bool':
      return typeof v === 'boolean' ? null : 'phải là true/false'
    case 'strings':
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return 'phải là mảng chuỗi'
      if (new Set(v).size !== v.length) return 'có phần tử trùng'
      if (f.pattern) {
        const badOne = (v as string[]).find((x) => !f.pattern!.test(x))
        if (badOne !== undefined) return `"${badOne}" không hợp lệ`
      }
      return null
  }
}
