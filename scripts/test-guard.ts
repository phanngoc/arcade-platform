// Chạy trước mọi test chạm DB: từ chối nếu môi trường trỏ vào dữ liệu thật.
// Test tạo và XOÁ người chơi/game/điểm — trên DB thật nó đã để lại 26 người chơi
// ma trên bảng castle/standard và làm kẹt write-behind 5 ngày (13–18/11/2026).
// Quy tắc: database phải tên *_test, Redis phải là db ≠ 0.
const db = process.env.DATABASE_URL ?? ''
const rd = process.env.REDIS_URL ?? ''
const dbName = (() => { try { return new URL(db).pathname.slice(1) } catch { return '' } })()
const redisDb = (() => { try { return Number(new URL(rd).pathname.slice(1) || '0') } catch { return 0 } })()

const bad: string[] = []
if (!dbName.endsWith('_test')) bad.push(`DATABASE_URL trỏ vào database "${dbName || '?'}" — phải là *_test`)
if (!(redisDb >= 1)) bad.push(`REDIS_URL dùng db ${redisDb} — test phải dùng db ≥ 1`)
if (bad.length) {
  console.error('✗ từ chối chạy test trên dữ liệu có thể là thật:\n  ' + bad.join('\n  ') +
    '\n  Dùng --env-file=.env.test (npm test đã làm vậy); chuẩn bị DB test: npm run test:setup')
  process.exit(1)
}
export {}
