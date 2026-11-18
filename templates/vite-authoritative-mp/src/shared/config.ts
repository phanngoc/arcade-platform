/**
 * Tham số cân bằng — dùng CHUNG bởi client (dự đoán/vẽ) và server/room.ts
 * (chân lý). Đơn vị thế giới là "ô" (u). Đổi số → cập nhật spec.json → balance.
 */
export const FIELD_W = 12; // u
export const FIELD_H = 18; // u
export const PLAYER_R = 0.5; // u — bán kính
export const PLAYER_SPEED = 6; // u/s
export const COIN_R = 0.4; // u
export const WIN_SCORE = 10; // xu — ai nhặt đủ trước thì thắng ván
export const RESTART_AFTER = 4; // s — ván xong, chờ chừng này rồi ván mới
export const TICK_RATE = 20; // Hz — server; 30 là trần cho game 2D, đây không cần hơn
export const MAX_PLAYERS = 4;

export const BALANCE = [
  {
    param: 'PLAYER_SPEED',
    ok: Math.hypot(FIELD_W, FIELD_H) / PLAYER_SPEED <= 4,
    why: 'đi chéo hết sân không quá 4s — xa hơn thì người ở góc không bao giờ tranh được xu',
  },
  {
    param: 'TICK_RATE',
    ok: PLAYER_SPEED / TICK_RATE < PLAYER_R + COIN_R,
    why: 'mỗi tick đi ít hơn khoảng nhặt xu, không thì đi xuyên qua xu mà không nhặt',
  },
] as const;
