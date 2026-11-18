// GameSpec v1 — spec.json của một game: thứ duyệt trước khi viết code, và là
// nguồn playtest sinh test case (stages/spec.md trong plugin game-studio).
//
// Khác manifest: manifest là thứ PLATFORM cần để chạy game; spec là thứ NGƯỜI
// và playtest cần để biết game đúng hay sai. Hai file chồng nhau ở id/mode và
// validate() kiểm chúng khớp nhau.
//
// Khoá ngoài v1 chỉ là cảnh báo: spec là tài liệu, một game được phép ghi thêm
// (acceptance, features…). Nhưng các khoá bắt buộc thì bắt buộc — thiếu
// winCondition thì playtest không có gì để kiểm.

import { ID_RE, MODES, type Mode, type Problem } from './manifest.ts'

export const GENRES = ['action-arcade', 'puzzle', 'turn-based', 'party'] as const
export const TEMPLATES = ['canvas2d-offline', 'canvas2d-authoritative-mp', 'turn-based-mp', 'party-relay'] as const

export type BalanceRule = { param: string; constraint: string; why: string; value?: string | number }

export type GameSpec = {
  $schema?: string
  id: string
  title: string
  genre: (typeof GENRES)[number]
  loop: string
  mode: Mode
  maxPlayers: number
  controls: { mobile: string; desktop: string }
  winCondition: string
  loseCondition: string
  template: string
  balance: BalanceRule[]
  entities?: { name: string; props: string[] }[]
  rules?: string[]
  artDirection?: string
  features?: string[]
  acceptance?: Record<string, unknown>
}

const KNOWN = new Set([
  '$schema', 'id', 'title', 'genre', 'loop', 'mode', 'maxPlayers', 'controls', 'winCondition', 'loseCondition',
  'template', 'balance', 'entities', 'rules', 'artDirection', 'features', 'acceptance',
])

export function parseSpec(src: string): { spec?: GameSpec; problems: Problem[] } {
  const problems: Problem[] = []
  const err = (where: string, message: string) => problems.push({ level: 'error', where, message })
  const warn = (where: string, message: string) => problems.push({ level: 'warning', where, message })
  let d: Record<string, unknown>
  try {
    const v = JSON.parse(src)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('phải là một object JSON')
    d = v
  } catch (e) {
    err('spec.json', `JSON không hợp lệ: ${(e as Error).message}`)
    return { problems }
  }
  const str = (k: string) => {
    if (typeof d[k] !== 'string' || (d[k] as string).trim() === '') err(k, 'bắt buộc, chuỗi khác rỗng')
  }
  for (const k of ['id', 'title', 'loop', 'winCondition', 'loseCondition', 'template']) str(k)
  if (typeof d.id === 'string' && !ID_RE.test(d.id)) err('id', `"${d.id}" phải là kebab-case`)
  if (!GENRES.includes(d.genre as never)) err('genre', `phải là một trong: ${GENRES.join(', ')}`)
  if (!MODES.includes(d.mode as never)) err('mode', `phải là một trong: ${MODES.join(', ')}`)
  if (typeof d.template === 'string' && d.template && !TEMPLATES.includes(d.template as never)) {
    warn('template', `"${d.template}" không phải template đã biết (${TEMPLATES.join(', ')})`)
  }
  const mp = d.maxPlayers
  if (typeof mp !== 'number' || !Number.isInteger(mp) || mp < 1) err('maxPlayers', 'bắt buộc, số nguyên ≥ 1')
  else if (d.mode === 'offline' && mp !== 1) err('maxPlayers', 'mode offline thì maxPlayers phải là 1')
  else if ((d.mode === 'authoritative' || d.mode === 'relay') && mp < 2) err('maxPlayers', `mode ${d.mode} cần maxPlayers ≥ 2 — một người thì dùng offline`)

  const c = d.controls as Record<string, unknown> | undefined
  if (typeof c !== 'object' || c === null || Array.isArray(c)) err('controls', 'bắt buộc: { mobile, desktop }')
  else for (const k of ['mobile', 'desktop']) {
    if (typeof c[k] !== 'string' || (c[k] as string).trim() === '') err(`controls.${k}`, 'bắt buộc — người chơi thật vào bằng điện thoại')
  }

  // balance: mỗi ràng buộc mà sai thì game KHÔNG THỂ chơi được. Rỗng là lỗi —
  // bài học castle (sát thương pháo < HP gạch, bắn cả trận HP không giảm).
  const b = d.balance
  if (!Array.isArray(b)) err('balance', 'bắt buộc: mảng { param, constraint, why } — dạng object không sinh được test')
  else if (b.length === 0) err('balance', 'không được rỗng: ghi ít nhất một ràng buộc mà sai thì game không chơi được')
  else b.forEach((r: unknown, i) => {
    const rr = r as Record<string, unknown>
    for (const k of ['param', 'constraint', 'why']) {
      if (typeof rr?.[k] !== 'string' || (rr[k] as string).trim() === '') err(`balance[${i}].${k}`, 'bắt buộc')
    }
  })

  for (const [k, kind] of [['rules', 'string'], ['features', 'string']] as const) {
    const v = d[k]
    if (v !== undefined && (!Array.isArray(v) || v.some((x) => typeof x !== kind))) err(k, 'phải là mảng chuỗi')
  }
  if (d.entities !== undefined) {
    const ok = Array.isArray(d.entities) && d.entities.every((e: Record<string, unknown>) =>
      typeof e?.name === 'string' && Array.isArray(e.props) && e.props.every((p) => typeof p === 'string'))
    if (!ok) err('entities', 'phải là mảng { name, props: string[] }')
  }
  for (const k of Object.keys(d)) if (!KNOWN.has(k)) warn(k, 'khoá ngoài GameSpec v1 — được giữ, nhưng playtest không đọc nó')

  if (problems.some((p) => p.level === 'error')) return { problems }
  return { spec: d as unknown as GameSpec, problems }
}
