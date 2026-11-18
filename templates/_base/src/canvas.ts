/**
 * Canvas theo kích thước phần tử, DPR chặn ở 2 (hơn nữa chỉ tốn fill rate trên
 * mobile). Trả về hệ toạ độ CSS px: vẽ bằng w/h, không cần nhân DPR.
 */
export const DPR_CAP = 2;

export interface Surface {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

export function fitCanvas(canvas: HTMLCanvasElement): Surface {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d không khả dụng');
  const surface: Surface = { ctx, w: 0, h: 0 };
  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const r = canvas.getBoundingClientRect();
    surface.w = r.width;
    surface.h = r.height;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  new ResizeObserver(resize).observe(canvas);
  return surface;
}

/**
 * Vòng lặp bước cố định: logic chạy đúng `step` giây mỗi lần, độc lập tốc độ
 * khung hình — cùng input thì cùng kết quả, bot và test mới tin được.
 */
export function runLoop(step: number, update: (dt: number) => void, draw: () => void): void {
  let last = performance.now();
  let acc = 0;
  const frame = (now: number): void => {
    acc += Math.min((now - last) / 1000, 0.25); // tab ngủ dậy: không chạy bù cả phút
    last = now;
    while (acc >= step) {
      update(step);
      acc -= step;
    }
    draw();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
