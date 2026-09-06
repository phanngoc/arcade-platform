// Migration runner ~50 dòng: file SQL đánh số, chạy đúng một lần, trong transaction.
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const url = process.env.DATABASE_URL ?? 'postgres://arcade:arcade@127.0.0.1:55432/arcade'
const sql = postgres(url, { onnotice: () => {} })

await sql`create table if not exists _migrations (
  name text primary key, applied_at timestamptz not null default now()
)`

const done = new Set((await sql`select name from _migrations`).map((r) => r.name as string))
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

let applied = 0
for (const f of files) {
  if (done.has(f)) continue
  const body = readFileSync(join(dir, f), 'utf8')
  await sql.begin(async (tx) => {
    await tx.unsafe(body)
    await tx`insert into _migrations (name) values (${f})`
  })
  console.log(`✓ ${f}`)
  applied++
}
console.log(applied ? `${applied} migration đã chạy` : 'không có migration mới')
await sql.end()
