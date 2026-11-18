/**
 * Room module — platform chạy file build ra (server/room.js) trong sandbox vm:
 * CHỈ có Math, JSON, Date.now, structuredClone… Không require, không
 * setTimeout, không fetch. Nhịp là việc của platform (onTick).
 * `npm run build:room` gói file này cùng src/shared/ thành một file CommonJS.
 *
 * Hợp đồng (packages/roomd/src/sandbox.ts):
 *   room.state      — JSON thuần, platform tự diff + gửi cho client
 *   room.broadcast(name, data) / room.send(playerId, name, data)
 *   room.leaderboard(board).submit(playerId, score)
 */
import * as C from '../src/shared/config';
import { initialState, join, leave, setInput, tick, type GameState } from '../src/shared/rules';

type Player = { id: string; name: string | null };
type Room = {
  state: GameState;
  broadcast(name: string, data?: unknown): void;
  leaderboard(board: string): { submit(playerId: string, score: number): void };
};

export default {
  config: { tickRate: C.TICK_RATE, maxPlayers: C.MAX_PLAYERS },

  initialState: (): GameState => initialState(Date.now()),

  onJoin(room: Room, p: Player): void {
    join(room.state, p.id, p.name);
  },

  onMessage(room: Room, p: Player, type: string, d: { dx?: unknown; dy?: unknown } | null): void {
    if (type === 'input' && d) setInput(room.state, p.id, d.dx, d.dy);
  },

  onTick(room: Room, dt: number): void {
    const winner = tick(room.state, dt);
    if (winner) {
      // Điểm do SERVER gửi (verified) — client không tự khai điểm được.
      for (const board of ['daily', 'alltime']) room.leaderboard(board).submit(winner, C.WIN_SCORE);
      room.broadcast('won', { id: winner });
    }
  },

  onLeave(room: Room, p: Player): void {
    leave(room.state, p.id);
  },
};
