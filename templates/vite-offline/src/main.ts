/** Vẽ + input. Mọi luật nằm ở engine.ts; file này không quyết định gì về gameplay. */
import './style.css';
import * as C from './config';
import { createState, start, step, score, type Dir } from './engine';
import { fitCanvas, runLoop } from './canvas';
import { dailySeed } from './rng';
import { submitScore, syncSave, track, onRemoteSave } from './arcade';

const STEP = 1 / 60; // s — bước logic cố định

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const surface = fitCanvas($<HTMLCanvasElement>('scene'));
const overlay = $('overlay');
const title = $('title');
const sub = $('sub');
const timeEl = $('time');
const bestEl = $('best');

const BEST_KEY = '__GAME_ID__:best';
let best = Number(localStorage.getItem(BEST_KEY)) || 0;
bestEl.textContent = String(best);
onRemoteSave((data) => {
  const b = (data as { best?: unknown } | null)?.best;
  if (typeof b === 'number' && b > best) { best = b; bestEl.textContent = String(best); }
});

const state = createState(dailySeed());
let dir: Dir = 0;
const held = { left: false, right: false };
const updateDir = (): void => { dir = held.left === held.right ? 0 : held.left ? -1 : 1; };

function play(): void {
  start(state);
  overlay.hidden = true;
  track('start');
}

function finish(): void {
  const s = score(state);
  if (s > best) {
    best = s;
    localStorage.setItem(BEST_KEY, String(best));
    syncSave({ best });
    bestEl.textContent = String(best);
  }
  submitScore(s);
  track(state.phase === 'won' ? 'win' : 'lose', { score: s });
  title.textContent = state.phase === 'won' ? 'Thắng!' : 'Trúng rồi';
  sub.textContent = `${s} giây · kỷ lục ${best}`;
  $('play').textContent = 'Chơi lại';
  overlay.hidden = false;
}

// Input: nút ảo (mobile) + bàn phím. pointer events gộp chuột và cảm ứng.
for (const [id, key] of [['left', 'left'], ['right', 'right']] as const) {
  const btn = $(id);
  const on = (v: boolean) => (e: Event): void => { e.preventDefault(); held[key] = v; btn.classList.toggle('on', v); updateDir(); };
  btn.addEventListener('pointerdown', on(true));
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, on(false));
}
const KEYS: Record<string, 'left' | 'right'> = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
addEventListener('keydown', (e) => {
  const k = KEYS[e.code];
  if (k) { held[k] = true; updateDir(); }
  else if ((e.code === 'Space' || e.code === 'Enter') && state.phase !== 'play') play();
});
addEventListener('keyup', (e) => { const k = KEYS[e.code]; if (k) { held[k] = false; updateDir(); } });
$('play').addEventListener('click', play);

runLoop(
  STEP,
  (dt) => {
    if (state.phase !== 'play') return;
    step(state, override ?? dir, dt);
    if (state.phase !== 'play') finish();
  },
  () => {
    const { ctx, w, h } = surface;
    const u = Math.min(w / C.FIELD_W, h / C.FIELD_H); // px mỗi ô
    const ox = (w - u * C.FIELD_W) / 2;
    const oy = (h - u * C.FIELD_H) / 2;
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#121a33';
    ctx.fillRect(ox, oy, u * C.FIELD_W, u * C.FIELD_H);
    ctx.fillStyle = '#ff6b8b';
    for (const b of state.blocks) if (b.alive) ctx.fillRect(ox + b.x * u, oy + b.y * u, b.w * u, C.BLOCK_H * u);
    ctx.fillStyle = '#7dfcd0';
    ctx.fillRect(ox + (state.px - C.PLAYER_W / 2) * u, oy + C.PLAYER_Y * u, C.PLAYER_W * u, C.PLAYER_H * u);
    timeEl.textContent = String(score(state));
  },
);

// Cho playtest (G3) đọc state và đẩy input, không phải đoán từ pixel.
/**
 * Cổng cho agent và playtest (G3): đọc state, ra lệnh như người chơi.
 * Hợp đồng ổn định giữa các game — playtest dùng chung chỉ biết những tên này.
 * setInput(dx) giữ hướng cho tới khi thả (setInput(null)), thắng bàn phím/nút ảo.
 */
let override: Dir | null = null;
(window as unknown as { __game: unknown }).__game = {
  state: () => state,
  me: () => 'me',
  mode: () => 'local',
  start: () => play(),
  setInput: (dx: number | null) => { override = dx === null ? null : (Math.sign(dx) as Dir); },
};
