-- 10 game batch arcade-2026-09-07 lên platform.
--
-- Khác 4 game trước ở một điểm: đây là game build bằng vite, file tĩnh nằm ở
-- dist/ chứ không phải gốc thư mục -> phải khai manifest.game.client_dir,
-- chính là cột mà packages/services/src/bundle/index.ts:55 đọc.
--
-- Tất cả đều chơi đơn: mode "offline", chỉ dùng leaderboard + save + track.
-- Rooms API không áp dụng (SDK chỉ cho phép với authoritative/relay).
--
-- Chưa gắn domain riêng: cột domains để rỗng, game phục vụ qua /g/<id>/.
-- Khi nào chốt tên miền thì chạy migration riêng cập nhật domains.

insert into games (id, name, manifest, created_from) values
  ('neon-lane-runner', 'Neon Lane Runner',
   '{"game":{"client_dir":"dist"},"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;
