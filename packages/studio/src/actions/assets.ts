// Resource của game: ảnh, âm thanh, font, dữ liệu — kích thước, có được dùng
// không, và bundle đã build chiếm bao nhiêu % ngân sách bundle_bytes.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, basename } from 'node:path'
import { validateGame } from '@arcade/gamekit'
import { defineAction } from '../action.ts'
import { gameDir } from './games.ts'

const KINDS: Record<string, string> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.svg': 'image', '.avif': 'image',
  '.mp3': 'audio', '.ogg': 'audio', '.wav': 'audio', '.m4a': 'audio', '.webm': 'audio',
  '.woff': 'font', '.woff2': 'font', '.ttf': 'font', '.otf': 'font',
  '.json': 'data', '.atlas': 'data', '.tmj': 'data', '.glb': 'model', '.gltf': 'model',
}
const SKIP = new Set(['node_modules', 'dist', '.git', 'tests', 'test', 'docs', 'scripts', 'vendor'])
const CODE = /\.(ts|tsx|js|mjs|html|css|json)$/
// Những file "data" là cấu hình của chính repo, không phải resource của game.
const NOT_ASSET = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'spec.json'])

function walk(dir: string, skip: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    if (e.startsWith('.') || skip(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p, skip))
    else out.push(p)
  }
  return out
}

export const assetsList = defineAction({
  name: 'assets.list',
  description: 'Resource của game (ảnh, âm thanh, font, dữ liệu): kích thước, loại, có được code tham chiếu không (asset thừa), và dist/ chiếm bao nhiêu % ngân sách bundle_bytes.',
  input: { type: 'object', properties: { dir: { type: 'string', description: 'thư mục game' } }, required: ['dir'] },
  readOnly: true,
  run({ dir }: { dir: string }) {
    const d = gameDir(dir)
    const files = walk(d, (n) => SKIP.has(n))
    const code = files.filter((f) => CODE.test(f)).map((f) => [f, readFileSync(f, 'utf8')] as const)
    const assets = files
      .filter((f) => KINDS[extname(f).toLowerCase()] && !NOT_ASSET.has(basename(f)))
      .map((f) => {
        const name = basename(f)
        return {
          path: relative(d, f),
          kind: KINDS[extname(f).toLowerCase()]!,
          bytes: statSync(f).size,
          // Tên file có trong một file code/HTML/CSS/JSON KHÁC. Heuristic: tên ghép
          // động (`hero_${i}.png`) sẽ bị báo "không dùng" nhầm — xem lại trước khi xoá.
          referenced: code.some(([g, text]) => g !== f && text.includes(name)),
        }
      })
      .sort((a, b) => b.bytes - a.bytes)
    const byKind: Record<string, { count: number; bytes: number }> = {}
    for (const a of assets) {
      const k = (byKind[a.kind] ??= { count: 0, bytes: 0 })
      k.count++
      k.bytes += a.bytes
    }
    const c = validateGame(d)
    const budget = c.manifest?.limits.bundle_bytes ?? null
    const client = c.manifest?.game.client_dir
    const clientDir = client ? join(d, client) : null
    const built = clientDir && existsSync(clientDir) ? walk(clientDir, () => false).reduce((s, f) => s + statSync(f).size, 0) : null
    return {
      dir: d,
      assets,
      byKind,
      totalBytes: assets.reduce((s, a) => s + a.bytes, 0),
      unreferenced: assets.filter((a) => !a.referenced).map((a) => a.path),
      bundle: { budgetBytes: budget, builtBytes: built, percent: budget && built !== null ? Math.round((built / budget) * 1000) / 10 : null },
    }
  },
})
