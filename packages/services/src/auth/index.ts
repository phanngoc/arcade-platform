import type { FastifyInstance } from 'fastify'
import { sql, mintAccess, mintRefresh, verify, accessTtlSec, badRequest, notFound, unauthorized } from '@arcade/core'

async function gameExists(gameId: string): Promise<boolean> {
  const [row] = await sql`select 1 from games where id = ${gameId}`
  return !!row
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Guest-first: chơi được ngay, không form đăng ký. Nâng cấp tài khoản sau.
  app.post('/v1/auth/guest', async (req) => {
    const { gameId } = (req.body ?? {}) as { gameId?: string }
    if (!gameId) throw badRequest('GAME_ID_REQUIRED')
    if (!(await gameExists(gameId))) throw notFound('GAME_NOT_FOUND')

    const [p] = await sql<{ id: string }[]>`
      insert into players (is_guest) values (true) returning id`
    const playerId = p!.id
    return {
      playerId,
      isGuest: true,
      accessToken: await mintAccess(playerId, gameId, true),
      refreshToken: await mintRefresh(playerId, gameId, true),
      expiresIn: accessTtlSec,
    }
  })

  app.post('/v1/auth/refresh', async (req) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string }
    if (!refreshToken) throw badRequest('REFRESH_TOKEN_REQUIRED')
    let c
    try {
      c = await verify(refreshToken, 'refresh')
    } catch {
      throw unauthorized('REFRESH_INVALID')
    }
    // M0: refresh là JWT stateless -> chưa thu hồi được trước hạn.
    // Khi cần thu hồi (đổi mật khẩu, mất máy): lưu jti vào Redis và kiểm ở đây.
    const [row] = await sql<{ is_guest: boolean }[]>`
      select is_guest from players where id = ${c.sub}`
    if (!row) throw unauthorized('PLAYER_GONE')
    return {
      playerId: c.sub,
      accessToken: await mintAccess(c.sub, c.gid, row.is_guest),
      expiresIn: accessTtlSec,
    }
  })

  // Nâng cấp guest thành tài khoản có email. M0 chưa gửi OTP thật —
  // chỉ gắn email và giữ nguyên player_id để KHÔNG mất tiến độ chơi.
  app.post('/v1/auth/link', async (req) => {
    const a = req.actor
    const { email } = (req.body ?? {}) as { email?: string }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('EMAIL_INVALID')
    const [row] = await sql<{ id: string }[]>`
      update players set is_guest = false, linked_email = ${email}
      where id = ${a.playerId} returning id`
    if (!row) throw notFound('PLAYER_NOT_FOUND')
    return { playerId: a.playerId, isGuest: false, accessToken: await mintAccess(a.playerId, a.gameId, false) }
  })
}
