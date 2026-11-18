// Sổ đăng ký thao tác — "mọi thứ là plugin" của Cordis/DSH, áp cho platform game:
// mỗi thao tác khai ĐÚNG MỘT LẦN (tên, schema vào, hàm chạy) và có ba mặt:
//   CLI       `arcade call <name> [json]`
//   MCP       `arcade mcp` — agent (claude/codex/opencode) gọi như tool
//   Studio UI mỗi nút là một action, gọi qua cùng sổ này
// Không mặt nào được tự viết logic riêng: thứ developer bấm được trong Studio
// thì agent gọi được qua MCP, và ngược lại. Thêm khả năng = thêm một action.

export type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'

export type Prop = { type: JsonType; description: string; enum?: readonly string[]; items?: { type: JsonType } }

export type InputSchema = { type: 'object'; properties: Record<string, Prop>; required?: readonly string[] }

export type Action<I = Record<string, unknown>, O = unknown> = {
  /** "nhóm.việc", vd spec.validate. MCP đổi '.' thành '_' (tên tool không cho dấu chấm). */
  name: string
  /** Một câu: làm gì, trả về gì — agent đọc câu này để chọn tool. */
  description: string
  input: InputSchema
  /** Chỉ đọc: không ghi file, không chạy thứ có tác dụng phụ. */
  readOnly: boolean
  run(args: I): O | Promise<O>
}

export class ActionError extends Error {}

const registry = new Map<string, Action>()

export function defineAction<I, O>(a: Action<I, O>): Action<I, O> {
  if (!/^[a-z]+(\.[a-z][a-zA-Z]*)+$/.test(a.name)) throw new Error(`tên action "${a.name}" phải dạng nhóm.việc`)
  if (registry.has(a.name)) throw new Error(`action "${a.name}" khai hai lần`)
  registry.set(a.name, a as unknown as Action)
  return a
}

export function actions(): Action[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function findAction(name: string): Action | undefined {
  return registry.get(name) ?? registry.get(name.replace(/_/g, '.'))
}

/** Kiểm args theo schema trước khi chạy: lỗi nói đúng khoá, không để hàm tự nổ giữa chừng. */
export function checkArgs(schema: InputSchema, args: unknown): string | null {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return 'tham số phải là một object'
  const a = args as Record<string, unknown>
  for (const k of schema.required ?? []) if (a[k] === undefined) return `thiếu "${k}"`
  for (const [k, v] of Object.entries(a)) {
    const p = schema.properties[k]
    if (!p) return `khoá lạ "${k}" (có: ${Object.keys(schema.properties).join(', ') || 'không'})`
    const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v
    const ok = p.type === t || (p.type === 'integer' && Number.isInteger(v)) || (p.type === 'number' && t === 'number')
    if (!ok) return `"${k}" phải là ${p.type}`
    if (p.enum && !p.enum.includes(v as string)) return `"${k}" phải là một trong: ${p.enum.join(', ')}`
  }
  return null
}

export async function callAction(name: string, args: unknown = {}): Promise<unknown> {
  const a = findAction(name)
  if (!a) throw new ActionError(`không có action "${name}" (có: ${actions().map((x) => x.name).join(', ')})`)
  const bad = checkArgs(a.input, args)
  if (bad) throw new ActionError(`${a.name}: ${bad}`)
  return a.run(args as Record<string, unknown>)
}
