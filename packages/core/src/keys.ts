/**
 * Quy ước đặt tên key Redis — hàm thuần, KHÔNG mở kết nối.
 *
 * Tách khỏi redis.ts để test quy ước đặt tên không cần Redis chạy (import
 * module có kết nối sẽ giữ event loop sống và làm treo test runner).
 *
 * MỌI key của một game phải mang hash tag {game_id}: trên Redis Cluster, lệnh
 * nhiều key / transaction / Lua chỉ chạy khi các key cùng hash slot. Quy ước này
 * phải đúng TỪ M0 — đổi tên key sau khi có dữ liệu là migrate cả keyspace.
 */
export const key = {
  /** ZSET điểm: member = playerId, score = điểm */
  board: (gameId: string, board: string) => `lb:{${gameId}}:${board}`,
  /** HASH phụ trợ: tên hiển thị, cờ verified */
  boardMeta: (gameId: string, board: string) => `lbm:{${gameId}}:${board}`,
  /** đánh dấu bảng đã nạp từ Postgres, tránh nạp lại mỗi request */
  boardHydrated: (gameId: string, board: string) => `lbh:{${gameId}}:${board}`,
  /** SET các mục chưa đẩy sang Postgres */
  boardDirty: (gameId: string) => `lbd:{${gameId}}`,
  /** cache save, TTL ngắn */
  save: (gameId: string, playerId: string) => `save:{${gameId}}:${playerId}`,
  /** registry phòng: code -> node (M1) */
  room: (gameId: string, code: string) => `room:{${gameId}}:${code}`,
  /** session token cho reconnect (M1) */
  session: (gameId: string, token: string) => `sess:{${gameId}}:${token}`,
  /** đếm rate limit */
  rate: (gameId: string, playerId: string, bucket: string) => `rl:{${gameId}}:${playerId}:${bucket}`,
}

/** Tách hash tag ra khỏi key — dùng trong test để khẳng định cùng slot. */
export function hashTag(k: string): string | null {
  const m = /\{([^}]*)\}/.exec(k)
  return m ? m[1]! : null
}
