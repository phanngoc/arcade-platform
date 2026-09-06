/**
 * arcade bench — sinh tải thật để trả lời kill criteria M1:
 *   CCU/vCPU ≥ 150 và tick p99 < 8ms.
 *
 * Nguyên tắc đo: server chạy trong TIẾN TRÌNH RIÊNG và CPU của nó được đo tách
 * khỏi bộ sinh tải. Đo chung một process thì con số vô nghĩa — client giả cũng
 * ngốn CPU, và ta sẽ tự lừa mình.
 */
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { WebSocket } from 'ws'

/** Mượn một port trống từ hệ điều hành. Máy dev có sẵn nginx/OrbStack/... chiếm
 *  đủ loại port cố định, và một port trùng làm bench báo lỗi rất khó hiểu. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port
      s.close(() => resolve(p))
    })
  })
}
import { apply, PROTOCOL_VERSION, type S2C } from '@arcade/protocol'

type Args = {
  game: string; rooms: number; playersPerRoom: number; seconds: number
  inputHz: number; port: number; warmupSec: number
}

function parseArgs(argv: string[]): Args {
  const get = (k: string, d: number) => {
    const i = argv.indexOf('--' + k)
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d
  }
  const gi = argv.indexOf('--game')
  return {
    game: gi >= 0 ? argv[gi + 1]! : 'tank-battle',
    rooms: get('rooms', 20),
    playersPerRoom: get('players', 4),
    seconds: get('seconds', 20),
    inputHz: get('input-hz', 10),
    port: get('port', 0),   // 0 = tự tìm port trống
    warmupSec: get('warmup', 3),
  }
}

/** %CPU của một pid, không cần thư viện ngoài. */
function cpuPercent(pid: number): number {
  try {
    const out = execFileSync('ps', ['-o', '%cpu=', '-p', String(pid)], { encoding: 'utf8' })
    return Number(out.trim()) || 0
  } catch { return 0 }
}
function rssMB(pid: number): number {
  try {
    const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' })
    return (Number(out.trim()) || 0) / 1024
  } catch { return 0 }
}

class BenchClient {
  ws: WebSocket
  state: unknown
  code: string | null = null
  bytesIn = 0
  joined = false
  err: string | null = null

  private token: string
  constructor(url: string, token: string) {
    this.token = token
    this.ws = new WebSocket(url)
    this.ws.on('message', (raw) => {
      this.bytesIn += (raw as Buffer).length
      const m = JSON.parse(String(raw)) as S2C
      if (m.t === 'welcome') { this.code = m.code; this.joined = true }
      else if (m.t === 'snap') this.state = m.s
      else if (m.t === 'patch') this.state = apply(this.state, m.ops)
      else if (m.t === 'ping') this.send({ t: 'pong', id: m.id })
      else if (m.t === 'err') this.err = m.code
    })
    this.ws.on('error', (e) => { this.err = e.message })
  }
  send(m: unknown) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)) }
  async open() {
    await new Promise<void>((r, j) => {
      const to = setTimeout(() => j(new Error('WS không mở được trong 10s')), 10000)
      this.ws.once('open', () => { clearTimeout(to); r() })
      this.ws.once('error', (e) => { clearTimeout(to); j(e) })
    })
    this.send({ t: 'hello', token: this.token, v: PROTOCOL_VERSION })
  }
  async waitJoin(ms = 10000) {
    const end = Date.now() + ms
    while (!this.joined && Date.now() < end) {
      if (this.err) throw new Error('client lỗi: ' + this.err)
      await new Promise((r) => setTimeout(r, 20))
    }
    if (!this.joined) throw new Error('không vào được phòng')
  }
  close() { this.ws.close() }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const a = parseArgs(argv)
  if (!a.port) a.port = await freePort()
  const base = `http://127.0.0.1:${a.port}`
  console.log(`▸ bench: ${a.rooms} phòng × ${a.playersPerRoom} người = ${a.rooms * a.playersPerRoom} CCU · game ${a.game} · ${a.seconds}s\n`)

  const child = spawn('node', ['--env-file=.env', 'packages/app/src/server.ts'], {
    env: { ...process.env, PORT: String(a.port), LOG_LEVEL: process.env.BENCH_LOG ?? 'warn' },
    stdio: [process.env.BENCH_LOG ? 'inherit' : 'ignore', process.env.BENCH_LOG ? 'inherit' : 'ignore', 'inherit'],
  })
  const stop = async () => { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)) }

  try {
    // chờ server sẵn sàng
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/health')).ok) break } catch { /* chưa lên */ }
      await new Promise((r) => setTimeout(r, 200))
    }

    const token = async () => {
      const r = await fetch(base + '/v1/auth/guest', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: a.game }),
      })
      if (!r.ok) throw new Error(`auth ${r.status}: ${await r.text()} — game "${a.game}" đã seed chưa?`)
      return (await r.json() as { accessToken: string }).accessToken
    }

    const wsUrl = `ws://127.0.0.1:${a.port}/ws`
    const clients: BenchClient[] = []
    console.log('▸ dựng phòng và người chơi…')
    for (let r = 0; r < a.rooms; r++) {
      const hostC = new BenchClient(wsUrl, await token())
      await hostC.open()
      hostC.send({ t: 'create', mode: 'coop', name: `h${r}` })
      await hostC.waitJoin()
      clients.push(hostC)
      for (let p = 1; p < a.playersPerRoom; p++) {
        const c = new BenchClient(wsUrl, await token())
        await c.open()
        c.send({ t: 'join', code: hostC.code, name: `p${r}-${p}` })
        await c.waitJoin()
        clients.push(c)
      }
    }
    console.log(`  ${clients.length} client đã vào phòng\n`)

    // input đều đặn, giống người chơi thật giữ phím
    const inputTimer = setInterval(() => {
      // dir phải là 0..3. (Bẫy cũ: Date.now()/500|0 tràn int32 -> số ÂM.)
      const dir = Math.floor(Math.random() * 4)
      for (const c of clients) c.send({ t: 'msg', n: 'input', d: { dir, moving: true, fire: Math.random() < 0.1 } })
    }, 1000 / a.inputHz)

    console.log(`▸ khởi động ${a.warmupSec}s (bỏ qua số đo)…`)
    await new Promise((r) => setTimeout(r, a.warmupSec * 1000))
    for (const c of clients) c.bytesIn = 0

    const t0 = Date.now()
    const cpuSamples: number[] = []
    const ticks: { p50: number; p99: number }[] = []
    for (let s = 0; s < a.seconds; s++) {
      await new Promise((r) => setTimeout(r, 1000))
      cpuSamples.push(cpuPercent(child.pid!))
      const text = await (await fetch(base + '/metrics')).text()
      if (s === 0 && process.env.BENCH_DEBUG) console.log('\n[metrics thô]\n' + text)
      const g = (k: string) => Number(/[\d.]+$/.exec(text.split('\n').find((l) => l.startsWith(k)) ?? '0')?.[0] ?? 0)
      ticks.push({ p50: g('arcade_tick_ms{quantile="0.5"}'), p99: g('arcade_tick_ms{quantile="0.99"}') })
      process.stdout.write(`  ${s + 1}/${a.seconds}s  cpu ${cpuSamples[s]!.toFixed(0)}%  p99 ${ticks[s]!.p99.toFixed(2)}ms\r`)
    }
    const wall = (Date.now() - t0) / 1000
    clearInterval(inputTimer)

    const bytes = clients.reduce((n, c) => n + c.bytesIn, 0)
    const ccu = clients.length
    const avgCpuPct = cpuSamples.reduce((x, y) => x + y, 0) / cpuSamples.length
    const cores = avgCpuPct / 100
    const p99 = Math.max(...ticks.map((t) => t.p99))
    const p50 = ticks.reduce((x, t) => x + t.p50, 0) / ticks.length
    const bytesPerCcuMin = bytes / ccu / (wall / 60)
    const ccuPerVcpu = cores > 0.01 ? ccu / cores : Infinity

    const errs = clients.filter((c) => c.err).length
    const errSample = [...new Set(clients.filter((c) => c.err).map((c) => c.err!))].slice(0, 3)
    for (const c of clients) c.close()

    console.log('\n\n' + '─'.repeat(58))
    console.log(`  CCU                    ${ccu}`)
    console.log(`  CPU server             ${avgCpuPct.toFixed(0)}%  (${cores.toFixed(2)} vCPU)`)
    console.log(`  RSS                    ${rssMB(child.pid!).toFixed(0)} MB`)
    console.log(`  tick p50 / p99         ${p50.toFixed(2)}ms / ${p99.toFixed(2)}ms`)
    console.log(`  băng thông             ${(bytesPerCcuMin / 1024).toFixed(1)} KB/CCU/phút`)
    console.log(`  client lỗi             ${errs}${errSample.length ? '  (' + errSample.join(', ') + ')' : ''}`)
    console.log('─'.repeat(58))
    console.log(`  CCU/vCPU               ${ccuPerVcpu.toFixed(0)}`)
    console.log('─'.repeat(58))

    // Một lần chạy không có lưu lượng, hoặc có client lỗi, là VÔ HIỆU — không
    // được phép kết luận "đạt". Công cụ đo báo đạt sai còn tệ hơn không đo.
    const invalid: string[] = []
    if (errs > 0) invalid.push(`${errs} client lỗi`)
    if (bytes === 0) invalid.push('không nhận được byte nào từ server')
    if (p50 === 0 && p99 === 0) invalid.push('server không báo tick nào')
    if (invalid.length) {
      console.log(`\n  ✗ LẦN CHẠY VÔ HIỆU: ${invalid.join('; ')}`)
      console.log('    Số liệu ở trên không dùng được. Sửa lỗi rồi đo lại.')
      await stop()
      process.exit(3)
    }

    const passCcu = ccuPerVcpu >= 150
    const passTick = p99 < 8
    console.log(`\n  kill criteria M1:`)
    console.log(`    CCU/vCPU ≥ 150       ${passCcu ? '✓' : '✗'}  (${ccuPerVcpu.toFixed(0)})`)
    console.log(`    tick p99 < 8ms       ${passTick ? '✓' : '✗'}  (${p99.toFixed(2)}ms)`)
    if (!passCcu || !passTick) {
      console.log(`\n  ✗ TRƯỢT — theo IMPLEMENTATION §6 việc 20: quay lại thiết kế state sync,`)
      console.log(`    KHÔNG tăng giá để bù.`)
    } else {
      console.log(`\n  ✓ ĐẠT`)
    }
    await stop()
    process.exit(passCcu && passTick ? 0 : 1)
  } catch (e) {
    console.error('\n✗ bench lỗi:', e instanceof Error ? e.message : e)
    await stop()
    process.exit(2)
  }
}

if (process.argv[1]?.endsWith('index.ts')) await main()
