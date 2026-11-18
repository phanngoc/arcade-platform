import { describe, expect, it } from 'vitest';
import * as C from '../src/shared/config';
import { initialState, join, setInput, tick, botInput, leave } from '../src/shared/rules';

const DT = 1 / C.TICK_RATE;

describe('balance (spec.json → balance)', () => {
  for (const b of C.BALANCE) it(`${b.param}: ${b.why}`, () => expect(b.ok).toBe(true));
});

describe('luật', () => {
  it('state là JSON thuần: qua JSON vẫn y nguyên (platform lưu và gửi nó)', () => {
    const s = initialState(1);
    join(s, 'a', null);
    tick(s, DT);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('input là hướng, bị chặn độ dài: gửi (100, 0) không đi nhanh hơn', () => {
    const s = initialState(1);
    join(s, 'a', null);
    const x0 = s.players.a!.x;
    setInput(s, 'a', 100, 0);
    tick(s, DT);
    expect(s.players.a!.x - x0).toBeCloseTo(C.PLAYER_SPEED * DT, 5);
  });

  it('input rác bị bỏ qua', () => {
    const s = initialState(1);
    join(s, 'a', null);
    setInput(s, 'a', 'x', NaN);
    expect(s.players.a!.dx).toBe(0);
  });

  it('cùng seed + cùng input → cùng ván', () => {
    const run = () => {
      const s = initialState(9);
      join(s, 'a', null);
      for (let i = 0; i < 200; i++) { const b = botInput(s, 'a'); setInput(s, 'a', b.dx, b.dy); tick(s, DT); }
      return s;
    };
    expect(run()).toEqual(run());
  });

  it('người rời đi thì mất khỏi state', () => {
    const s = initialState(1);
    join(s, 'a', null);
    leave(s, 'a');
    expect(s.players.a).toBeUndefined();
  });
});

describe('G3 — chơi được', () => {
  it('2 bot: có người thắng trong 90s, rồi ván mới tự bắt đầu', () => {
    const s = initialState(3);
    join(s, 'a', null);
    join(s, 'b', null);
    let winner: string | null = null;
    for (let i = 0; i < 90 * C.TICK_RATE && !winner; i++) {
      for (const id of ['a', 'b']) { const b = botInput(s, id); setInput(s, id, b.dx, b.dy); }
      winner = tick(s, DT);
    }
    expect(winner).not.toBeNull();
    for (let i = 0; i <= (C.RESTART_AFTER + 0.1) * C.TICK_RATE; i++) tick(s, DT);
    expect(s.phase).toBe('play');
    expect(s.players.a!.score + s.players.b!.score).toBe(0);
  });
});
