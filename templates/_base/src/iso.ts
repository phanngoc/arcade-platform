/**
 * 2.5D — phép chiếu dimetric 2:1 ("isometric" của game): khớp camera `dimetric`
 * của sprites.render (Blender, nghiêng 60°, xoay 45°), nên sprite render ra đặt
 * thẳng lên lưới này. Ô (gx, gy) là ô vuông trong thế giới; màn hình thấy hình thoi
 * rộng TILE_W, cao TILE_W/2. Thuần, không DOM — test được.
 */
export interface IsoView {
  tileW: number; // px, chiều rộng hình thoi; cao = tileW / 2
  originX: number; // px màn hình của góc ô (0,0)
  originY: number;
}

/** Ô thế giới → điểm màn hình (đỉnh trên của hình thoi khi gx, gy nguyên). z = độ cao, tính bằng ô. */
export function toScreen(v: IsoView, gx: number, gy: number, z = 0): { x: number; y: number } {
  const hw = v.tileW / 2;
  const hh = v.tileW / 4;
  return { x: v.originX + (gx - gy) * hw, y: v.originY + (gx + gy) * hh - z * hh * 2 };
}

/** Điểm màn hình → ô thế giới (số thực; Math.floor để ra ô bị chạm). */
export function toGrid(v: IsoView, sx: number, sy: number): { gx: number; gy: number } {
  const hw = v.tileW / 2;
  const hh = v.tileW / 4;
  const a = (sx - v.originX) / hw;
  const b = (sy - v.originY) / hh;
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
}

/**
 * Thứ tự vẽ: xa trước, gần sau. Với dimetric, "gần" = gx + gy lớn; cùng hàng chéo
 * thì vật cao (z) vẽ sau. Sắp TẠI CHỖ để không cấp phát mỗi khung.
 */
export function depthSort<T extends { gx: number; gy: number; z?: number }>(items: T[]): T[] {
  return items.sort((p, q) => p.gx + p.gy - (q.gx + q.gy) || (p.z ?? 0) - (q.z ?? 0));
}

/** Hình thoi của một ô (để tô nền / vẽ lưới / tô ô đang chọn). */
export function tilePath(ctx: CanvasRenderingContext2D, v: IsoView, gx: number, gy: number): void {
  const t = toScreen(v, gx, gy);
  ctx.beginPath();
  ctx.moveTo(t.x, t.y);
  ctx.lineTo(t.x + v.tileW / 2, t.y + v.tileW / 4);
  ctx.lineTo(t.x, t.y + v.tileW / 2);
  ctx.lineTo(t.x - v.tileW / 2, t.y + v.tileW / 4);
  ctx.closePath();
}
