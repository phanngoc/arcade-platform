#!/usr/bin/env node
// arcade — CLI. Mục tiêu: một máy sạch chạy được toàn bộ stack bằng một lệnh.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, copyFileSync } from 'node:fs'

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
      'packages/core/test/redis-keys.test.ts',
      'packages/services/test/api.test.ts',
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

  default:
    console.log(`arcade — CLI

  arcade dev      dựng Postgres+Redis, migrate, build SDK, chạy server (watch)
  arcade migrate  chỉ chạy migration
  arcade test     G1 (lint deps, typecheck, ngân sách SDK) + G2/G3/G4 (tích hợp)
  arcade bench    sinh tải, in CCU/vCPU + p99 tick + băng thông (kill criteria M1)
  arcade health   kiểm tra server có sống không
  arcade down     tắt Postgres + Redis

  deploy/typegen: M2+`)
}
