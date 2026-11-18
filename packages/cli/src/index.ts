#!/usr/bin/env node
// arcade — CLI. Mục tiêu: một máy sạch chạy được toàn bộ stack bằng một lệnh.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, copyFileSync } from 'node:fs'
import { validateGame, formatCheck } from '@arcade/gamekit'

const cmd = process.argv[2] ?? 'help'
const rest = process.argv.slice(3)

function run(bin: string, args: string[], opts: { quiet?: boolean } = {}) {
  const r = spawnSync(bin, args, { stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8' })
  if (r.status !== 0 && !opts.quiet) process.exit(r.status ?? 1)
  return r
}

async function waitHealthy(url: string, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return true } catch { /* chưa lên */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

switch (cmd) {
  case 'dev': {
    if (!existsSync('.env')) { copyFileSync('.env.example', '.env'); console.log('✓ tạo .env từ .env.example') }
    console.log('▸ dựng Postgres + Redis…')
    run('docker', ['compose', 'up', '-d', '--wait'])
    console.log('▸ chạy migration…')
    run('node', ['--env-file=.env', 'scripts/migrate.ts'])
    console.log('▸ build SDK…')
    run('node', ['packages/sdk/build.ts'])
    console.log('▸ khởi động server (Ctrl-C để dừng)…\n')
    const p = spawn('node', ['--env-file=.env', '--watch', 'packages/app/src/server.ts'], { stdio: 'inherit' })
    process.on('SIGINT', () => { p.kill('SIGTERM'); process.exit(0) })
    break
  }

  case 'migrate':
    run('node', ['--env-file=.env', 'scripts/migrate.ts'])
    break

  case 'test': {
    // Cùng thước đo với Forge: người thật và agent bị chấm giống nhau.
    console.log('▸ G1 tĩnh: luật phụ thuộc + typecheck')
    run('node', ['scripts/lint-deps.ts'])
    run('npx', ['tsc', '-p', 'tsconfig.json', '--noEmit'])
    console.log('▸ G1 tĩnh: ngân sách kích thước SDK')
    run('node', ['packages/sdk/build.ts'])
    console.log('▸ G2/G3/G4: test tích hợp trên Postgres + Redis thật')
    // Đường dẫn file tường minh: truyền thư mục thì node:test treo chờ event loop.
    run('node', ['--env-file=.env', '--test', ...rest.length ? rest : [
      'packages/protocol/test/patch.test.ts',
      'packages/protocol/test/roomcode.test.ts',
      'packages/gamekit/test/gamekit.test.ts',
      'packages/core/test/redis-keys.test.ts',
      'packages/services/test/api.test.ts',
      'packages/services/test/hub.test.ts',
      'packages/roomd/test/realtime.test.ts',
    ]])
    console.log('\n✓ tất cả cổng đã qua')
    break
  }

  case 'bench':
    // Công cụ duy nhất trả lời được kill criteria M1. Chạy server ở tiến trình
    // riêng để CPU của nó tách khỏi bộ sinh tải.
    run('node', ['--env-file=.env', 'packages/bench/src/index.ts', ...rest])
    break

  case 'down':
    run('docker', ['compose', 'down'])
    break

  case 'health': {
    const url = `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 8090}/health`
    console.log(await waitHealthy(url, 5000) ? `✓ ${url}` : `✗ ${url} không phản hồi`)
    break
  }

  case 'spec': {
    // Cổng G1 tĩnh của MỘT GAME: arcade.toml + spec.json, từng file và chéo nhau.
    // Không cần DB hay browser — là thứ chạy đầu tiên, ở CI và ở agent.
    const sub = rest[0]
    if (sub !== 'validate') { console.error('dùng: arcade spec validate [thư-mục-game…] [--json]'); process.exit(2) }
    const json = rest.includes('--json')
    const dirs = rest.slice(1).filter((a) => a !== '--json')
    const checks = (dirs.length ? dirs : ['.']).map((d) => validateGame(d))
    if (json) console.log(JSON.stringify(checks.map(({ dir, ok, problems }) => ({ dir, ok, problems })), null, 2))
    else {
      for (const c of checks) console.log(formatCheck(c))
      const bad = checks.filter((c) => !c.ok).length
      console.log(`\n${checks.length - bad}/${checks.length} game qua`)
    }
    process.exit(checks.every((c) => c.ok) ? 0 : 1)
  }

  case 'manifest': {
    // Thứ games.manifest trong DB phải chứa — sinh từ arcade.toml, không chép tay.
    const c = validateGame(rest[0] ?? '.')
    if (!c.manifest) { console.error(formatCheck(c)); process.exit(1) }
    console.log(JSON.stringify(c.manifest, null, 2))
    break
  }

  default:
    console.log(`arcade — CLI

  arcade dev      dựng Postgres+Redis, migrate, build SDK, chạy server (watch)
  arcade migrate  chỉ chạy migration
  arcade test     G1 (lint deps, typecheck, ngân sách SDK) + G2/G3/G4 (tích hợp)
  arcade bench    sinh tải, in CCU/vCPU + p99 tick + băng thông (kill criteria M1)
  arcade health   kiểm tra server có sống không
  arcade down     tắt Postgres + Redis

  arcade spec validate [dir…] [--json]  kiểm arcade.toml + spec.json của game (G1 tĩnh)
  arcade manifest [dir]                 in manifest (từ arcade.toml) mà platform lưu vào DB

  deploy/typegen: M2+`)
}
