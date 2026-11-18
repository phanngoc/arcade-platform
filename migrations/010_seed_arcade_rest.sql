-- 9 game còn lại của batch arcade-2026-09-07 (game đầu đã vào ở 009).
-- Cùng một hình dạng: vite -> client_dir "dist", chơi đơn -> mode offline,
-- chỉ leaderboard + save + track. Chưa gắn domain: phục vụ qua /g/<id>/.
-- Tên bảng phải khớp arcade.toml của từng game, nếu không POST /v1/leaderboard
-- trả BOARD_NOT_DECLARED (packages/services/src/leaderboard/index.ts:45).

insert into games (id, name, manifest, created_from) values
  ('ruins-dash', 'Ruins Dash',
   '{"game":{"client_dir":"dist"},"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;

insert into games (id, name, manifest, created_from) values
  ('tiny-road-hopper', 'Tiny Road Hopper',
   '{"game":{"client_dir":"dist"},"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;

insert into games (id, name, manifest, created_from) values
  ('rocket-workshop', 'Rocket Workshop',
   '{"game":{"client_dir":"dist"},"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;

insert into games (id, name, manifest, created_from) values
  ('slice-orchard', 'Slice Orchard',
   '{"game":{"client_dir":"dist"},"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;

insert into games (id, name, manifest, created_from) values
  ('pulse-cube', 'Pulse Cube',
   '{"game":{"client_dir":"dist"},"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;

insert into games (id, name, manifest, created_from) values
  ('prism-tower', 'Prism Tower',
   '{"game":{"client_dir":"dist"},"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;

insert into games (id, name, manifest, created_from) values
  ('spiral-drop', 'Spiral Drop',
   '{"game":{"client_dir":"dist"},"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;

insert into games (id, name, manifest, created_from) values
  ('maze-spark', 'Maze Spark',
   '{"game":{"client_dir":"dist"},"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;

insert into games (id, name, manifest, created_from) values
  ('cloudbound-hop', 'Cloudbound Hop',
   '{"game":{"client_dir":"dist"},"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;
