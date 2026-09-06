/**
 * Room registry — thứ khiến nhiều node hoạt động được.
 *
 * `code -> nodeUrl` trong Redis với TTL, node giữ phòng tự gia hạn. Node chết
 * thì key hết hạn và mã phòng tự giải phóng — không cần cơ chế phát hiện chết
 * riêng, và không có mã phòng "mồ côi" giữ chỗ vĩnh viễn.
 *
 * Có từ M0/M1 kể cả khi chỉ chạy một node: nếu hoãn tới lúc cần nhiều node thì
 * phải viết lại toàn bộ đường join.
 */
import { redis } from './redis.ts'
import { key } from './keys.ts'

export const ROOM_TTL_SEC = 90        // node gia hạn mỗi 30s -> chịu được 2 lần trượt
export const SESSION_TTL_SEC = 120

export type RoomEntry = { node: string; mode: string; createdAt: number }
export type SessionEntry = { code: string; playerId: string; gameId: string }

/** Đặt chỗ một mã phòng. Trả false nếu mã đã có người giữ (đụng mã). */
export async function claimRoom(gameId: string, code: string, e: RoomEntry): Promise<boolean> {
  const r = await redis.set(key.room(gameId, code), JSON.stringify(e), 'EX', ROOM_TTL_SEC, 'NX')
  return r === 'OK'
}

export async function renewRoom(gameId: string, code: string, e: RoomEntry): Promise<void> {
  // Ghi lại (không dùng EXPIRE thuần) để node mới tiếp quản được sau khi tiếp quản phòng.
  await redis.set(key.room(gameId, code), JSON.stringify(e), 'EX', ROOM_TTL_SEC)
}

export async function resolveRoom(gameId: string, code: string): Promise<RoomEntry | null> {
  const v = await redis.get(key.room(gameId, code))
  if (!v) return null
  try { return JSON.parse(v) as RoomEntry } catch { return null }
}

export async function releaseRoom(gameId: string, code: string): Promise<void> {
  await redis.del(key.room(gameId, code))
}

/** Session cho reconnect: sống qua cả việc client nối lại trúng node khác. */
export async function putSession(token: string, e: SessionEntry, ttl = SESSION_TTL_SEC): Promise<void> {
  await redis.set(key.session(e.gameId, token), JSON.stringify(e), 'EX', ttl)
}

export async function getSession(gameId: string, token: string): Promise<SessionEntry | null> {
  const v = await redis.get(key.session(gameId, token))
  if (!v) return null
  try { return JSON.parse(v) as SessionEntry } catch { return null }
}

export async function dropSession(gameId: string, token: string): Promise<void> {
  await redis.del(key.session(gameId, token))
}
