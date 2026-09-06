// Truy cập Postgres. Hai đường tách bạch — nhầm đường là thủng RLS.
//   sql       : vai owner, BỎ QUA RLS. Chỉ dùng cho tác vụ hệ thống.
//   withActor : vai arcade_app, CHỊU RLS. Dùng cho mọi thứ theo request.
import postgres from 'postgres'

const OWNER_URL = process.env.DATABASE_URL ?? 'postgres://arcade:arcade@127.0.0.1:55432/arcade'
const APP_URL = process.env.DATABASE_APP_URL ?? OWNER_URL.replace('//arcade:arcade@', '//arcade_app:arcade_app@')

const opts = { onnotice: () => {}, transform: { undefined: null } } as const

export const sql = postgres(OWNER_URL, opts)
const appSql = postgres(APP_URL, opts)

export type Actor = { playerId: string; gameId: string }
export type Tx = postgres.TransactionSql<Record<string, never>>

/**
 * Chạy fn trong transaction có sẵn ngữ cảnh RLS.
 * set_config(..., true) = phạm vi transaction — bắt buộc, vì connection được
 * dùng lại từ pool: để sót ngữ cảnh sang request sau là rò dữ liệu giữa người chơi.
 */
export async function withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appSql.begin(async (tx) => {
    await tx`select set_config('arcade.player_id', ${actor.playerId}, true),
                    set_config('arcade.game_id',   ${actor.gameId},   true)`
    return fn(tx as Tx)
  }) as Promise<T>
}

export async function closePg(): Promise<void> {
  await Promise.all([sql.end(), appSql.end()])
}
