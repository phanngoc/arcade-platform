import 'fastify'
declare module 'fastify' {
  interface FastifyRequest {
    /** Đặt bởi hook auth từ JWT. gameId LUÔN lấy từ token, không từ tham số request. */
    actor: { playerId: string; gameId: string; isGuest: boolean }
  }
}
