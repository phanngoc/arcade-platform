/**
 * Đường join phòng (tầng stateless). Chỉ ĐỌC registry rồi trả về node đang giữ
 * phòng — client sau đó kết nối WebSocket THẲNG tới node đó.
 *
 * Nhờ vậy không cần load balancer L7 hiểu khái niệm "phòng", không cần
 * consistent hashing ở tầng mạng. Xem IMPLEMENTATION §2.6.
 */
import type { FastifyInstance } from 'fastify'
import { resolveRoom, badRequest, notFound } from '@arcade/core'
import { normalizeCode } from '@arcade/protocol'

export async function roomsRoutes(app: FastifyInstance, opts: { wsBaseUrl: string }): Promise<void> {
  app.post('/v1/rooms/join', async (req) => {
    const { gameId } = req.actor
    const { code: raw } = (req.body ?? {}) as { code?: string }
    if (!raw) throw badRequest('CODE_REQUIRED')
    const code = normalizeCode(raw)
    if (!code) throw badRequest('CODE_INVALID', 'mã phòng gồm 4 ký tự, không có O/0/I/1/L')

    const entry = await resolveRoom(gameId, code)
    if (!entry) throw notFound('ROOM_NOT_FOUND')
    return { code, node: entry.node, mode: entry.mode, wsUrl: `${entry.node}/ws` }
  })

  // Node để tạo phòng mới. Ở M1 chỉ có một node nên trả về chính nó;
  // ở M2 đây là chỗ cắm thuật toán chọn node ít tải nhất.
  app.post('/v1/rooms/pick', async () => ({ wsUrl: `${opts.wsBaseUrl}/ws` }))
}
