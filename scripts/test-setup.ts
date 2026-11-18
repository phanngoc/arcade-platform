// Tạo database test (nếu chưa có) rồi chạy migration lên nó. Chạy với .env.test:
//   npm run test:setup
import { spawnSync } from 'node:child_process'
import postgres from 'postgres'

await import('./test-guard.ts')
const url = new URL(process.env.DATABASE_URL!)
const name = url.pathname.slice(1)
const admin = new URL(url)
admin.pathname = '/postgres'
const sql = postgres(admin.toString(), { onnotice: () => {} })
const [exists] = await sql`select 1 from pg_database where datname = ${name}`
if (!exists) {
  await sql.unsafe(`create database "${name.replace(/"/g, '')}"`)
  console.log(`✓ tạo database ${name}`)
}
await sql.end()
const r = spawnSync(process.execPath, ['scripts/migrate.ts'], { stdio: 'inherit', env: process.env })
process.exit(r.status ?? 1)
