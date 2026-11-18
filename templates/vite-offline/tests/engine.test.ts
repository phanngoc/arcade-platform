import { describe, expect, it } from 'vitest';
import * as C from '../src/config';
import { createState, start, step, botTarget, toward, type Dir } from '../src/engine';

const DT = 1 / 60;

const DT_REACT = 0.2; // s — phản xạ người: bot chọn đích mỗi 200ms, giữa đó chỉ đi tới đích
const REACT_TICKS = Math.round(DT_REACT / DT);

type Policy = (s: ReturnType<typeof createState>) => Dir;

function run(seed: number, policy: Policy | 'bot', maxSeconds = C.WIN_SECONDS + 1) {
  const s = createState(seed);
  start(s);
  let target = s.px;
  for (let i = 0; i < maxSeconds / DT && s.phase === 'play'; i++) {
    if (policy === 'bot') {
      if (i % REACT_TICKS === 0) target = botTarget(s);
      step(s, toward(s, target), DT);
    } else step(s, policy(s), DT);
  }
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
  it('bot phản xạ 200ms thắng ≥ 18/20 seed', () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) if (run(seed, 'bot').phase === 'won') wins++;
    expect(wins).toBeGreaterThanOrEqual(18);
  });
});
