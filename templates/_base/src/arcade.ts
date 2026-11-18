/**
 * Cầu nối tới platform Arcade — bọc `window.ArcadeGame` do public/arcade-bridge.js gắn.
 * Ngoài platform (npm run dev, vitest) mọi hàm là no-op: game không bao giờ
 * phụ thuộc platform để chơi được.
 */
export interface ArcadeBridge {
  ready: boolean;
  playerId: string | null;
  onScore(board: string, score: number, name?: string | null): void;
  syncSave(data: unknown): void;
  top(board: string, n?: number): Promise<unknown[]>;
  remote?: unknown;
  track?(name: string, props?: Record<string, unknown>): void;
}

type ArcadeWindow = typeof globalThis & {
  ArcadeGame?: ArcadeBridge;
  __arcadeApplyRemote?: (data: unknown) => void;
};

function bridge(): ArcadeBridge | null {
  const b = (globalThis as ArcadeWindow).ArcadeGame;
  return b && typeof b.onScore === 'function' ? b : null;
}

/** Điểm của một lượt — gửi vào mọi bảng khai trong arcade.toml [capabilities].leaderboard. */
export function submitScore(score: number, boards: readonly string[] = ['daily', 'alltime']): void {
  const b = bridge();
  if (!b || !Number.isFinite(score) || score <= 0) return;
  for (const board of boards) b.onScore(board, Math.trunc(score));
}

export function syncSave(data: unknown): void {
  bridge()?.syncSave(data);
}

export function track(name: string, props?: Record<string, unknown>): void {
  bridge()?.track?.(name, props);
}

/** Save kéo về từ máy khác. Bridge có thể đã nhận trước khi game kịp đăng ký — đọc cả .remote. */
export function onRemoteSave(apply: (data: unknown) => void): void {
  const w = globalThis as ArcadeWindow;
  w.__arcadeApplyRemote = apply;
  const pending = bridge()?.remote;
  if (pending) apply(pending);
}
