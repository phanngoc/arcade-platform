import { describe, expect, it } from 'vitest';
import * as C from '../src/config';
import { createState, start, step, type Dir } from '../src/engine';
import { studio } from '../src/studio';

const DT = 1 / 60;

function run(seed: number, policy: (s: ReturnType<typeof createState>) => Dir, maxSeconds = C.WIN_SECONDS + 1) {
  const s = createState(seed);
  start(s);
  for (let i = 0; i < maxSeconds / DT && s.phase === 'play'; i++) step(s, policy(s), DT);
  return s;
}

describe('balance (spec.json → balance)', () => {
  for (const b of C.BALANCE) it(`${b.param}: ${b.why}`, () => expect(b.ok).toBe(true));
});

describe('luật', () => {
  it('cùng seed, cùng input → cùng ván (bot và test tin được)', () => {
    const a = run(7, () => 1, 5);
    const b = run(7, () => 1, 5);
    expect(a.t).toBe(b.t);
    expect(a.blocks.map((x) => x.x)).toEqual(b.blocks.map((x) => x.x));
  });

  it('đứng yên giữa sân thì sớm muộn cũng thua', () => {
    expect(run(1, () => 0).phase).toBe('lost');
  });

  it('người chơi không ra khỏi sân', () => {
    const s = run(3, () => -1, 3);
    expect(s.px).toBeGreaterThanOrEqual(C.PLAYER_W / 2);
  });
});

describe('G3 — chơi được: bot thắng được', () => {
  // Cùng bot với Studio (src/studio.ts): thứ developer thấy trong Studio là thứ test chấm.
  it('bot phản xạ 200ms thắng ≥ 18/20 seed', () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) if (studio.simulate(seed).won) wins++;
    expect(wins).toBeGreaterThanOrEqual(18);
  });

  it('studio: hợp đồng đủ — config có mọi số, replay có khung hình', () => {
    expect(studio.config.PLAYER_SPEED).toBe(C.PLAYER_SPEED);
    const r = studio.simulate(1, { record: 0.5, maxSeconds: 3 });
    expect(r.frames!.length).toBeGreaterThanOrEqual(6);
    expect(r.frames![0]!.shapes.some((x) => x.label === 'bot')).toBe(true);
  });
});
