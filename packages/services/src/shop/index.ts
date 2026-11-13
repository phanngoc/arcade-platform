// Cửa hàng + đơn QR SePay (VietQR) + webhook SePay. Server là nguồn sự thật cho entitlement.
//   - giới hạn mua (ngày/tuần ISO/tài khoản/mùa/once) kiểm ở server, trong khoá advisory
//   - webhook SePay: header Apikey, chỉ transferType=in, mã đơn trong nội dung CK, đúng số tiền, idempotent theo id giao dịch SePay
//   - sandbox confirm: chỉ khi PAYMENTS_LIVE !== 'true', đi qua CHÍNH handler webhook
import type { FastifyInstance } from 'fastify'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { sql, badRequest, conflict, forbidden, notFound, unauthorized, HttpError, type Tx } from '@arcade/core'
import { CATALOG, LIMIT_MAX, findSku, SEASON, type Sku } from './catalog.ts'
import { isUnit, PASS_DAYS, type Unit } from '../castle/economy.ts'
import { lockPlayer, loadProfile, grant } from '../castle/index.ts'

const TZ = 'Asia/Ho_Chi_Minh'
export const paymentsLive = () => process.env.PAYMENTS_LIVE === 'true'
const SANDBOX_KEY = 'sandbox-sepay-key'
/** API key SePay gửi trong header `Authorization: Apikey <key>`. */
export function sepayKey(): string {
  const k = process.env.SEPAY_API_KEY
  if (k) return k
  if (paymentsLive()) throw new HttpError(503, 'PAYMENTS_MISCONFIGURED', 'thiếu SEPAY_API_KEY')
  return SANDBOX_KEY
}

function verifyApiKey(header: unknown): boolean {
  const m = typeof header === 'string' ? /^\s*apikey\s+(\S+)\s*$/i.exec(header) : null
  if (!m) return false
  const want = createHash('sha256').update(sepayKey()).digest()
  const got = createHash('sha256').update(m[1]!).digest()
  return timingSafeEqual(want, got)
}

const CODE_RE = /ARC[A-Z0-9]{8}/i
/** Mã đơn: trường `code` SePay tách sẵn (theo tiền tố cấu hình), nếu không thì tìm trong nội dung CK. */
export function orderCodeOf(body: { code?: unknown; content?: unknown; description?: unknown }): string | null {
  const c = typeof body.code === 'string' ? body.code.trim() : ''
  if (/^ARC[A-Z0-9]{8}$/i.test(c)) return c.toUpperCase()
  const m = CODE_RE.exec(`${body.content ?? ''} ${body.description ?? ''}`)
  return m ? m[0].toUpperCase() : null
}

const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function newCode(): string {
  const b = randomBytes(8)
  let s = 'ARC'
  for (const x of b) s += CODE_ALPHA[x % CODE_ALPHA.length]
  return s
}

/** Số lần đã dùng trong cửa sổ giới hạn: đơn đã trả + đơn đang chờ chưa hết hạn. */
async function used(tx: Tx, playerId: string, s: Sku): Promise<number> {
  if (s.limit === 'none') return 0
  if (s.limit === 'once') {
    const [e] = await tx<{ n: number }[]>`select count(*)::int as n from entitlements
      where player_id = ${playerId} and sku = ${s.sku} and (expires_at is null or expires_at > now())`
    if (e!.n > 0) return 1
  }
  const window =
    s.limit === 'day' ? tx`and (created_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date`
    : s.limit === 'week' ? tx`and date_trunc('week', created_at at time zone ${TZ}) = date_trunc('week', now() at time zone ${TZ})`
    : s.limit === 'season' ? tx`and params->>'season' = ${SEASON}`
    : tx``
  const [r] = await tx<{ n: number }[]>`select count(*)::int as n from orders
    where player_id = ${playerId} and sku = ${s.sku}
      and (status = 'paid' or (status = 'pending' and expires_at > now())) ${window}`
  return r!.n
}

function qr(amount: number, code: string) {
  const bank = process.env.PAYMENT_BANK ?? 'MBBank'
  const account = process.env.PAYMENT_ACCOUNT ?? 'SANDBOX'
  const accountName = process.env.PAYMENT_ACCOUNT_NAME ?? 'ARCADE'
  const imageUrl = `https://qr.sepay.vn/img?acc=${encodeURIComponent(account)}&bank=${encodeURIComponent(bank)}` +
    `&amount=${amount}&des=${encodeURIComponent(code)}`
  return { provider: 'sepay', bank, account, accountName, amount, content: code, imageUrl }
}

/** Trao quyền lợi của một đơn đã trả. Chạy trong transaction của webhook. */
async function fulfil(tx: Tx, o: { id: string; player_id: string; sku: string; params: { unit?: Unit } }) {
  const src = `order:${o.id}`
  const ent = (sku: string, expires: Date | null = null) =>
    tx`insert into entitlements (player_id, sku, source, expires_at) values (${o.player_id}, ${sku}, ${src}, ${expires})
       on conflict do nothing`
  const s = findSku(o.sku)!
  if (s.game === 'tank') {
    await ent(o.sku, s.limit === 'season' ? new Date(Date.now() + PASS_DAYS * 864e5) : null)
    return
  }
  await lockPlayer(tx, o.player_id)
  const p = await loadProfile(tx, o.player_id)
  switch (o.sku) {
    case 'castle.pass.s1': {
      const base = Math.max(Date.now(), p.pass_until?.getTime() ?? 0)
      const until = new Date(base + PASS_DAYS * 864e5)
      await tx`update castle_profiles set pass_until = ${until} where player_id = ${o.player_id}`
      await ent(o.sku, until)
      return
    }
    case 'castle.gold.daily': await grant(tx, p, { gold: 1500, cards: 0, xp: 0 }); return
    case 'castle.cards.pick': await grant(tx, p, { gold: 0, cards: 50, xp: 0 }, o.params.unit); return
    case 'castle.starter':
      await grant(tx, p, { gold: 2000, cards: 100, xp: 0 }, o.params.unit)
      await ent('castle.skin.ice')
      await ent(o.sku)
      return
    default: await ent(o.sku)
  }
}

/** Payload webhook SePay (docs.sepay.vn/tich-hop-webhooks.html). */
export type SepayBody = {
  id?: unknown; gateway?: unknown; transactionDate?: unknown; accountNumber?: unknown; code?: unknown
  content?: unknown; transferType?: unknown; transferAmount?: unknown; referenceCode?: unknown; description?: unknown
}
export type WebhookResult = { success: true; outcome: string; duplicate?: boolean; orderId?: string }

/** Handler dùng chung cho webhook SePay thật và sandbox confirm.
 *  Key sai -> 401. Mọi giao dịch hợp lệ đều được ghi vào payment_events (kể cả không cấp đồ)
 *  và trả 200 {success:true} để SePay không gửi lại; chỉ outcome 'granted' mới cấp quyền lợi. */
export async function handleWebhook(body: SepayBody, authorization: unknown): Promise<WebhookResult> {
  if (!verifyApiKey(authorization)) throw unauthorized('BAD_API_KEY')
  if (!body || typeof body !== 'object') throw badRequest('BODY_REQUIRED')
  const id = String(body.id ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw badRequest('ID_REQUIRED')
  const txn = `sepay:${id}`
  const amount = Number(body.transferAmount)
  const code = orderCodeOf(body)
  return sql.begin(async (t) => {
    const tx = t as Tx
    const record = async (outcome: string, orderId: string | null) => {
      const ins = await tx`insert into payment_events (provider_txn, order_id, amount, outcome, payload)
        values (${txn}, ${orderId}, ${Number.isFinite(amount) ? Math.trunc(amount) : 0}, ${outcome}, ${tx.json(body as never)})
        on conflict (provider_txn) do nothing returning 1`
      return ins.length > 0
    }
    const done = async (outcome: string, orderId: string | null): Promise<WebhookResult> =>
      (await record(outcome, orderId))
        ? { success: true, outcome, ...(orderId ? { orderId } : {}) }
        : { success: true, outcome: 'duplicate', duplicate: true, ...(orderId ? { orderId } : {}) }
    if (body.transferType !== 'in') return done('ignored_out', null)
    if (!code) return done('no_code', null)
    const [o] = await tx<{ id: string; player_id: string; sku: string; amount: number; status: string; params: { unit?: Unit } }[]>`
      select id, player_id, sku, amount, status, params from orders where code = ${code} for update`
    if (!o) return done('unknown_order', null)
    if (amount !== Number(o.amount)) return done('amount_mismatch', o.id)
    if (o.status === 'paid') return done('already_paid', o.id)
    if (!(await record('granted', o.id))) return { success: true, outcome: 'duplicate', duplicate: true, orderId: o.id }
    await tx`update orders set status = 'paid', paid_at = now() where id = ${o.id}`
    await fulfil(tx, o)
    return { success: true, outcome: 'granted', orderId: o.id }
  })
}

export async function shopRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/shop', async (req) => {
    const game = (req.query as { game?: string }).game ?? 'castle'
    const items = CATALOG.filter((s) => s.game === game)
    return sql.begin(async (t) => Promise.all(items.map(async (s) => ({
      sku: s.sku, price: s.price, kind: s.kind, label: s.label, needsUnit: !!s.needsUnit,
      limitLeft: s.limit === 'none' ? null : Math.max(0, LIMIT_MAX[s.limit] - await used(t as Tx, req.actor.playerId, s)),
    }))))
  })

  app.post('/v1/orders', async (req) => {
    const b = (req.body ?? {}) as { sku?: unknown; unit?: unknown }
    const s = findSku(b.sku)
    if (!s) throw badRequest('SKU_UNKNOWN')
    if (s.needsUnit && !isUnit(b.unit)) throw badRequest('UNIT_REQUIRED')
    const { playerId, gameId } = req.actor
    const sandbox = !paymentsLive()
    return sql.begin(async (t) => {
      const tx = t as Tx
      await lockPlayer(tx, playerId)
      if (await used(tx, playerId, s) >= LIMIT_MAX[s.limit]) throw conflict('LIMIT_REACHED')
      const code = newCode()
      const params: Record<string, string> = { ...(s.needsUnit ? { unit: b.unit as string } : {}), ...(s.limit === 'season' ? { season: SEASON } : {}) }
      const [o] = await tx<{ id: string }[]>`insert into orders (player_id, game_id, sku, amount, code, params, sandbox)
        values (${playerId}, ${gameId}, ${s.sku}, ${s.price}, ${code}, ${tx.json(params)}, ${sandbox}) returning id`
      return { orderId: o!.id, amount: s.price, code, qr: qr(s.price, code), sandbox }
    })
  })

  app.get('/v1/orders/:id', async (req) => {
    const { id } = req.params as { id: string }
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('ORDER_NOT_FOUND')
    const [o] = await sql<{ status: string; expired: boolean; sku: string }[]>`
      select status, sku, (status = 'pending' and expires_at <= now()) as expired
      from orders where id = ${id} and player_id = ${req.actor.playerId}`
    if (!o) throw notFound('ORDER_NOT_FOUND')
    return { status: o.expired ? 'expired' : o.status, sku: o.sku }
  })

  app.get('/v1/entitlements', async (req) => {
    const game = (req.query as { game?: string }).game
    const rows = await sql<{ sku: string }[]>`select distinct sku from entitlements
      where player_id = ${req.actor.playerId} and (expires_at is null or expires_at > now())
        ${game ? sql`and sku like ${game + '.%'}` : sql``} order by sku`
    return rows.map((r) => r.sku)
  })

  // Công khai (không Bearer) — header `Authorization: Apikey <SEPAY_API_KEY>` là thứ xác thực.
  app.post('/v1/pay/webhook', async (req) => handleWebhook(req.body as SepayBody, req.headers.authorization))

  app.post('/v1/pay/sandbox/confirm', async (req) => {
    if (paymentsLive()) throw forbidden('SANDBOX_DISABLED', 'PAYMENTS_LIVE=true')
    const orderId = (req.body as { orderId?: unknown } | undefined)?.orderId
    if (typeof orderId !== 'string' || !/^[0-9a-f-]{36}$/.test(orderId)) throw badRequest('ORDER_ID_INVALID')
    const [o] = await sql<{ code: string; amount: number }[]>`select code, amount from orders
      where id = ${orderId} and player_id = ${req.actor.playerId}`
    if (!o) throw notFound('ORDER_NOT_FOUND')
    // Payload dạng SePay, id cố định theo đơn => bấm lại = gửi trùng.
    const body: SepayBody = {
      id: `SBX${orderId.replace(/-/g, '')}`, gateway: 'SANDBOX', transactionDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
      accountNumber: process.env.PAYMENT_ACCOUNT ?? 'SANDBOX', code: o.code, content: `${o.code} sandbox`,
      transferType: 'in', transferAmount: Number(o.amount), referenceCode: `SBX-${orderId}`, description: o.code,
    }
    return handleWebhook(body, `Apikey ${sepayKey()}`)
  })
}
