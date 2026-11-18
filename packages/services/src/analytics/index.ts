// Google Analytics 4 cho platform.
//  - Trình duyệt: chèn gtag.js vào mọi trang HTML mà bundle server trả ra
//    (Measurement ID là giá trị PUBLIC).
//  - Server: chuyển tiếp telemetry (/v1/events: start, win, …) sang
//    Measurement Protocol. GA_API_SECRET là SECRET, chỉ dùng ở server.
// Cả hai khoá chỉ đọc từ biến môi trường; thiếu khoá thì mọi thứ ở đây là no-op.

const ID_RE = /^G-[A-Z0-9]{4,20}$/

export type GaConfig = { measurementId: string; apiSecret: string | null }

/** Đọc cấu hình từ env. Trả null nếu chưa có Measurement ID hợp lệ. */
export function gaConfig(env: NodeJS.ProcessEnv = process.env): GaConfig | null {
  const id = (env.GA_MEASUREMENT_ID ?? '').trim()
  if (!ID_RE.test(id)) return null
  const secret = (env.GA_API_SECRET ?? '').trim()
  return { measurementId: id, apiSecret: secret || null }
}

export function gtagSnippet(measurementId: string, params: Record<string, string> = {}): string {
  const cfg = JSON.stringify(params)
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>` +
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}` +
    `gtag('js',new Date());gtag('config',${JSON.stringify(measurementId)},${cfg});</script>`
}

/** Chèn gtag ngay sau <head> (để đo cả khi trang lỗi giữa chừng). Không có
 *  <head> thì chèn đầu tài liệu. Trang đã có gtag thì giữ nguyên. */
export function injectGtag(html: string, measurementId: string, params: Record<string, string> = {}): string {
  if (html.includes('googletagmanager.com/gtag/js')) return html
  const tag = gtagSnippet(measurementId, params)
  const m = /<head(\s[^>]*)?>/i.exec(html)
  if (!m) return tag + html
  const at = m.index + m[0].length
  return html.slice(0, at) + tag + html.slice(at)
}

// ── Measurement Protocol ──────────────────────────────────────────────────

export type MpEvent = { gameId: string; playerId: string; name: string; props: unknown }

/** Tên event GA: chữ/số/_ , bắt đầu bằng chữ, ≤40 ký tự. */
export function gaEventName(name: string): string | null {
  const n = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 40)
  return n || null
}

/** Chỉ giữ tham số kiểu số/chuỗi ngắn (GA bỏ qua object lồng nhau). */
function gaParams(gameId: string, props: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = { game_id: gameId }
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    let n = 0
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      if (n >= 20) break
      const key = gaEventName(k)
      if (!key || key === 'game_id') continue
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
      else if (typeof v === 'string') out[key] = v.slice(0, 100)
      else if (typeof v === 'boolean') out[key] = v ? 1 : 0
      else continue
      n++
    }
  }
  return out
}

/** Gom event theo người chơi: mỗi request MP chỉ có 1 client_id, tối đa 25 event. */
export function mpPayloads(events: MpEvent[]): { client_id: string; events: { name: string; params: Record<string, string | number> }[] }[] {
  const byPlayer = new Map<string, { name: string; params: Record<string, string | number> }[]>()
  for (const e of events) {
    const name = gaEventName(e.name)
    if (!name) continue
    const list = byPlayer.get(e.playerId) ?? []
    list.push({ name, params: gaParams(e.gameId, e.props) })
    byPlayer.set(e.playerId, list)
  }
  const out = []
  for (const [client_id, evs] of byPlayer) {
    for (let i = 0; i < evs.length; i += 25) out.push({ client_id, events: evs.slice(i, i + 25) })
  }
  return out
}

/** Gửi lô event lên GA. Không bao giờ ném lỗi — analytics không được làm hỏng game. */
export async function sendToGa(
  cfg: GaConfig | null, events: MpEvent[],
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  if (!cfg?.apiSecret || !events.length) return 0
  const url = 'https://www.google-analytics.com/mp/collect?measurement_id=' +
    encodeURIComponent(cfg.measurementId) + '&api_secret=' + encodeURIComponent(cfg.apiSecret)
  let sent = 0
  for (const body of mpPayloads(events)) {
    try {
      const r = await fetchFn(url, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
      if (r.ok) sent += body.events.length
    } catch { /* bỏ qua: mạng lỗi thì mất lô này, game vẫn chạy */ }
  }
  return sent
}
