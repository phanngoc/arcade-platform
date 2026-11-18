-- Queens: câu đố logic đặt hậu (họ LinkedIn Queens), anh em với Rumba.
-- Offline, file tĩnh ngay gốc thư mục game (client_dir mặc định ".").
-- Tên bảng khớp arcade.toml: daily + alltime.
insert into games (id, name, manifest, created_from) values
  ('queens', 'Queens',
   '{"game":{"tagline":"Câu đố đặt hậu — mỗi hàng, cột, vùng một hậu"},"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;

update games set domains = array['queens.bomclaw.org'] where id = 'queens';
