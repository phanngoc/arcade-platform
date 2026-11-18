// `arcade new <id>` — dựng một game mới từ template (templates/ ở gốc repo).
//
// Một game mới ra đời ĐÃ đúng hợp đồng: arcade.toml hợp lệ, SDK + cầu nối, engine
// tách UI, test có bot. Thứ duy nhất nó không tự có là spec: không truyền --spec
// thì spec.json mang mốc __FILL__ và `arcade spec validate` chặn cho tới khi
// người/agent viết xong — bước Spec không bị nhảy qua bằng cách scaffold trước.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ID_RE, parseSpec, FILL, type Mode } from '@arcade/gamekit'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..') // packages/studio/src → gốc repo
const TEMPLATES = join(ROOT, 'templates')

export const TEMPLATE_DIRS: Record<string, { dir: string; mode: Mode; maxPlayers: number }> = {
  'vite-offline': { dir: 'vite-offline', mode: 'offline', maxPlayers: 1 },
  'vite-authoritative-mp': { dir: 'vite-authoritative-mp', mode: 'authoritative', maxPlayers: 4 },
}
const ALIASES: Record<string, string> = { offline: 'vite-offline', mp: 'vite-authoritative-mp', 'authoritative-mp': 'vite-authoritative-mp' }

export type NewOpts = { id: string; template?: string; name?: string; parent?: string; spec?: string; skipSdk?: boolean }

const TEXT = /\.(ts|js|mjs|json|html|css|md|toml)$|^gitignore$/

export function scaffold(o: NewOpts): { dest: string; template: string; specFilled: boolean } {
  if (!ID_RE.test(o.id)) throw new Error(`id "${o.id}" phải là kebab-case 2–48 ký tự`)

  let specText: string | null = null
  let specTemplate: string | undefined
  if (o.spec) {
    specText = readFileSync(o.spec, 'utf8')
    const r = parseSpec(specText)
    const errs = r.problems.filter((p) => p.level === 'error')
    if (!r.spec) throw new Error(`spec ${o.spec} chưa hợp lệ:\n` + errs.map((p) => `  ✗ ${p.where} — ${p.message}`).join('\n'))
    if (r.spec.id !== o.id) throw new Error(`spec có id "${r.spec.id}", khác "${o.id}"`)
    specTemplate = r.spec.template
  }

  const name = ALIASES[o.template ?? ''] ?? o.template ?? specTemplate ?? 'vite-offline'
  const t = TEMPLATE_DIRS[name]
  if (!t) throw new Error(`không có template "${name}" (có: ${Object.keys(TEMPLATE_DIRS).join(', ')})`)
  if (specTemplate && specTemplate !== name) throw new Error(`spec chọn template "${specTemplate}" nhưng lệnh chọn "${name}"`)

  const dest = resolve(o.parent ?? '.', o.id)
  if (existsSync(dest)) throw new Error(`${dest} đã có — không ghi đè`)
  mkdirSync(dest, { recursive: true })
  cpSync(join(TEMPLATES, '_base'), dest, { recursive: true })
  cpSync(join(TEMPLATES, t.dir), dest, { recursive: true })
  renameSync(join(dest, 'gitignore'), join(dest, '.gitignore'))

  const title = o.name ?? o.id.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')
  const vars: Record<string, string> = { __GAME_ID__: o.id, __GAME_NAME__: title, __TEMPLATE__: name }
  for (const f of walk(dest)) {
    if (!TEXT.test(f.split('/').pop()!)) continue
    const src = readFileSync(f, 'utf8')
    const out = src.replace(/__GAME_ID__|__GAME_NAME__|__TEMPLATE__/g, (m) => vars[m]!)
    if (out !== src) writeFileSync(f, out)
  }

  writeFileSync(join(dest, 'spec.json'), specText ?? JSON.stringify({
    id: o.id,
    title,
    genre: FILL + ' action-arcade | puzzle | turn-based | party',
    loop: FILL + ' một câu: người chơi làm gì, lặp lại thế nào',
    mode: t.mode,
    maxPlayers: t.maxPlayers,
    controls: { mobile: FILL, desktop: FILL },
    winCondition: FILL + ' đo được',
    loseCondition: FILL + ' đo được',
    template: name,
    balance: [{ param: FILL, constraint: FILL, why: FILL + ' sai thì game không chơi được vì…' }],
  }, null, 2) + '\n')

  if (!o.skipSdk) installSdk(dest)
  return { dest, template: name, specFilled: specText !== null }
}

/** SDK đã build (IIFE, gắn window.Arcade) → public/vendor/arcade.js của game. */
export function installSdk(dest: string): void {
  const r = spawnSync(process.execPath, [join(ROOT, 'packages/sdk/build.ts')], { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) throw new Error('build SDK lỗi:\n' + r.stdout + r.stderr)
  mkdirSync(join(dest, 'public/vendor'), { recursive: true })
  cpSync(join(ROOT, 'packages/sdk/dist/arcade.global.js'), join(dest, 'public/vendor/arcade.js'))
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

export function nextSteps(dest: string, specFilled: boolean): string {
  const rel = relative(process.cwd(), dest) || '.'
  return [
    `✓ ${dest}`,
    '',
    'Tiếp theo:',
    ...(specFilled ? [] : [`  1. Viết spec: sửa mọi mốc ${FILL} trong ${rel}/spec.json (stages/spec.md), rồi`]),
    `  ${specFilled ? 1 : 2}. node ${join(ROOT, 'packages/cli/src/index.ts')} spec validate ${rel}`,
    `  ${specFilled ? 2 : 3}. cd ${rel} && git init && npm install && npm test && npm run dev`,
  ].join('\n')
}
