// Cửa hàng + đơn VietQR + webhook kiểu PayOS. Server là nguồn sự thật cho entitlement.
//   - giới hạn mua (ngày/tuần ISO/tài khoản/mùa/once) kiểm ở server, trong khoá advisory
//   - webhook: HMAC-SHA256 trên data đã sắp key, idempotent theo provider txn, số tiền phải khớp
//   - sandbox confirm: chỉ khi PAYMENTS_LIVE !== 'true', đi qua CHÍNH handler webhook
import type { FastifyInstance } from 'fastify'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { sql, badRequest, conflict, forbidden, notFound, unauthorized, HttpError, type Tx } from '@arcade/core'
import { CATALOG, LIMIT_MAX, findSku, SEASON, type Sku } from './catalog.ts'
import { isUnit, PASS_DAYS, type Unit } from '../castle/economy.ts'
import { lockPlayer, loadProfile, grant } from '../castle/index.ts'

const TZ = 'Asia/Ho_Chi_Minh'
export const paymentsLive = () => process.env.PAYMENTS_LIVE === 'true'
const SANDBOX_KEY = 'sandbox-checksum-key'
function checksumKey(): string {
  const k = process.env.PAYMENT_CHECKSUM_KEY
  if (k) return k
  if (paymentsLive()) throw new HttpError(503, 'PAYMENTS_MISCONFIGURED', 'thiếu PAYMENT_CHECKSUM_KEY')
  return SANDBOX_KEY
}

/** Chuỗi ký của PayOS: key sắp xếp, `k=v` nối bằng `&`; null/undefined -> ''. */
export function signData(data: Record<string, unknown>, key: string): string {
  const s = Object.keys(data).sort().map((k) => {
    const v = data[k]
    const str = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return `${k}=${str}`
  }).join('&')
  return createHmac('sha256', key).update(s).digest('hex')
}

function verifySignature(data: Record<string, unknown>, sig: unknown): boolean {
  if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/i.test(sig)) return false
  const want = Buffer.from(signData(data, checksumKey()), 'hex')
  const got = Buffer.from(sig, 'hex')
  return want.length === got.length && timingSafeEqual(want, got)
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
  const bank = process.env.PAYMENT_BANK_BIN ?? '970422'
  const account = process.env.PAYMENT_BANK_ACCOUNT ?? 'SANDBOX'
  const name = process.env.PAYMENT_ACCOUNT_NAME ?? 'ARCADE'
  const imageUrl = `https://img.vietqr.io/image/${bank}-${account}-compact2.png?amount=${amount}` +
    `&addInfo=${encodeURIComponent(code)}&accountName=${encodeURIComponent(name)}`
  return { bank, account, amount, content: code, imageUrl }
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

type WebhookBody = { data?: Record<string, unknown>; signature?: unknown }

/** Handler dùng chung cho webhook thật và sandbox confirm. */
export async function handleWebhook(body: WebhookBody): Promise<{ ok: true; duplicate?: boolean; orderId?: string; outcome?: string }> {
  const data = body?.data
  if (!data || typeof data !== 'object') throw badRequest('DATA_REQUIRED')
  if (!verifySignature(data, body.signature)) throw unauthorized('BAD_SIGNATURE')
  const code = String(data.orderCode ?? '')
  const txn = String(data.reference ?? data.transactionId ?? data.paymentLinkId ?? '')
  if (!txn) throw badRequest('TXN_REQUIRED')
  const amount = Number(data.amount)
  return sql.begin(async (t) => {
    const tx = t as Tx
    const [o] = await tx<{ id: string; player_id: string; sku: string; amount: number; status: string; params: { unit?: Unit } }[]>`
      select id, player_id, sku, amount, status, params from orders where code = ${code} for update`
    if (!o) throw notFound('ORDER_NOT_FOUND')
    if (amount !== o.amount) throw badRequest('AMOUNT_MISMATCH', `cần ${o.amount}, nhận ${amount}`)
    const outcome = o.status === 'paid' ? 'already_paid' : 'granted'
    const ins = await tx`insert into payment_events (provider_txn, order_id, amount, outcome, payload)
      values (${txn}, ${o.id}, ${amount}, ${outcome}, ${tx.json(body as never)}) on conflict (provider_txn) do nothing returning 1`
    if (!ins.length) return { ok: true as const, duplicate: true, orderId: o.id }
    if (outcome === 'granted') {
      await tx`update orders set status = 'paid', paid_at = now() where id = ${o.id}`
      await fulfil(tx, o)
    }
    return { ok: true as const, orderId: o.id, outcome }
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

  // Công khai (không Bearer) — chữ ký HMAC là thứ xác thực.
  app.post('/v1/pay/webhook', async (req) => handleWebhook(req.body as WebhookBody))

  app.post('/v1/pay/sandbox/confirm', async (req) => {
    if (paymentsLive()) throw forbidden('SANDBOX_DISABLED', 'PAYMENTS_LIVE=true')
    const orderId = (req.body as { orderId?: unknown } | undefined)?.orderId
    if (typeof orderId !== 'string' || !/^[0-9a-f-]{36}$/.test(orderId)) throw badRequest('ORDER_ID_INVALID')
    const [o] = await sql<{ code: string; amount: number }[]>`select code, amount from orders
      where id = ${orderId} and player_id = ${req.actor.playerId}`
    if (!o) throw notFound('ORDER_NOT_FOUND')
    const data = {
      orderCode: o.code, amount: o.amount, description: o.code, reference: `SBX-${orderId}`,
      transactionDateTime: new Date().toISOString(), currency: 'VND',
    }
    return handleWebhook({ data, signature: signData(data, checksumKey()) })
  })
}
