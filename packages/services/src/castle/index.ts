// Castle: ví + tiến trình trên server. Client chỉ POST kết quả trận; server
// kiểm (≥20s, ≤40 trận có thưởng/ngày, mỗi matchId một lần) rồi tự tính thưởng.
// Dùng vai owner (`sql`) với lọc player_id tường minh + khoá advisory theo người
// chơi để hai request song song không cộng vàng hai lần.
import type { FastifyInstance } from 'fastify'
import { sql, badRequest, forbidden, conflict, type Tx } from '@arcade/core'
import {
  UNITS, isUnit, MAX_UNIT_LEVEL, upgradeCost, addXp, unlocks, xpToNext, matchReward, progressQuests,
  LEVEL_UP_GOLD, FREE_COSMETIC_LEVELS, MAX_REWARDED_PER_DAY, MIN_DURATION_MS, FIRST_WINS_PER_DAY,
  PASS_FREE_DAILY, PASS_PLUS_DAILY_GOLD, loadout, type Unit, type Reward, type QuestState,
} from './economy.ts'

export const CASTLE_GAME_ID = 'castle'
const TZ = 'Asia/Ho_Chi_Minh'

type Row = {
  player_id: string; gold: string; cards: Record<string, number>; units: Record<string, number>
  level: number; xp: number; best_stage: number; pass_until: Date | null; pass_claimed_day: string | null
  quest_day: string | null; quests: Partial<QuestState>
}

export async function lockPlayer(tx: Tx, playerId: string) {
  await tx`select pg_advisory_xact_lock(hashtext(${'castle:' + playerId}))`
}

export async function loadProfile(tx: Tx, playerId: string): Promise<Row> {
  await tx`insert into castle_profiles (player_id) values (${playerId}) on conflict do nothing`
  const [r] = await tx<Row[]>`select *, to_char(pass_claimed_day,'YYYY-MM-DD') as pass_claimed_day,
      to_char(quest_day,'YYYY-MM-DD') as quest_day
    from castle_profiles where player_id = ${playerId} for update`
  return r!
}

export async function today(tx: Tx): Promise<string> {
  const [r] = await tx<{ d: string }[]>`select to_char((now() at time zone ${TZ})::date, 'YYYY-MM-DD') as d`
  return r!.d
}

/** Cộng vàng/thẻ/XP vào profile, xử lý lên cấp (300 vàng + cosmetic free ở 5/10/…). */
export async function grant(tx: Tx, p: Row, r: Reward, cardUnit?: Unit) {
  const cards = { ...p.cards }
  if (r.cards && cardUnit) cards[cardUnit] = (cards[cardUnit] ?? 0) + r.cards
  const x = addXp(p.level, p.xp, r.xp)
  const gold = Number(p.gold) + r.gold + x.gained.length * LEVEL_UP_GOLD
  for (const lv of x.gained) {
    if (FREE_COSMETIC_LEVELS.includes(lv)) {
      await tx`insert into entitlements (player_id, sku, source)
               values (${p.player_id}, ${'castle.free.lvl' + lv}, ${'level:' + lv}) on conflict do nothing`
    }
  }
  await tx`update castle_profiles set gold = ${gold}, cards = ${tx.json(cards)}, level = ${x.level}, xp = ${x.xp},
           updated_at = now() where player_id = ${p.player_id}`
  Object.assign(p, { gold: String(gold), cards, level: x.level, xp: x.xp })
  return x.gained
}

async function firstWinsToday(tx: Tx, playerId: string, day: string) {
  const [r] = await tx<{ n: number }[]>`select count(*)::int as n from castle_matches
    where player_id = ${playerId} and day = ${day} and won and rewarded`
  return Math.min(r!.n, FIRST_WINS_PER_DAY)
}

export async function view(tx: Tx, p: Row) {
  const day = await today(tx)
  const ents = await tx<{ sku: string }[]>`select distinct sku from entitlements
    where player_id = ${p.player_id} and sku like 'castle.%' and (expires_at is null or expires_at > now()) order by sku`
  const units = Object.fromEntries(UNITS.map((u) => [u, p.units[u] ?? 1]))
  const cards = Object.fromEntries(UNITS.map((u) => [u, p.cards[u] ?? 0]))
  const passActive = !!p.pass_until && p.pass_until.getTime() > Date.now()
  const q = p.quest_day === day ? p.quests : {}
  return {
    gold: Number(p.gold), cards, units, xp: p.xp, level: p.level,
    nextLevelXp: p.level >= 30 ? null : xpToNext(p.level),
    unlocks: unlocks(p.level),
    firstWinsToday: await firstWinsToday(tx, p.player_id, day),
    quests: { played: q.played ?? 0, won: q.won ?? 0, done: q.done ?? [] },
    passClaimedToday: p.pass_claimed_day === day,
    entitlements: ents.map((e) => e.sku),
    pass: { active: passActive, until: passActive ? p.pass_until!.toISOString() : null },
  }
}

export async function castleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req) => {
    if (req.routeOptions?.url?.startsWith('/v1/castle') && req.actor?.gameId !== CASTLE_GAME_ID) {
      throw forbidden('WRONG_GAME', 'token không phải của castle')
    }
  })

  app.get('/v1/castle/profile', async (req) =>
    sql.begin(async (tx) => view(tx as Tx, await loadProfile(tx as Tx, req.actor.playerId))))

  app.get('/v1/castle/loadout', async (req) => {
    const mode = (req.query as { mode?: string }).mode === 'standard' ? 'standard' : 'campaign'
    return sql.begin(async (tx) => loadout(mode, (await loadProfile(tx as Tx, req.actor.playerId)).units as Partial<Record<Unit, number>>))
  })

  app.post('/v1/castle/match', async (req) => {
    const b = (req.body ?? {}) as { matchId?: unknown; mode?: unknown; stage?: unknown; won?: unknown; durationMs?: unknown; cardUnit?: unknown }
    if (typeof b.matchId !== 'string' || !/^[\w-]{8,64}$/.test(b.matchId)) throw badRequest('MATCH_ID_INVALID')
    if (b.mode !== 'campaign' && b.mode !== 'standard') throw badRequest('MODE_INVALID')
    if (typeof b.won !== 'boolean') throw badRequest('WON_REQUIRED')
    const durationMs = Number(b.durationMs)
    if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS) throw badRequest('MATCH_TOO_SHORT', `< ${MIN_DURATION_MS}ms`)
    const stage = b.mode === 'campaign' ? Number(b.stage) : 0
    if (b.mode === 'campaign' && (!Number.isInteger(stage) || stage < 1 || stage > 20)) throw badRequest('STAGE_INVALID')
    const cardUnit = isUnit(b.cardUnit) ? b.cardUnit : null
    if (!cardUnit) throw badRequest('CARD_UNIT_INVALID', `một trong ${UNITS.join(',')}`)
    const { playerId } = req.actor
    const mode = b.mode, won = b.won, matchId = b.matchId

    return sql.begin(async (t) => {
      const tx = t as Tx
      await lockPlayer(tx, playerId)
      const p = await loadProfile(tx, playerId)
      if (mode === 'standard' && p.level < 3) throw forbidden('LOCKED', 'Đấu Chuẩn mở ở cấp 3')
      const [dup] = await tx`select 1 from castle_matches where match_id = ${matchId}`
      if (dup) throw conflict('MATCH_DUPLICATE')
      const day = await today(tx)
      const [cnt] = await tx<{ n: number }[]>`select count(*)::int as n from castle_matches
        where player_id = ${playerId} and day = ${day} and rewarded`
      const rewarded = cnt!.n < MAX_REWARDED_PER_DAY
      let reward: Reward = { gold: 0, cards: 0, xp: 0 }
      let questsDone: string[] = []
      if (rewarded) {
        reward = matchReward({ won, mode, stage, firstWinsToday: await firstWinsToday(tx, playerId, day), bestStage: p.best_stage })
        if (p.level >= 2) {
          const cur: QuestState = p.quest_day === day
            ? { played: p.quests.played ?? 0, won: p.quests.won ?? 0, done: p.quests.done ?? [] }
            : { played: 0, won: 0, done: [] }
          const q = progressQuests(cur, won)
          questsDone = q.completed
          reward = { gold: reward.gold + q.reward.gold, cards: reward.cards + q.reward.cards, xp: reward.xp + q.reward.xp }
          await tx`update castle_profiles set quest_day = ${day}, quests = ${tx.json(q.state)} where player_id = ${playerId}`
          Object.assign(p, { quest_day: day, quests: q.state })
        }
        if (won && mode === 'campaign' && stage > p.best_stage) {
          await tx`update castle_profiles set best_stage = ${stage} where player_id = ${playerId}`
          p.best_stage = stage
        }
      }
      await tx`insert into castle_matches (match_id, player_id, mode, stage, won, duration_ms, rewarded, reward, day)
        values (${matchId}, ${playerId}, ${mode}, ${stage}, ${won}, ${Math.trunc(durationMs)}, ${rewarded}, ${tx.json(reward)}, ${day})`
      const levelUps = await grant(tx, p, reward, cardUnit)
      return { reward, rewarded, questsDone, levelUps, profile: await view(tx, p) }
    })
  })

  app.post('/v1/castle/upgrade', async (req) => {
    const unit = (req.body as { unit?: unknown } | undefined)?.unit
    if (!isUnit(unit)) throw badRequest('UNIT_INVALID')
    const { playerId } = req.actor
    return sql.begin(async (t) => {
      const tx = t as Tx
      await lockPlayer(tx, playerId)
      const p = await loadProfile(tx, playerId)
      const lvl = p.units[unit] ?? 1
      if (lvl >= MAX_UNIT_LEVEL) throw conflict('MAX_LEVEL')
      const c = upgradeCost(lvl + 1)
      const haveCards = p.cards[unit] ?? 0
      if (Number(p.gold) < c.gold || haveCards < c.cards) throw conflict('NOT_ENOUGH', `cần ${c.gold} vàng + ${c.cards} thẻ`)
      const cards = { ...p.cards, [unit]: haveCards - c.cards }
      const units = { ...p.units, [unit]: lvl + 1 }
      const gold = Number(p.gold) - c.gold
      await tx`update castle_profiles set gold = ${gold}, cards = ${tx.json(cards)}, units = ${tx.json(units)}
               where player_id = ${playerId}`
      Object.assign(p, { gold: String(gold), cards, units })
      await grant(tx, p, { gold: 0, cards: 0, xp: c.xp })
      return { profile: await view(tx, p) }
    })
  })

  // Pass mùa: mỗi ngày nhận một lần. Free 215 vàng + 14 thẻ; Plus (đã mua) thêm 430 vàng.
  app.post('/v1/castle/pass/claim', async (req) => {
    const unit = (req.body as { unit?: unknown } | undefined)?.unit
    if (!isUnit(unit)) throw badRequest('UNIT_INVALID')
    const { playerId } = req.actor
    return sql.begin(async (t) => {
      const tx = t as Tx
      await lockPlayer(tx, playerId)
      const p = await loadProfile(tx, playerId)
      const day = await today(tx)
      if (p.pass_claimed_day === day) throw conflict('ALREADY_CLAIMED')
      const plus = !!p.pass_until && p.pass_until.getTime() > Date.now()
      const reward = { gold: PASS_FREE_DAILY.gold + (plus ? PASS_PLUS_DAILY_GOLD : 0), cards: PASS_FREE_DAILY.cards, xp: 0 }
      await tx`update castle_profiles set pass_claimed_day = ${day} where player_id = ${playerId}`
      p.pass_claimed_day = day
      await grant(tx, p, reward, unit)
      return { reward, plus, profile: await view(tx, p) }
    })
  })
}

/** Leaderboard 'standard' của castle: điểm phải gắn với một trận Đấu Chuẩn của chính người chơi. */
export async function assertStandardMatch(playerId: string, matchId: unknown): Promise<void> {
  if (typeof matchId !== 'string') throw badRequest('MATCH_ID_REQUIRED', 'bảng standard cần matchId của trận Đấu Chuẩn')
  const [m] = await sql<{ mode: string }[]>`select mode from castle_matches where match_id = ${matchId} and player_id = ${playerId}`
  if (!m) throw badRequest('MATCH_NOT_FOUND')
  if (m.mode !== 'standard') throw badRequest('MODE_NOT_STANDARD', 'bảng standard chỉ nhận điểm từ Đấu Chuẩn')
}
