// Thiết kế gameplay: số cân bằng, ràng buộc, đường cong độ khó, bot chơi thử,
// phát lại một ván — đọc từ src/studio.ts của game (hợp đồng studio-contract.ts
// trong template). config.set là thao tác ghi duy nhất: sửa một hằng số trong
// config.ts — cùng một hàm cho slider của Studio và cho agent ở bước iterate.

import { build } from 'esbuild'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { defineAction, ActionError } from '../action.ts'
import { gameDir } from './games.ts'

type Shape = { kind: 'rect' | 'circle'; x: number; y: number; w?: number; h?: number; r?: number; color: string; label?: string }
type Frame = { t: number; shapes: Shape[]; hud?: Record<string, string | number> }
type Run = { seed: number; won: boolean; seconds: number; score: number; frames?: Frame[] }
export type GameStudio = {
  world: { w: number; h: number }
  config: Record<string, number>
  balance: readonly { param: string; ok: boolean; why: string }[]
  curves: { id: string; label: string; unit: string; x: { label: string; from: number; to: number; step: number }; f: (x: number) => number }[]
  simulate(seed: number, opts?: { record?: number; maxSeconds?: number }): Run
}

const ENTRY = 'src/studio.ts'

/**
 * Nạp src/studio.ts của game trong Node: esbuild gói nó (cùng engine/config) thành
 * một file ESM rồi import. Gói lại mỗi lần gọi — config.set vừa sửa số thì lần
 * đọc sau phải thấy số mới, không được lấy bản cache.
 */
export async function loadStudio(dir: string): Promise<GameStudio> {
  const entry = join(dir, ENTRY)
  if (!existsSync(entry)) {
    throw new ActionError(`${dir} chưa có ${ENTRY} — game dựng từ \`arcade new\` có sẵn; game cũ cần thêm (xem templates/*/src/studio.ts)`)
  }
  const out = mkdtempSync(join(tmpdir(), 'arcade-studio-'))
  try {
    const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', target: 'node22', write: false, logLevel: 'silent' })
    const file = join(out, 'studio.mjs')
    writeFileSync(file, r.outputFiles[0]!.text)
    const mod = (await import(pathToFileURL(file).href)) as { studio?: GameStudio }
    const s = mod.studio
    if (!s || typeof s.simulate !== 'function' || !s.world || !s.config) {
      throw new ActionError(`${ENTRY} phải export \`studio\` theo studio-contract.ts (world, config, balance, curves, simulate)`)
    }
    return s
  } catch (e) {
    if (e instanceof ActionError) throw e
    const errs = (e as { errors?: { text: string; location?: { file: string; line: number } }[] }).errors
    if (errs?.length) throw new ActionError(`${ENTRY} không build được: ` + errs.map((x) => `${x.location ? `${x.location.file}:${x.location.line} ` : ''}${x.text}`).join('; '))
    throw new ActionError(`${ENTRY} lỗi khi nạp: ${(e as Error).message}`)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

const dirProp = { type: 'string', description: 'thư mục game' } as const

export const balanceCheck = defineAction({
  name: 'balance.check',
  description: 'Số cân bằng thật của game (mọi hằng số config.ts) và từng ràng buộc balance có đạt không, đối chiếu với spec.json → balance (ràng buộc nào spec có mà code không kiểm, và ngược lại).',
  input: { type: 'object', properties: { dir: dirProp }, required: ['dir'] },
  readOnly: true,
  async run({ dir }: { dir: string }) {
    const d = gameDir(dir)
    const s = await loadStudio(d)
    let specParams: string[] = []
    try {
      const spec = JSON.parse(readFileSync(join(d, 'spec.json'), 'utf8')) as { balance?: { param?: string }[] }
      specParams = Array.isArray(spec.balance) ? spec.balance.map((b) => String(b.param ?? '')) : []
    } catch { /* spec thiếu/hỏng: spec.validate nói chuyện đó */ }
    const codeParams = s.balance.map((b) => b.param)
    return {
      ok: s.balance.every((b) => b.ok),
      config: s.config,
      balance: s.balance.map((b) => ({ ...b, inSpec: specParams.includes(b.param) })),
      // spec hứa mà code không kiểm: ràng buộc đó chỉ nằm trên giấy.
      specOnly: specParams.filter((p) => p && !codeParams.includes(p)),
    }
  },
})

export const curvesGet = defineAction({
  name: 'curves.get',
  description: 'Đường cong độ khó của game (tốc độ, mật độ… theo thời gian hoặc màn), đã lấy mẫu thành điểm [x, y] để vẽ hoặc so sánh trước/sau khi chỉnh số.',
  input: { type: 'object', properties: { dir: dirProp }, required: ['dir'] },
  readOnly: true,
  async run({ dir }: { dir: string }) {
    const s = await loadStudio(gameDir(dir))
    return {
      curves: s.curves.map((c) => {
        const points: [number, number][] = []
        for (let x = c.x.from; x <= c.x.to + 1e-9; x += c.x.step) points.push([+x.toFixed(6), +c.f(x).toFixed(6)])
        return { id: c.id, label: c.label, unit: c.unit, xLabel: c.x.label, points }
      }),
    }
  },
})

export const botSimulate = defineAction({
  name: 'bot.simulate',
  description: 'Cho bot của game chơi nhiều ván (mỗi seed một ván, tất định): tỉ lệ thắng, thời gian mỗi ván, điểm. Dùng để biết game có thắng được không và khó cỡ nào sau khi chỉnh số.',
  input: {
    type: 'object',
    properties: {
      dir: dirProp,
      seeds: { type: 'integer', description: 'số ván (mặc định 20, tối đa 200)' },
      from: { type: 'integer', description: 'seed đầu (mặc định 1)' },
    },
    required: ['dir'],
  },
  readOnly: true,
  async run({ dir, seeds = 20, from = 1 }: { dir: string; seeds?: number; from?: number }) {
    if (seeds < 1 || seeds > 200) throw new ActionError('seeds phải trong 1..200')
    const s = await loadStudio(gameDir(dir))
    const t0 = performance.now()
    const runs = []
    for (let seed = from; seed < from + seeds; seed++) {
      const r = s.simulate(seed)
      runs.push({ seed, won: r.won, seconds: +r.seconds.toFixed(2), score: r.score })
    }
    const won = runs.filter((r) => r.won).length
    return { winRate: +(won / runs.length).toFixed(3), won, total: runs.length, ms: Math.round(performance.now() - t0), runs }
  },
})

export const botReplay = defineAction({
  name: 'bot.replay',
  description: 'Phát lại một ván bot theo seed: khung hình (hình khối trong toạ độ thế giới + HUD) mỗi `every` giây — để xem bot làm gì và chết ở đâu.',
  input: {
    type: 'object',
    properties: {
      dir: dirProp,
      seed: { type: 'integer', description: 'seed của ván' },
      every: { type: 'number', description: 'giây giữa hai khung hình (mặc định 0.1)' },
    },
    required: ['dir', 'seed'],
  },
  readOnly: true,
  async run({ dir, seed, every = 0.1 }: { dir: string; seed: number; every?: number }) {
    if (!(every >= 1 / 60) || every > 5) throw new ActionError('every phải trong 1/60..5 giây')
    const s = await loadStudio(gameDir(dir))
    const r = s.simulate(seed, { record: every })
    return { world: s.world, seed, won: r.won, seconds: +r.seconds.toFixed(2), score: r.score, frames: r.frames ?? [] }
  },
})

/** Tìm file config chứa `export const NAME = <số>` trong src/ (config.ts hoặc shared/config.ts). */
function findConfig(dir: string, name: string): { file: string; text: string; re: RegExp } {
  const files: string[] = []
  const walk = (p: string) => {
    for (const e of readdirSync(p)) {
      const f = join(p, e)
      if (statSync(f).isDirectory()) walk(f)
      else if (e === 'config.ts') files.push(f)
    }
  }
  if (existsSync(join(dir, 'src'))) walk(join(dir, 'src'))
  const re = new RegExp(`^(export const ${name}\\s*=\\s*)(-?[\\d_.]+(?:e-?\\d+)?)(\\s*;.*)$`, 'm')
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (re.test(text)) return { file, text, re }
  }
  throw new ActionError(`không thấy \`export const ${name} = <số>\` trong src/**/config.ts`)
}

export const configSet = defineAction({
  name: 'config.set',
  description: 'Sửa một hằng số cân bằng trong config.ts của game (giữ comment đơn vị), rồi kiểm lại ràng buộc balance với số mới. Nhớ cập nhật spec.json cùng commit nếu ràng buộc đổi.',
  input: {
    type: 'object',
    properties: {
      dir: dirProp,
      name: { type: 'string', description: 'tên hằng số, vd PLAYER_SPEED' },
      value: { type: 'number', description: 'giá trị mới' },
    },
    required: ['dir', 'name', 'value'],
  },
  readOnly: false,
  async run({ dir, name, value }: { dir: string; name: string; value: number }) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new ActionError('name phải là HẰNG_SỐ viết hoa')
    if (!Number.isFinite(value)) throw new ActionError('value phải là số hữu hạn')
    const d = gameDir(dir)
    const { file, text, re } = findConfig(d, name)
    const old = Number(re.exec(text)![2]!.replace(/_/g, ''))
    writeFileSync(file, text.replace(re, `$1${value}$3`))
    try {
      const s = await loadStudio(d)
      return {
        file: relative(d, file),
        name,
        old,
        value,
        balance: s.balance,
        ok: s.balance.every((b) => b.ok),
        note: 'spec.json → balance phải khớp số mới (stages/iterate.md); chạy lại bot.simulate để xem game còn thắng được không',
      }
    } catch (e) {
      writeFileSync(file, text) // số mới làm game không nạp được: trả lại như cũ
      throw e
    }
  },
})
