// Kinh tế Castle — hàm thuần, không I/O. Số liệu theo
// docs/castle-progression-monetization.md §2.3/§2.4 (bảng là LUẬT, đừng sửa tay).

export const UNITS = ['rusher', 'knight', 'archer', 'bomber', 'giant'] as const
export type Unit = (typeof UNITS)[number]
export const isUnit = (u: unknown): u is Unit => typeof u === 'string' && (UNITS as readonly string[]).includes(u)

export const MAX_UNIT_LEVEL = 9
export const MAX_PLAYER_LEVEL = 30
export const STANDARD_UNIT_LEVEL = 5

// §2.3: chi phí để LÊN cấp n (index = n). Cấp 1 là mặc định.
const UP_CARDS = [0, 0, 2, 4, 10, 20, 50, 100, 200, 400]
const UP_GOLD = [0, 0, 50, 150, 400, 1000, 2000, 4000, 8000, 15000]
const UP_XP = [0, 0, 4, 10, 25, 50, 100, 200, 400, 600]

export function upgradeCost(toLevel: number): { cards: number; gold: number; xp: number } {
  if (!Number.isInteger(toLevel) || toLevel < 2 || toLevel > MAX_UNIT_LEVEL) throw new RangeError('toLevel 2..9')
  return { cards: UP_CARDS[toLevel]!, gold: UP_GOLD[toLevel]!, xp: UP_XP[toLevel]! }
}

/** Hệ số máu & sát thương. Chi phí và tốc độ KHÔNG đổi. */
export const statMult = (lvl: number) => Math.round((1 + 0.04 * (lvl - 1)) * 1e6) / 1e6

/** XP để đi từ cấp n lên n+1. */
export const xpToNext = (n: number) => 100 + 40 * n

export const LEVEL_UP_GOLD = 300
export const FREE_COSMETIC_LEVELS = [5, 10, 15, 20, 25, 30]

export function addXp(level: number, xp: number, gain: number): { level: number; xp: number; gained: number[] } {
  const gained: number[] = []
  xp += gain
  while (level < MAX_PLAYER_LEVEL && xp >= xpToNext(level)) {
    xp -= xpToNext(level)
    level++
    gained.push(level)
  }
  if (level >= MAX_PLAYER_LEVEL) xp = 0
  return { level, xp, gained }
}

export function unlocks(level: number): string[] {
  const u: string[] = []
  if (level >= 2) u.push('daily_quests')
  if (level >= 3) u.push('standard')
  return u
}

// §2.4 — phần thưởng mỗi trận.
export const WIN = { gold: 60, cards: 8, xp: 30 }
export const LOSS = { gold: 20, cards: 2, xp: 10 }
export const FIRST_WIN = { gold: 60, cards: 4, xp: 20 }
export const FIRST_WINS_PER_DAY = 3
export const MAX_REWARDED_PER_DAY = 40
export const MIN_DURATION_MS = 20_000
export const CAMPAIGN_STAGES = 20

export type Reward = { gold: number; cards: number; xp: number }
const add = (a: Reward, b: Reward): Reward => ({ gold: a.gold + b.gold, cards: a.cards + b.cards, xp: a.xp + b.xp })

export function matchReward(o: {
  won: boolean; mode: 'campaign' | 'standard'; stage: number
  firstWinsToday: number; bestStage: number
}): Reward {
  let r: Reward = o.won ? { ...WIN } : { ...LOSS }
  if (o.won && o.firstWinsToday < FIRST_WINS_PER_DAY) r = add(r, FIRST_WIN)
  // Lần đầu qua một màn chiến dịch: 200 × số màn vàng, 20 thẻ, 50 XP.
  if (o.won && o.mode === 'campaign' && o.stage > o.bestStage && o.stage <= CAMPAIGN_STAGES) {
    r = add(r, { gold: 200 * o.stage, cards: 20, xp: 50 })
  }
  return r
}

// Nhiệm vụ ngày (mở ở cấp 2): tổng 150 vàng / 20 thẻ / 60 XP cho 3 nhiệm vụ.
export const QUESTS = [
  { id: 'play3', label: 'Chơi 3 trận', need: 3, metric: 'played', reward: { gold: 50, cards: 7, xp: 20 } },
  { id: 'win2', label: 'Thắng 2 trận', need: 2, metric: 'won', reward: { gold: 50, cards: 7, xp: 20 } },
  { id: 'play6', label: 'Chơi 6 trận', need: 6, metric: 'played', reward: { gold: 50, cards: 6, xp: 20 } },
] as const
export type QuestState = { played: number; won: number; done: string[] }

/** Cập nhật tiến độ nhiệm vụ sau một trận; trả về thưởng của các nhiệm vụ vừa xong. */
export function progressQuests(q: QuestState, won: boolean): { state: QuestState; reward: Reward; completed: string[] } {
  const state: QuestState = { played: q.played + 1, won: q.won + (won ? 1 : 0), done: [...q.done] }
  let reward: Reward = { gold: 0, cards: 0, xp: 0 }
  const completed: string[] = []
  for (const qu of QUESTS) {
    if (state.done.includes(qu.id)) continue
    if (state[qu.metric] >= qu.need) { state.done.push(qu.id); completed.push(qu.id); reward = add(reward, qu.reward) }
  }
  return { state, reward, completed }
}

// Pass mùa 28 ngày: free ≈ 6.000 vàng/400 thẻ ⇒ 215 vàng + 14 thẻ/ngày; Plus thêm 430 vàng/ngày.
export const PASS_DAYS = 28
export const PASS_FREE_DAILY = { gold: 215, cards: 14 }
export const PASS_PLUS_DAILY_GOLD = 430

/** Đấu Chuẩn: mọi quân (người chơi lẫn AI) bị ép về cấp 5, bất kể đã nâng tới đâu. */
export function standardLoadout(_owned: Partial<Record<Unit, number>>): Record<Unit, number> {
  const out = {} as Record<Unit, number>
  for (const u of UNITS) out[u] = STANDARD_UNIT_LEVEL
  return out
}

export function loadout(mode: 'campaign' | 'standard', owned: Partial<Record<Unit, number>>) {
  const units = mode === 'standard' ? standardLoadout(owned) : Object.fromEntries(UNITS.map((u) => [u, owned[u] ?? 1])) as Record<Unit, number>
  const mult = Object.fromEntries(UNITS.map((u) => [u, statMult(units[u])])) as Record<Unit, number>
  return { mode, units, mult }
}
