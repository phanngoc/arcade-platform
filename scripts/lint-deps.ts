/**
 * Ép luật phụ thuộc: services/ (stateless) và roomd/ (stateful) KHÔNG được
 * import lẫn nhau. Chỉ app/ được import cả hai — và app/ chính là thứ bị xoá
 * ở M2 khi tách deployable.
 *
 * Nếu một import xuyên biên giới lọt qua, việc tách ở M2 biến thành viết lại.
 * Đó là lý do luật này nằm trong CI chứ không nằm trong tài liệu.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RULES: { from: string; forbidden: string[] }[] = [
  { from: 'packages/services', forbidden: ['@arcade/roomd', '@arcade/app'] },
  { from: 'packages/roomd', forbidden: ['@arcade/services', '@arcade/app'] },
  { from: 'packages/core', forbidden: ['@arcade/services', '@arcade/roomd', '@arcade/app'] },
  { from: 'packages/protocol', forbidden: ['@arcade/core', '@arcade/services', '@arcade/roomd', '@arcade/app'] },
  { from: 'packages/sdk', forbidden: ['@arcade/core', '@arcade/services', '@arcade/roomd', '@arcade/app'] },
]

function walk(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out = out.concat(walk(p))
    else if (p.endsWith('.ts') || p.endsWith('.js')) out.push(p)
  }
  return out
}

let bad = 0
for (const rule of RULES) {
  for (const file of walk(rule.from)) {
    const src = readFileSync(file, 'utf8')
    for (const forbidden of rule.forbidden) {
      const re = new RegExp(`from\\s+['"]${forbidden}`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        const line = src.slice(0, m.index).split('\n').length
        console.error(`✗ ${file}:${line} — ${rule.from} không được import ${forbidden}`)
        bad++
      }
    }
  }
}
if (bad) { console.error(`\n${bad} vi phạm luật phụ thuộc`); process.exit(1) }
console.log('✓ luật phụ thuộc: không có import xuyên biên giới')
