/**
 * Luật chơi, thuần và tất định. Chạy ở hai nơi:
 *  - server/room.ts: chân lý (authoritative) — client chỉ gửi input;
 *  - client ở chế độ "chơi thử" (không có platform): mô phỏng tại chỗ.
 * State là JSON thuần — kể cả RNG (rngState) — vì platform lưu và gửi nó đi.
 * Không DOM, không Math.random, không Date.
 */
import * as C from './config';

export type Phase = 'play' | 'over';

export interface Player {
  name: string;
  x: number;
  y: number;
  dx: number; // hướng input, -1..1
  dy: number;
  score: number;
}

export interface GameState {
  phase: Phase;
  players: Record<string, Player>;
  coin: { x: number; y: number };
  winner: string | null;
  restartIn: number; // s, khi phase = 'over'
  rngState: number;
}

/** mulberry32 trên số nằm TRONG state: tất định, serialize được. */
function rand(s: GameState): number {
  s.rngState = (s.rngState + 0x6d2b79f5) >>> 0;
  let t = s.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function placeCoin(s: GameState): void {
  s.coin.x = C.COIN_R + rand(s) * (C.FIELD_W - 2 * C.COIN_R);
  s.coin.y = C.COIN_R + rand(s) * (C.FIELD_H - 2 * C.COIN_R);
}

export function initialState(seed: number): GameState {
  const s: GameState = { phase: 'play', players: {}, coin: { x: 0, y: 0 }, winner: null, restartIn: 0, rngState: seed >>> 0 };
  placeCoin(s);
  return s;
}

export function join(s: GameState, id: string, name: string | null): void {
  if (s.players[id]) return; // đã có (nối lại trong cửa sổ reconnect): giữ nguyên
  const n = Object.keys(s.players).length;
  s.players[id] = {
    name: name ?? `P${n + 1}`,
    x: n % 2 === 0 ? C.FIELD_W * 0.25 : C.FIELD_W * 0.75,
    y: n < 2 ? C.FIELD_H * 0.25 : C.FIELD_H * 0.75,
    dx: 0,
    dy: 0,
    score: 0,
  };
}

export function leave(s: GameState, id: string): void {
  delete s.players[id];
}

/** Input là HƯỚNG, không phải vị trí: client không thể tự dịch chuyển. */
export function setInput(s: GameState, id: string, dx: unknown, dy: unknown): void {
  const p = s.players[id];
  if (!p || typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const len = Math.hypot(dx, dy);
  const k = len > 1 ? 1 / len : 1; // chặn: gửi (100, 0) không đi nhanh hơn
  p.dx = dx * k;
  p.dy = dy * k;
}

/** Một bước. Trả về id người vừa thắng ván (để server gửi điểm), không thì null. */
export function tick(s: GameState, dt: number): string | null {
  if (s.phase === 'over') {
    s.restartIn -= dt;
    if (s.restartIn <= 0) {
      for (const p of Object.values(s.players)) p.score = 0;
      s.phase = 'play';
      s.winner = null;
      placeCoin(s);
    }
    return null;
  }
  const reach = C.PLAYER_R + C.COIN_R;
  for (const id in s.players) {
    const p = s.players[id]!;
    p.x = Math.min(Math.max(p.x + p.dx * C.PLAYER_SPEED * dt, C.PLAYER_R), C.FIELD_W - C.PLAYER_R);
    p.y = Math.min(Math.max(p.y + p.dy * C.PLAYER_SPEED * dt, C.PLAYER_R), C.FIELD_H - C.PLAYER_R);
    if (Math.hypot(p.x - s.coin.x, p.y - s.coin.y) <= reach) {
      p.score++;
      placeCoin(s);
      if (p.score >= C.WIN_SCORE) {
        s.phase = 'over';
        s.winner = id;
        s.restartIn = C.RESTART_AFTER;
        return id;
      }
    }
  }
  return null;
}

/** Bot: đi thẳng tới xu. Dùng ở chế độ chơi thử và test G3. */
export function botInput(s: GameState, id: string): { dx: number; dy: number } {
  const p = s.players[id];
  if (!p) return { dx: 0, dy: 0 };
  const dx = s.coin.x - p.x;
  const dy = s.coin.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len };
}
