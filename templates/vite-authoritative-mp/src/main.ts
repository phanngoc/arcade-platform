/** Vẽ + input + sảnh. Luật nằm ở src/shared/rules.ts; file này không quyết định gameplay. */
import './style.css';
import * as C from './shared/config';
import { fitCanvas, runLoop } from './canvas';
import { online, local, platformAvailable, inviteCode, type Session } from './net';
import { track } from './arcade';

// Không dùng vàng (#ffd166): đó là màu xu — người chơi lẫn với xu là lỗi đọc màn hình.
const COLORS = ['#7dfcd0', '#9b8cff', '#ff6b8b', '#6ec3ff'];
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const surface = fitCanvas($<HTMLCanvasElement>('scene'));
const overlay = $('overlay');
const status = $('sub');
const codeEl = $('code');
const scoresEl = $('scores');

let session: Session | null = null;
const input = { dx: 0, dy: 0 };
// Agent/playtest điều khiển qua window.__game.setInput — thắng bàn phím/chạm
// cho tới khi thả ra (setInput(null)). Không có cái này thì input từ ngoài bị
// vòng lặp ghi đè ngay khung hình sau.
let override: { dx: number; dy: number } | null = null;

async function begin(kind: 'create' | 'join' | 'local'): Promise<void> {
  try {
    status.textContent = 'Đang vào…';
    if (kind === 'local') session = local(Date.now());
    else session = await online(kind === 'join' ? ($<HTMLInputElement>('join-code').value.trim() || inviteCode()) : null);
    overlay.hidden = true;
    if (session.code) {
      const url = new URL(location.href);
      url.searchParams.set('room', session.code);
      history.replaceState(null, '', url);
      codeEl.textContent = `Phòng ${session.code}`;
      codeEl.title = url.toString();
    } else codeEl.textContent = 'Chơi thử (không mạng)';
    track('start', { mode: session.mode });
  } catch (e) {
    status.textContent = `Không vào được: ${(e as Error).message}`;
  }
}

$('create').addEventListener('click', () => void begin('create'));
$('join').addEventListener('click', () => void begin('join'));
$('local').addEventListener('click', () => void begin('local'));
codeEl.addEventListener('click', () => void navigator.clipboard?.writeText(codeEl.title));
if (!platformAvailable()) {
  for (const id of ['create', 'join', 'join-code']) $(id).hidden = true;
  status.textContent = 'Chưa có platform (đang chạy local): chơi thử với bot bằng đúng luật của server.';
} else if (inviteCode()) {
  $<HTMLInputElement>('join-code').value = inviteCode()!;
}

// Input: kéo ngón tay/chuột trên sân = đi về phía đó; bàn phím WASD/mũi tên.
const canvas = $<HTMLCanvasElement>('scene');
let pointer: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointer = { x: e.offsetX, y: e.offsetY }; });
canvas.addEventListener('pointermove', (e) => { if (pointer) { pointer.x = e.offsetX; pointer.y = e.offsetY; } });
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { pointer = null; });
const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));

function view() {
  const { w, h } = surface;
  const u = Math.min(w / C.FIELD_W, h / C.FIELD_H);
  return { u, ox: (w - u * C.FIELD_W) / 2, oy: (h - u * C.FIELD_H) / 2 };
}

function readInput(): void {
  const s = session?.state();
  let dx = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
  let dy = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
  const me = s?.players[session!.me];
  if (override) { dx = override.dx; dy = override.dy; }
  else if (pointer && me) {
    const { u, ox, oy } = view();
    const tx = (pointer.x - ox) / u - me.x;
    const ty = (pointer.y - oy) / u - me.y;
    const len = Math.hypot(tx, ty);
    if (len > 0.3) { dx = tx / len; dy = ty / len; } else { dx = 0; dy = 0; }
  }
  input.dx = dx;
  input.dy = dy;
  session?.input(dx, dy);
}

runLoop(
  1 / 60,
  (dt) => { if (session) { readInput(); session.step(dt); } },
  () => {
    const { ctx, w, h } = surface;
    const { u, ox, oy } = view();
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#121a33';
    ctx.fillRect(ox, oy, u * C.FIELD_W, u * C.FIELD_H);
    const s = session?.state();
    if (!s) return;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(ox + s.coin.x * u, oy + s.coin.y * u, C.COIN_R * u, 0, Math.PI * 2);
    ctx.fill();
    let i = 0;
    let line = '';
    for (const id in s.players) {
      const p = s.players[id]!;
      ctx.fillStyle = COLORS[i++ % COLORS.length]!;
      ctx.beginPath();
      ctx.arc(ox + p.x * u, oy + p.y * u, C.PLAYER_R * u, 0, Math.PI * 2);
      ctx.fill();
      if (id === session!.me) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
      line += `${p.name} ${p.score}  `;
    }
    if (scoresEl.textContent !== line) scoresEl.textContent = line;
    if (s.phase === 'over' && s.winner) {
      ctx.fillStyle = '#e8ecff';
      ctx.font = '700 28px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`${s.players[s.winner]?.name ?? '?'} thắng!`, w / 2, h / 2);
    }
  },
);

/**
 * Cổng cho agent và playtest (G3): đọc state, ra lệnh như người chơi.
 * Hợp đồng ổn định giữa các game — playtest dùng chung chỉ biết những tên này.
 */
(window as unknown as { __game: unknown }).__game = {
  state: () => session?.state() ?? null,
  me: () => session?.me ?? null,
  mode: () => session?.mode ?? null,
  start: (kind: 'create' | 'join' | 'local' = 'local') => begin(kind),
  setInput: (dx: number | null, dy = 0) => { override = dx === null ? null : { dx, dy }; },
};
