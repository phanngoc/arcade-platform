/**
 * Sprite sheet do `sprites.render` (Blender) sinh: public/sprites/<name>.png + .json.
 * Hàng = hướng nhìn (xoay quanh trục đứng), cột = khung animation. `anchor` là pixel
 * của chân mô hình trong khung — đặt điểm này lên vị trí thế giới thì nhân vật đứng đúng ô.
 */
export interface Atlas {
  image: string;
  frameW: number;
  frameH: number;
  directions: number;
  frames: number;
  fps: number;
  anchor: [number, number];
}

export interface Sprite {
  atlas: Atlas;
  img: HTMLImageElement;
}

export async function loadSprite(name: string, base = 'sprites/'): Promise<Sprite> {
  const atlas = (await (await fetch(`${base}${name}.json`)).json()) as Atlas;
  const img = new Image();
  img.src = `${base}${atlas.image}`;
  await img.decode();
  return { atlas, img };
}

/**
 * Hàng hướng nhìn cho một hướng di chuyển trên MÀN HÌNH (dx, dy). Mô hình gốc nhìn
 * về phía -Y thế giới; camera dimetric xoay 45°, nên hàng 0 nhìn xuống-trái màn hình.
 * Tính theo góc, làm tròn về hướng gần nhất trong `directions`.
 */
export function directionRow(a: Atlas, dx: number, dy: number): number {
  if (a.directions === 1 || (dx === 0 && dy === 0)) return 0;
  const screenAngle = Math.atan2(dy, dx); // 0 = sang phải, tăng theo chiều kim đồng hồ (y xuống)
  const facing0 = (3 * Math.PI) / 4; // hàng 0: xuống-trái
  const turns = (facing0 - screenAngle) / (2 * Math.PI);
  return (((Math.round(turns * a.directions) % a.directions) + a.directions) % a.directions);
}

/** Vẽ khung theo thời gian (giây), chân đặt tại (x, y) màn hình. scale = px màn hình / px sprite. */
export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, row: number, t: number, x: number, y: number, scale = 1): void {
  const a = s.atlas;
  const frame = Math.floor(t * a.fps) % a.frames;
  ctx.drawImage(
    s.img,
    frame * a.frameW, row * a.frameH, a.frameW, a.frameH,
    Math.round(x - a.anchor[0] * scale), Math.round(y - a.anchor[1] * scale),
    a.frameW * scale, a.frameH * scale,
  );
}
