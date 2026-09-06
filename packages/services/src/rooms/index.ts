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

/**
 * Địa chỉ WebSocket mà CLIENT dùng được, dựng từ chính request.
 *
 * Không dùng được biến cấu hình cố định: game chạy trên custom domain
 * (castle.bomclaw.org) đi qua Cloudflare tunnel, nên địa chỉ đúng phụ thuộc
 * Host của request. Trả về một hằng số kiểu ws://127.0.0.1:8090 thì trình duyệt
 * ngoài internet nối vào localhost của CHÍNH NÓ — và trên trang https còn bị
 * chặn vì mixed content.
 */
function wsOriginFor(req: { headers: Record<string, string | string[] | undefined> }, fallback: string): string {
  const host = req.headers['host']
  if (typeof host !== 'string' || !host) return fallback
  const xfp = req.headers['x-forwarded-proto']
  const proto = (Array.isArray(xfp) ? xfp[0] : xfp)?.split(',')[0]?.trim()
  // Tunnel/proxy luôn gắn x-forwarded-proto. Không có nghĩa là gọi trực tiếp -> http.
  const secure = proto === 'https'
  return `${secure ? 'wss' : 'ws'}://${host}`
}

export async function roomsRoutes(app: FastifyInstance, opts: { wsBaseUrl: string }): Promise<void> {
  app.post('/v1/rooms/join', async (req) => {
    const { gameId } = req.actor
    const { code: raw } = (req.body ?? {}) as { code?: string }
    if (!raw) throw badRequest('CODE_REQUIRED')
    const code = normalizeCode(raw)
    if (!code) throw badRequest('CODE_INVALID', 'mã phòng gồm 4 ký tự, không có O/0/I/1/L')

    const entry = await resolveRoom(gameId, code)
    if (!entry) throw notFound('ROOM_NOT_FOUND')
    // M1 một node: client nối lại chính origin đang phục vụ trang.
    // M2 nhiều node: mỗi node cần địa chỉ công khai riêng, lúc đó dùng entry.node.
    return { code, mode: entry.mode, wsUrl: `${wsOriginFor(req, opts.wsBaseUrl)}/ws` }
  })

  // Node để tạo phòng mới. Ở M1 chỉ có một node nên trả về chính nó;
  // ở M2 đây là chỗ cắm thuật toán chọn node ít tải nhất.
  app.post('/v1/rooms/pick', async (req) => ({ wsUrl: `${wsOriginFor(req, opts.wsBaseUrl)}/ws` }))
}
