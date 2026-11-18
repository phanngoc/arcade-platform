/**
 * Tham số cân bằng — MỌI con số gameplay ở đây, có tên và đơn vị.
 * Đơn vị thế giới là "ô" (u): sân rộng FIELD_W u, cao FIELD_H u, portrait.
 * Đổi một số ở đây → cập nhật `balance` trong spec.json cùng commit.
 */
export const FIELD_W = 10; // u
export const FIELD_H = 16; // u
export const PLAYER_W = 1; // u
export const PLAYER_H = 0.8; // u
export const PLAYER_Y = 14.5; // u — hàng của người chơi, tính từ đỉnh
export const PLAYER_SPEED = 9; // u/s

export const BLOCK_H = 0.6; // u
export const BLOCK_W_MIN = 1; // u
export const BLOCK_W_MAX = 2.6; // u
export const FALL_SPEED_START = 5; // u/s
export const FALL_SPEED_MAX = 11; // u/s
export const FALL_ACCEL = 0.1; // u/s² — tốc độ rơi tăng theo thời gian
export const SPAWN_EVERY_START = 0.9; // s
export const SPAWN_EVERY_MIN = 0.45; // s
export const SPAWN_SPEEDUP = 0.008; // s giảm mỗi giây chơi

export const WIN_SECONDS = 60; // s — sống đủ chừng này là thắng
export const MAX_BLOCKS = 32; // pool cố định: không cấp phát trong vòng lặp

/**
 * Ràng buộc mà sai thì game KHÔNG THỂ chơi được — cùng nội dung với
 * spec.json → balance, và test kiểm chúng trên các số thật ở trên.
 */
export const BALANCE = [
  {
    param: 'PLAYER_SPEED',
    ok: PLAYER_SPEED * (PLAYER_Y / FALL_SPEED_MAX) >= BLOCK_W_MAX + PLAYER_W,
    why: 'khối rơi nhanh nhất vẫn phải để đủ thời gian né qua khối rộng nhất',
  },
  {
    param: 'BLOCK_W_MAX',
    ok: BLOCK_W_MAX <= FIELD_W - 2 * PLAYER_W,
    why: 'khối không được chắn kín sân — luôn còn khe cho người chơi',
  },
  {
    param: 'SPAWN_EVERY_MIN',
    ok: SPAWN_EVERY_MIN * FALL_SPEED_MAX > BLOCK_H + PLAYER_H,
    why: 'hai khối liên tiếp không được chồng thành một bức tường cao hơn người chơi',
  },
] as const;
