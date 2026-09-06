// Bảng xếp hạng: Redis ZSET là đường nóng, Postgres là nguồn chân lý.
//
// Vì sao không dùng thẳng Postgres: "hạng của tôi" = count(*) where score > x.
// Chạy tốt ở 10K dòng, sập ở 1M. ZREVRANK là O(log n).
// Vì sao Redis không phải nguồn chân lý: mất Redis được phép mất cache,
// KHÔNG được phép mất điểm của người chơi.
import { sql, redis, key } from '@arcade/core'

export type Entry = { playerId: string; score: number; name: string | null; verified: boolean; rank: number }

const DIRTY_BATCH = 500
const HYDRATE_TTL = 300

function metaKey(gameId: string, board: string) { return key.boardMeta(gameId, board) }
function hydratedKey(gameId: string, board: string) { return key.boardHydrated(gameId, board) }

/**
 * Nạp ZSET từ Postgres nếu chưa có. Xử lý được cả hai trường hợp:
 * khởi động nguội, và Redis bị xoá lúc đang chạy.
 * ZADD GT nên nạp lại là idempotent, không cần khoá.
 */
async function hydrate(gameId: string, board: string): Promise<void> {
  if (await redis.get(hydratedKey(gameId, board))) return
  const rows = await sql<{ player_id: string; score: string; verified: boolean; meta: { name?: string | null } | null }[]>`
    select player_id, score, verified, meta from leaderboard_entries
    where game_id = ${gameId} and board = ${board}`
  if (rows.length) {
    const pipe = redis.pipeline()
    for (const r of rows) {
      pipe.zadd(key.board(gameId, board), 'GT', Number(r.score), r.player_id)
      pipe.hset(metaKey(gameId, board), r.player_id, JSON.stringify({ n: r.meta?.name ?? null, v: r.verified }))
    }
    await pipe.exec()
  }
  await redis.set(hydratedKey(gameId, board), '1', 'EX', HYDRATE_TTL)
}

/** Nộp điểm. Giữ điểm CAO NHẤT (ZADD GT), không ghi đè bằng điểm mới thấp hơn. */
export async function submit(
  gameId: string, board: string, playerId: string, score: number,
  opts: { name?: string; verified?: boolean } = {},
): Promise<{ score: number; rank: number }> {
  await hydrate(gameId, board)
  const meta = JSON.stringify({ n: opts.name ?? null, v: opts.verified ?? false })
  await redis
    .pipeline()
    .zadd(key.board(gameId, board), 'GT', score, playerId)
    .hset(metaKey(gameId, board), playerId, meta)
    .sadd(key.boardDirty(gameId), `${board}|${playerId}`)
    .exec()
  const best = Number(await redis.zscore(key.board(gameId, board), playerId))
  const rank = await redis.zrevrank(key.board(gameId, board), playerId)
  return { score: best, rank: (rank ?? 0) + 1 }
}

async function decorate(gameId: string, board: string, flat: string[], startRank: number): Promise<Entry[]> {
  const ids: string[] = []
  for (let i = 0; i < flat.length; i += 2) ids.push(flat[i]!)
  const metas = ids.length ? await redis.hmget(metaKey(gameId, board), ...ids) : []
  const out: Entry[] = []
  for (let i = 0; i < ids.length; i++) {
    const m = metas[i] ? (JSON.parse(metas[i]!) as { n?: string | null; v?: boolean }) : {}
    out.push({
      playerId: ids[i]!,
      score: Number(flat[i * 2 + 1]),
      name: m.n ?? null,
      verified: m.v ?? false,
      rank: startRank + i,
    })
  }
  return out
}

export async function top(gameId: string, board: string, n: number): Promise<Entry[]> {
  await hydrate(gameId, board)
  const flat = await redis.zrevrange(key.board(gameId, board), 0, n - 1, 'WITHSCORES')
  return decorate(gameId, board, flat, 1)
}

/** N người trên và N người dưới quanh một người chơi. */
export async function around(gameId: string, board: string, playerId: string, n: number): Promise<Entry[]> {
  await hydrate(gameId, board)
  const rank = await redis.zrevrank(key.board(gameId, board), playerId)
  if (rank === null) return []
  const start = Math.max(0, rank - n)
  const flat = await redis.zrevrange(key.board(gameId, board), start, rank + n, 'WITHSCORES')
  return decorate(gameId, board, flat, start + 1)
}

/**
 * Write-behind: đẩy điểm đã đổi sang Postgres.
 * At-least-once: chỉ SREM sau khi ghi thành công, nên sự cố giữa chừng chỉ gây
 * ghi lại (upsert idempotent), không mất điểm.
 */
export async function flushDirty(gameId: string): Promise<number> {
  const members = await redis.srandmember(key.boardDirty(gameId), DIRTY_BATCH)
  if (!members?.length) return 0

  const rows: { board: string; playerId: string; score: number; verified: boolean; name: string | null }[] = []
  for (const m of members) {
    const idx = m.indexOf('|')
    const board = m.slice(0, idx)
    const playerId = m.slice(idx + 1)
    const score = await redis.zscore(key.board(gameId, board), playerId)
    if (score === null) continue
    const raw = await redis.hget(metaKey(gameId, board), playerId)
    const meta = raw ? (JSON.parse(raw) as { n?: string | null; v?: boolean }) : {}
    rows.push({
      board, playerId, score: Number(score),
      verified: meta.v ?? false,
      name: meta.n ?? null,
    })
  }

  if (rows.length) {
    // Vai owner: ghi thay cho nhiều người chơi nên nằm ngoài RLS một cách có chủ đích.
    // Upsert từng dòng trong một transaction thay vì helper insert nhiều dòng —
    // helper của postgres.js không nhận jsonb lồng trong mảng mà giữ được kiểu.
    // 500 dòng mỗi 5 giây thì chênh lệch không đáng kể.
    await sql.begin(async (tx) => {
      for (const r of rows) {
        await tx`
          insert into leaderboard_entries (game_id, board, player_id, score, verified, meta)
          values (${gameId}, ${r.board}, ${r.playerId}, ${r.score}, ${r.verified}, ${tx.json({ name: r.name })})
          on conflict (game_id, board, player_id) do update
            set score    = greatest(leaderboard_entries.score, excluded.score),
                verified = excluded.verified,
                meta     = excluded.meta`
      }
    })
  }
  await redis.srem(key.boardDirty(gameId), ...members)
  return rows.length
}

export async function flushAll(): Promise<number> {
  const games = await sql<{ id: string }[]>`select id from games`
  let n = 0
  for (const g of games) n += await flushDirty(g.id)
  return n
}
