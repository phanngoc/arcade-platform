/**
 * Nạp server/room.js (bản build) trong vm giống sandbox của platform: không
 * require, không setTimeout, Date chỉ có now. Bắt lỗi "chạy ở local, chết trên
 * platform" — ví dụ room module lỡ import thứ cần Node.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import * as C from '../src/shared/config';

type Out = unknown[];
type Hooks = Record<string, (...a: unknown[]) => unknown> & { config?: { tickRate?: number; maxPlayers?: number } };

let mod: Hooks;

beforeAll(() => {
  const path = new URL('../server/room.js', import.meta.url);
  if (!existsSync(path)) throw new Error('chưa có server/room.js — chạy npm run build:room');
  const sandbox: Record<string, unknown> = {
    Math, JSON, Number, String, Boolean, Array, Object, Date: Object.freeze({ now: Date.now }),
    isNaN, isFinite, parseInt, parseFloat, structuredClone,
    console: { log() {}, warn() {}, error() {} },
    module: { exports: {} }, exports: {},
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(readFileSync(path, 'utf8'), { filename: 'room.js' }).runInContext(ctx, { timeout: 1000 });
  const m = (ctx.module as { exports: Hooks & { default?: Hooks } }).exports;
  mod = m.default ?? m;
});

function room(state: unknown) {
  const out: Out[] = [];
  return {
    out,
    r: {
      state,
      broadcast: (n: string, d: unknown) => out.push(['bc', n, d]),
      send: (id: string, n: string, d: unknown) => out.push(['snd', id, n, d]),
      leaderboard: (board: string) => ({ submit: (pid: string, score: number) => out.push(['score', board, pid, score]) }),
    },
  };
}

describe('room module trong sandbox', () => {
  it('khai config khớp arcade.toml (tick_rate, max_players)', () => {
    expect(mod.config).toEqual({ tickRate: C.TICK_RATE, maxPlayers: C.MAX_PLAYERS });
  });

  it('cả ván chạy được: vào, gửi input, thắng → điểm do server gửi', () => {
    const { r, out } = room(mod.initialState!());
    mod.onJoin!(r, { id: 'a', name: 'A' });
    mod.onJoin!(r, { id: 'b', name: 'B' });
    const s = r.state as { coin: { x: number; y: number }; players: Record<string, { x: number; y: number }> };
    for (let i = 0; i < 120 * C.TICK_RATE && !out.some((o) => o[0] === 'score'); i++) {
      const p = s.players.a!;
      mod.onMessage!(r, { id: 'a', name: 'A' }, 'input', { dx: s.coin.x - p.x, dy: s.coin.y - p.y });
      mod.onTick!(r, 1 / C.TICK_RATE);
    }
    expect(out).toContainEqual(['score', 'daily', 'a', C.WIN_SCORE]);
    expect(out).toContainEqual(['bc', 'won', { id: 'a' }]);
  });
});
