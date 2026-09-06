// Giao thức đường truyền. Text JSON ở M1 (debug được bằng mắt); mọi thông điệp
// bọc trong { t: ... } để sau này thêm nhánh binary không phải đổi hình dạng.
import type { Op } from './patch.ts'

export const PROTOCOL_VERSION = 1

// ── Client -> Server ─────────────────────────────────────────────────────────
export type C2S =
  | { t: 'hello'; token: string; v: number }
  | { t: 'create'; mode: string; opts?: Record<string, unknown>; name?: string }
  | { t: 'join'; code: string; name?: string }
  | { t: 'rejoin'; session: string }
  | { t: 'msg'; n: string; d?: unknown }
  | { t: 'pong'; id: number }
  | { t: 'resync' }
  | { t: 'leave' }

// ── Server -> Client ─────────────────────────────────────────────────────────
export type S2C =
  | { t: 'welcome'; playerId: string; session: string; code: string; url: string; isHost: boolean }
  | { t: 'snap'; s: unknown; c: number; seq: number }
  | { t: 'patch'; ops: Op[]; c: number; seq: number }
  | { t: 'ev'; n: string; d?: unknown }
  | { t: 'join'; p: { id: string; name: string | null } }
  | { t: 'left'; p: string; r: LeaveReason }
  | { t: 'ping'; id: number }
  | { t: 'err'; code: ErrCode; msg?: string }

export type LeaveReason = 'left' | 'timeout' | 'kicked' | 'disposed'

export type ErrCode =
  | 'BAD_MESSAGE' | 'PROTOCOL_VERSION' | 'TOKEN_INVALID' | 'NOT_IN_ROOM'
  | 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'ROOM_LOCKED' | 'RATE_LIMITED'
  | 'MODULE_ERROR' | 'STATE_TOO_BIG' | 'SESSION_INVALID' | 'GAME_NOT_FOUND'
  | 'DRAINING'

export function encode(m: S2C): string { return JSON.stringify(m) }

export function decode(raw: string): C2S | null {
  if (raw.length > 16 * 1024) return null   // input của client không bao giờ cần lớn hơn
  try {
    const v = JSON.parse(raw) as C2S
    return v && typeof v === 'object' && typeof (v as { t?: unknown }).t === 'string' ? v : null
  } catch { return null }
}
