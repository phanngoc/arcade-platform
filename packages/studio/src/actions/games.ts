// Thao tác trên hợp đồng của game: liệt kê, kiểm, đọc kịch bản (spec), manifest, dựng mới.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validateGame } from '@arcade/gamekit'
import { defineAction, ActionError } from '../action.ts'
import { scaffold, TEMPLATE_DIRS } from '../scaffold.ts'

const dirProp = { type: 'string', description: 'thư mục game (chứa arcade.toml / spec.json)' } as const

export function gameDir(dir: unknown): string {
  const d = resolve(String(dir))
  if (!existsSync(d) || !statSync(d).isDirectory()) throw new ActionError(`không có thư mục ${d}`)
  return d
}

export const gamesList = defineAction({
  name: 'games.list',
  description: 'Liệt kê các game trong một thư mục gốc (mỗi thư mục con có arcade.toml hoặc spec.json), kèm trạng thái hợp đồng: qua/không, số lỗi, mode, template.',
  input: { type: 'object', properties: { root: { type: 'string', description: 'thư mục chứa các game (vd GAMES_DIR)' } }, required: ['root'] },
  readOnly: true,
  run({ root }: { root: string }) {
    const r = gameDir(root)
    const out = []
    for (const name of readdirSync(r).sort()) {
      const d = join(r, name)
      let isDir = false
      try { isDir = statSync(d).isDirectory() } catch { /* symlink hỏng */ }
      if (!isDir || name.startsWith('.') || name === 'node_modules') continue
      if (!existsSync(join(d, 'arcade.toml')) && !existsSync(join(d, 'spec.json'))) continue
      const c = validateGame(d)
      out.push({
        id: c.manifest?.game.id ?? name,
        dir: d,
        ok: c.ok,
        errors: c.problems.filter((p) => p.level === 'error').length,
        warnings: c.problems.filter((p) => p.level === 'warning').length,
        mode: c.manifest?.runtime.mode ?? c.spec?.mode ?? null,
        template: c.spec?.template ?? null,
      })
    }
    return { root: r, games: out, passing: out.filter((g) => g.ok).length }
  },
})

export const specValidate = defineAction({
  name: 'spec.validate',
  description: 'Cổng G1 tĩnh: kiểm arcade.toml + spec.json của một game, từng file và chéo nhau. Trả về ok và danh sách lỗi/cảnh báo kèm vị trí.',
  input: { type: 'object', properties: { dir: dirProp }, required: ['dir'] },
  readOnly: true,
  run({ dir }: { dir: string }) {
    const c = validateGame(gameDir(dir))
    return { dir: c.dir, ok: c.ok, problems: c.problems }
  },
})

export const specGet = defineAction({
  name: 'spec.get',
  description: 'Đọc kịch bản của game (spec.json): vòng chơi, luật, điều kiện thắng/thua, điều khiển, balance — dạng JSON, kèm kết quả kiểm.',
  input: { type: 'object', properties: { dir: dirProp }, required: ['dir'] },
  readOnly: true,
  run({ dir }: { dir: string }) {
    const d = gameDir(dir)
    const p = join(d, 'spec.json')
    if (!existsSync(p)) throw new ActionError(`${d} chưa có spec.json`)
    const c = validateGame(d)
    let raw: unknown
    try { raw = JSON.parse(readFileSync(p, 'utf8')) } catch (e) { throw new ActionError(`spec.json không phải JSON: ${(e as Error).message}`) }
    return { spec: raw, ok: c.ok, problems: c.problems.filter((x) => x.where.startsWith('spec.json')) }
  },
})

export const manifestGet = defineAction({
  name: 'manifest.get',
  description: 'Manifest platform lưu cho game (sinh từ arcade.toml): mode, capability, giới hạn. Lỗi nếu arcade.toml không hợp lệ.',
  input: { type: 'object', properties: { dir: dirProp }, required: ['dir'] },
  readOnly: true,
  run({ dir }: { dir: string }) {
    const c = validateGame(gameDir(dir))
    if (!c.manifest) {
      throw new ActionError('arcade.toml không hợp lệ: ' + c.problems.filter((p) => p.where.startsWith('arcade.toml')).map((p) => `${p.where} — ${p.message}`).join('; '))
    }
    return c.manifest
  },
})

export const gameNew = defineAction({
  name: 'game.new',
  description: 'Dựng game mới từ template (Vite + TS): engine thuần, bot G3, SDK, cổng window.__game. Không truyền spec thì spec.json mang mốc __FILL__ và spec.validate chặn cho tới khi viết xong.',
  input: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'id kebab-case, cũng là tên thư mục' },
      parent: { type: 'string', description: 'thư mục cha để tạo game trong đó' },
      template: { type: 'string', description: 'template', enum: Object.keys(TEMPLATE_DIRS) },
      name: { type: 'string', description: 'tên hiển thị' },
      spec: { type: 'string', description: 'đường dẫn spec.json đã duyệt (khuyên dùng)' },
    },
    required: ['id', 'parent'],
  },
  readOnly: false,
  run(a: { id: string; parent: string; template?: string; name?: string; spec?: string }) {
    try {
      const r = scaffold({ id: a.id, parent: a.parent, template: a.template, name: a.name, spec: a.spec })
      return { ...r, next: r.specFilled ? ['npm install', 'npm test', 'npm run dev'] : ['viết spec.json (bỏ mọi __FILL__)', 'spec.validate', 'npm install && npm test'] }
    } catch (e) {
      throw new ActionError((e as Error).message)
    }
  },
})
