// Art 2.5D: mô hình 3D (script bpy / .blend / .glb) → sprite sheet nhiều hướng nhìn,
// render bằng Blender headless (không cần mở giao diện). Đường chắc chắn cho agent;
// Blender MCP (plugin khai `blender`) là đường tương tác khi người mở Blender.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineAction, ActionError } from '../action.ts'
import { gameDir } from './games.ts'

const SCRIPT = fileURLToPath(new URL('../../blender/render_sprites.py', import.meta.url))
const MODELS = fileURLToPath(new URL('../../blender/models/', import.meta.url))

/** $BLENDER, rồi `blender` trong PATH, rồi bản cài macOS mặc định. */
export function findBlender(): string | null {
  const cands = [process.env.BLENDER, 'blender', '/Applications/Blender.app/Contents/MacOS/Blender'].filter(Boolean) as string[]
  for (const c of cands) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 30_000 })
    if (r.status === 0 && /Blender \d/.test(r.stdout)) return c
  }
  return null
}

export const blenderStatus = defineAction({
  name: 'blender.status',
  description: 'Blender có trên máy không (cần cho sprites.render — art 2.5D từ mô hình 3D), phiên bản, và các mô hình mẫu sẵn có (script bpy) để bắt đầu.',
  input: { type: 'object', properties: {} },
  readOnly: true,
  run() {
    const bin = findBlender()
    const version = bin ? /Blender ([\d.]+[^\n]*)/.exec(spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout)?.[1]?.trim() ?? null : null
    return {
      available: !!bin,
      binary: bin,
      version,
      samples: existsSync(MODELS) ? ['hero.py', 'crate.py'].filter((f) => existsSync(join(MODELS, f))).map((f) => join(MODELS, f)) : [],
      hint: bin ? null : 'cài Blender ≥ 4.2 (macOS: /Applications/Blender.app) hoặc đặt BLENDER=<đường dẫn>',
    }
  },
})

export const spritesRender = defineAction({
  name: 'sprites.render',
  description: 'Render mô hình 3D (script bpy .py / .blend / .glb / .gltf / .fbx / .obj) thành sprite sheet 2.5D bằng Blender headless: camera trực giao isometric, N hướng × M khung animation, nền trong suốt, kèm atlas JSON có điểm neo chân. Ghi vào public/sprites/<name>.png|json của game.',
  input: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: 'thư mục game' },
      model: { type: 'string', description: 'file mô hình; đường dẫn tương đối tính từ thư mục game' },
      name: { type: 'string', description: 'tên sprite (kebab-case) → public/sprites/<name>.png' },
      size: { type: 'integer', description: 'px mỗi khung, mặc định 128' },
      directions: { type: 'integer', description: '1 | 4 | 8 hướng nhìn, mặc định 8' },
      frames: { type: 'array', description: '[đầu, cuối, bước] khung animation; bỏ trống = 1 khung', items: { type: 'integer' } },
      camera: { type: 'string', description: 'góc nhìn', enum: ['dimetric', 'isometric', 'side', 'top'] },
      engine: { type: 'string', description: 'renderer', enum: ['eevee', 'cycles', 'workbench'] },
      fps: { type: 'integer', description: 'fps animation ghi vào atlas, mặc định 12' },
    },
    required: ['dir', 'model', 'name'],
  },
  readOnly: false,
  run(a: { dir: string; model: string; name: string; size?: number; directions?: number; frames?: number[]; camera?: string; engine?: string; fps?: number }) {
    const d = gameDir(a.dir)
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(a.name)) throw new ActionError('name phải kebab-case')
    const model = resolve(d, a.model)
    if (!existsSync(model)) throw new ActionError(`không có mô hình ${model}`)
    if (!['.py', '.blend', '.glb', '.gltf', '.fbx', '.obj'].includes(extname(model).toLowerCase())) throw new ActionError('model phải là .py/.blend/.glb/.gltf/.fbx/.obj')
    const size = a.size ?? 128
    if (size < 16 || size > 1024) throw new ActionError('size trong 16..1024')
    if (a.frames && (a.frames.length < 2 || a.frames.length > 3)) throw new ActionError('frames = [đầu, cuối] hoặc [đầu, cuối, bước]')
    const bin = findBlender()
    if (!bin) throw new ActionError('không thấy Blender — chạy blender.status để biết cách cài')
    const out = join(d, 'public/sprites', `${a.name}.png`)
    const job = { model, out, size, directions: a.directions ?? 8, frames: a.frames ?? null, camera: a.camera ?? 'dimetric', engine: a.engine ?? 'eevee', fps: a.fps ?? 12 }
    const t0 = Date.now()
    const r = spawnSync(bin, ['-b', '--factory-startup', '-P', SCRIPT, '--', JSON.stringify(job)], { encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 64 << 20 })
    const log = `${r.stdout}\n${r.stderr}`
    if (r.status !== 0 || !/\[sprites\] OK/.test(log)) {
      const tail = log.split('\n').filter((l) => /Error|error|Traceback|sprites|exit|File "/.test(l)).slice(-15).join('\n')
      throw new ActionError(`Blender lỗi (exit ${r.status}${r.signal ? ', ' + r.signal : ''}):\n${tail || log.slice(-2000)}`)
    }
    const atlas = JSON.parse(readFileSync(join(d, 'public/sprites', `${a.name}.json`), 'utf8'))
    return { ...atlas, image: relative(d, out), atlas: relative(d, out.replace(/\.png$/, '.json')), seconds: Math.round((Date.now() - t0) / 100) / 10 }
  },
})
