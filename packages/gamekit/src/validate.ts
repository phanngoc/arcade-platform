// Kiểm một thư mục game: arcade.toml + spec.json, từng file và chéo nhau.
// Đây là phần "tĩnh" của cổng G1 — chạy được không cần DB, không cần browser,
// nên là thứ đầu tiên CI và agent chạy.

import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseManifest, type Manifest, type Problem } from './manifest.ts'
import { parseSpec, type GameSpec } from './spec.ts'

export type GameCheck = {
  dir: string
  manifest?: Manifest
  spec?: GameSpec
  problems: Problem[]
  ok: boolean
}

export function validateGame(dir: string): GameCheck {
  dir = resolve(dir)
  const problems: Problem[] = []
  const at = (file: string, ps: Problem[]) => ps.map((p) => ({ ...p, where: `${file}: ${p.where}` }))

  let manifest: Manifest | undefined
  const tomlPath = join(dir, 'arcade.toml')
  if (!existsSync(tomlPath)) problems.push({ level: 'error', where: 'arcade.toml', message: 'không có — platform không biết chạy game này thế nào' })
  else {
    const r = parseManifest(readFileSync(tomlPath, 'utf8'))
    manifest = r.manifest
    problems.push(...at('arcade.toml', r.problems))
  }

  let spec: GameSpec | undefined
  const specPath = join(dir, 'spec.json')
  if (!existsSync(specPath)) problems.push({ level: 'error', where: 'spec.json', message: 'không có — playtest không có gì để kiểm (tạo theo stages/spec.md)' })
  else {
    const r = parseSpec(readFileSync(specPath, 'utf8'))
    spec = r.spec
    problems.push(...at('spec.json', r.problems))
  }

  if (manifest && spec) {
    const x = (message: string) => problems.push({ level: 'error', where: 'spec.json ↔ arcade.toml', message })
    if (spec.id !== manifest.game.id) x(`id khác nhau: "${spec.id}" vs "${manifest.game.id}"`)
    if (spec.mode !== manifest.runtime.mode) x(`mode khác nhau: "${spec.mode}" vs "${manifest.runtime.mode}"`)
    const mp = manifest.runtime.max_players
    if (mp !== undefined && mp !== spec.maxPlayers) x(`maxPlayers ${spec.maxPlayers} vs runtime.max_players ${mp}`)
  }

  if (manifest) {
    // Platform phục vụ GAMES_DIR/<id>/: thư mục khác tên id thì /g/<id>/ trống.
    if (basename(dir) !== manifest.game.id) {
      problems.push({ level: 'warning', where: 'thư mục', message: `tên "${basename(dir)}" khác id "${manifest.game.id}" — trong GAMES_DIR nó phải trùng id` })
    }
    const client = manifest.game.client_dir ?? '.'
    const index = join(dir, client, 'index.html')
    if (!existsSync(index)) {
      problems.push(client === '.'
        ? { level: 'error', where: 'client', message: 'không có index.html ở gốc (hoặc khai game.client_dir)' }
        : { level: 'warning', where: 'client', message: `${client}/index.html chưa có — chưa build?` })
    }
  }

  return { dir, manifest, spec, problems, ok: !problems.some((p) => p.level === 'error') }
}

export function formatCheck(c: GameCheck): string {
  const head = `${c.ok ? '✓' : '✗'} ${c.manifest?.game.id ?? basename(c.dir)}  (${c.dir})`
  const lines = c.problems.map((p) => `  ${p.level === 'error' ? '✗' : '!'} ${p.where} — ${p.message}`)
  return [head, ...lines].join('\n')
}
