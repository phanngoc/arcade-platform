/**
 * Luật chơi, thuần: không DOM, không Math.random, không cấp phát mỗi bước.
 * main.ts vẽ state này; vitest và bot chạy chính nó.
 */
import * as C from './config';
import { makeRng, type Rng } from './rng';

export type Phase = 'ready' | 'play' | 'won' | 'lost';
export type Dir = -1 | 0 | 1;

export interface Block {
  x: number; // mép trái, u
  y: number; // mép trên, u
  w: number; // u
  alive: boolean;
}

export interface State {
  phase: Phase;
  t: number; // s đã sống
  px: number; // tâm người chơi, u
  blocks: Block[];
  spawnIn: number; // s tới khối kế
  rng: Rng;
  seed: number;
}

export function createState(seed: number): State {
  const blocks: Block[] = [];
  for (let i = 0; i < C.MAX_BLOCKS; i++) blocks.push({ x: 0, y: 0, w: 0, alive: false });
  return { phase: 'ready', t: 0, px: C.FIELD_W / 2, blocks, spawnIn: 0.6, rng: makeRng(seed), seed };
}

export function start(s: State): void {
  if (s.phase !== 'play') {
    const fresh = createState(s.seed);
    Object.assign(s, fresh);
    s.phase = 'play';
  }
}

export function fallSpeed(t: number): number {
  return Math.min(C.FALL_SPEED_START + C.FALL_ACCEL * t, C.FALL_SPEED_MAX);
}

export function spawnEvery(t: number): number {
  return Math.max(C.SPAWN_EVERY_START - C.SPAWN_SPEEDUP * t, C.SPAWN_EVERY_MIN);
}

export function score(s: State): number {
  return Math.floor(s.t);
}

export function step(s: State, dir: Dir, dt: number): void {
  if (s.phase !== 'play') return;
  s.t += dt;
  const half = C.PLAYER_W / 2;
  const px0 = s.px;
  s.px = Math.min(Math.max(s.px + dir * C.PLAYER_SPEED * dt, half), C.FIELD_W - half);

  s.spawnIn -= dt;
  if (s.spawnIn <= 0) {
    s.spawnIn += spawnEvery(s.t);
    let b: Block | undefined;
    for (const x of s.blocks) if (!x.alive) { b = x; break; }
    if (b) {
      b.w = C.BLOCK_W_MIN + s.rng() * (C.BLOCK_W_MAX - C.BLOCK_W_MIN);
      b.x = s.rng() * (C.FIELD_W - b.w);
      b.y = -C.BLOCK_H;
      b.alive = true;
    }
  }

  // Va chạm theo QUÃNG đã đi trong bước, không chỉ vị trí cuối: bước dài (máy
  // chậm, bot mô phỏng thô) không được cho khối "nhảy" qua người chơi. Nhờ vậy
  // luật không phụ thuộc dt.
  const v = fallSpeed(s.t) * dt;
  const pl = Math.min(px0, s.px) - half;
  const pr = Math.max(px0, s.px) + half;
  for (const b of s.blocks) {
    if (!b.alive) continue;
    const y0 = b.y;
    b.y += v;
    if (y0 > C.FIELD_H) {
      b.alive = false;
      continue;
    }
    const hitY = b.y + C.BLOCK_H > C.PLAYER_Y && y0 < C.PLAYER_Y + C.PLAYER_H;
    if (hitY && b.x < pr && b.x + b.w > pl) {
      s.phase = 'lost';
      return;
    }
  }
  if (s.t >= C.WIN_SECONDS) s.phase = 'won';
}

/**
 * Bot nhìn trước: với mỗi vị trí đích, mô phỏng tiếp các khối ĐANG có trong
 * ~BOT_LOOKAHEAD giây (engine tất định nên mô phỏng = tương lai thật, trừ khối
 * chưa sinh), chọn đích gần nhất mà sống sót; không có thì đích sống lâu nhất.
 * Chỉ dùng ở test (G3 — "bot phải thắng được") và playtest, không ở vòng render,
 * nên được phép cấp phát.
 */
const BOT_LOOKAHEAD = 2.5; // s — đủ thấy khối vừa sinh tới hàng người chơi
const BOT_DT = 1 / 20; // s
const BOT_STEP = 0.5; // u — khoảng cách giữa các đích thử

/** Hướng đi tới một đích (dừng khi đủ gần) — tay người: chọn chỗ rồi dừng ở đó. */
export function toward(s: State, target: number): Dir {
  const d = target - s.px;
  return Math.abs(d) < 0.1 ? 0 : d < 0 ? -1 : 1;
}

function survives(s: State, target: number): number {
  const sim: State = { ...s, phase: 'play', spawnIn: Infinity, blocks: s.blocks.map((b) => ({ ...b })) };
  for (let t = 0; t < BOT_LOOKAHEAD; t += BOT_DT) {
    step(sim, toward(sim, target), BOT_DT);
    if (sim.phase === 'lost') return t;
  }
  return BOT_LOOKAHEAD;
}

/** Đích bot chọn lúc này. Gọi theo nhịp phản xạ; giữa hai lần, đi bằng toward(). */
export function botTarget(s: State): number {
  const half = C.PLAYER_W / 2;
  let best = s.px;
  let bestScore = -Infinity;
  for (let x = half; x <= C.FIELD_W - half + 1e-9; x += BOT_STEP) {
    for (const target of x === half ? [s.px, x] : [x]) {
      // sống trọn lookahead là trên hết; sau đó gần hơn thì tốt hơn
      const score = survives(s, target) * 100 - Math.abs(target - s.px);
      if (score > bestScore) { bestScore = score; best = target; }
    }
  }
  return best;
}

export function botDir(s: State): Dir {
  return toward(s, botTarget(s));
}
