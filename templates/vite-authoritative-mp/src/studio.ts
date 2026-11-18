/**
 * Game tự mô tả cho Studio của platform — xem studio-contract.ts.
 * Mô phỏng một ván đúng như server chạy: 2 bot, nhịp TICK_RATE, cùng src/shared/rules.ts.
 */
import * as C from './shared/config';
import { initialState, join, setInput, tick, botInput } from './shared/rules';
import { numbers, type GameStudio, type Frame, type Shape } from './studio-contract';

const BOTS = ['a', 'b'] as const;
const COLORS = ['#7dfcd0', '#9b8cff'];
const DT = 1 / C.TICK_RATE;

export const studio: GameStudio = {
  world: { w: C.FIELD_W, h: C.FIELD_H },
  config: numbers(C),
  balance: C.BALANCE,
  curves: [
    {
      id: 'crossTime',
      label: 'Thời gian đi tới xu theo khoảng cách',
      unit: 's',
      x: { label: 'khoảng cách (u)', from: 0, to: Math.ceil(Math.hypot(C.FIELD_W, C.FIELD_H)), step: 1 },
      f: (d) => d / C.PLAYER_SPEED,
    },
  ],
  simulate(seed, opts = {}) {
    const s = initialState(seed);
    for (const id of BOTS) join(s, id, `Bot ${id.toUpperCase()}`);
    const max = opts.maxSeconds ?? 120;
    const frames: Frame[] = [];
    let nextFrame = 0;
    let t = 0;
    let winner: string | null = null;
    // Bot B chậm hơn một chút: hai bot y hệt nhau thì ván chỉ là may rủi.
    for (; t < max && !winner; t += DT) {
      for (const [i, id] of BOTS.entries()) {
        const b = botInput(s, id);
        setInput(s, id, b.dx * (i === 0 ? 1 : 0.85), b.dy * (i === 0 ? 1 : 0.85));
      }
      winner = tick(s, DT);
      if (opts.record && (t >= nextFrame || winner)) {
        nextFrame += opts.record;
        const shapes: Shape[] = [{ kind: 'circle', x: s.coin.x, y: s.coin.y, r: C.COIN_R, color: '#ffd166', label: 'xu' }];
        BOTS.forEach((id, i) => {
          const p = s.players[id]!;
          shapes.push({ kind: 'circle', x: p.x, y: p.y, r: C.PLAYER_R, color: COLORS[i]!, label: p.name });
        });
        frames.push({ t, shapes, hud: { A: s.players.a!.score, B: s.players.b!.score } });
      }
    }
    return { seed, won: winner !== null, seconds: t, score: winner ? s.players[winner]!.score : 0, ...(opts.record ? { frames } : {}) };
  },
};
