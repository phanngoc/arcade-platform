/** Game tự mô tả cho Studio của platform — xem studio-contract.ts. Test G3 cũng chạy qua đây. */
import * as C from './config';
import { createState, start, step, fallSpeed, spawnEvery, score, botTarget, toward } from './engine';
import { numbers, type GameStudio, type Frame, type Shape } from './studio-contract';

const DT = 1 / 60; // s — đúng bước của game
export const REACT = 0.2; // s — bot chọn đích mỗi 200ms, như phản xạ người

export const studio: GameStudio = {
  world: { w: C.FIELD_W, h: C.FIELD_H },
  config: numbers(C),
  balance: C.BALANCE,
  curves: [
    { id: 'fallSpeed', label: 'Tốc độ rơi', unit: 'u/s', x: { label: 'giây chơi', from: 0, to: C.WIN_SECONDS, step: 1 }, f: fallSpeed },
    { id: 'spawnEvery', label: 'Khoảng cách giữa hai khối', unit: 's', x: { label: 'giây chơi', from: 0, to: C.WIN_SECONDS, step: 1 }, f: spawnEvery },
  ],
  simulate(seed, opts = {}) {
    const s = createState(seed);
    start(s);
    const max = opts.maxSeconds ?? C.WIN_SECONDS + 1;
    const reactTicks = Math.round(REACT / DT);
    const frames: Frame[] = [];
    let nextFrame = 0;
    let target = s.px;
    for (let i = 0; i < max / DT && s.phase === 'play'; i++) {
      if (i % reactTicks === 0) target = botTarget(s);
      step(s, toward(s, target), DT);
      if (opts.record && (s.t >= nextFrame || s.phase !== 'play')) {
        nextFrame += opts.record;
        const shapes: Shape[] = [];
        for (const b of s.blocks) if (b.alive) shapes.push({ kind: 'rect', x: b.x, y: b.y, w: b.w, h: C.BLOCK_H, color: '#ff6b8b' });
        shapes.push({ kind: 'rect', x: s.px - C.PLAYER_W / 2, y: C.PLAYER_Y, w: C.PLAYER_W, h: C.PLAYER_H, color: '#7dfcd0', label: 'bot' });
        frames.push({ t: s.t, shapes, hud: { giây: score(s), 'tốc độ rơi': +fallSpeed(s.t).toFixed(1), phase: s.phase } });
      }
    }
    return { seed, won: s.phase === 'won', seconds: s.t, score: score(s), ...(opts.record ? { frames } : {}) };
  },
};
