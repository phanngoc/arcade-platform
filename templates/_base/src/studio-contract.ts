/**
 * Hợp đồng giữa game và Studio của platform (`arcade studio`, các action
 * balance.check / curves.get / bot.simulate / bot.replay). src/studio.ts của
 * game export `studio: GameStudio`; platform nạp nó trong Node (esbuild), nên
 * MỌI THỨ ở đây phải chạy không cần DOM — đó cũng là lý do engine phải thuần.
 *
 * Studio không biết game vẽ thế nào: nó phát lại một ván bằng `Shape` (hình
 * khối trong toạ độ thế giới). Đủ để developer thấy bot làm gì và chết ở đâu.
 */
export interface Shape {
  kind: 'rect' | 'circle';
  x: number; // rect: mép trái; circle: tâm — đơn vị thế giới
  y: number;
  w?: number;
  h?: number;
  r?: number;
  color: string;
  label?: string;
}

export interface Frame {
  t: number; // s
  shapes: Shape[];
  hud?: Record<string, string | number>;
}

export interface Curve {
  id: string;
  label: string; // vd "Tốc độ rơi"
  unit: string; // đơn vị trục y, vd "u/s"
  x: { label: string; from: number; to: number; step: number };
  f: (x: number) => number;
}

export interface Run {
  seed: number;
  won: boolean;
  seconds: number; // thời gian ván (tới khi thắng/thua/hết giờ)
  score: number;
  frames?: Frame[];
}

export interface GameStudio {
  world: { w: number; h: number };
  /** Mọi hằng số trong config.ts — Studio hiện và cho sửa (config.set). */
  config: Record<string, number>;
  /** = BALANCE trong config.ts: ràng buộc mà sai thì game không chơi được. */
  balance: readonly { param: string; ok: boolean; why: string }[];
  /** Đường cong độ khó (tốc độ, mật độ… theo thời gian/màn). */
  curves: Curve[];
  /** Một ván do bot chơi, tất định theo seed. record = ghi một Frame mỗi `record` giây. */
  simulate(seed: number, opts?: { record?: number; maxSeconds?: number }): Run;
}

/** Lấy mọi hằng số kiểu số của một module config. */
export function numbers(mod: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(mod)) if (typeof v === 'number') out[k] = v;
  return out;
}
