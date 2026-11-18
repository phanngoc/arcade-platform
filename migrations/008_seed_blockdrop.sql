-- Game thứ 4: Block Drop (xếp khối bằng thanh kéo + bạn đồng hành hologram).
-- Offline như castle/rumba: không có server/room.js, không chạm tầng stateful.
-- client_dir mặc định "." (file tĩnh nằm ngay gốc thư mục game) nên không khai.
insert into games (id, name, manifest, created_from) values
  ('blockdrop', 'Block Drop',
   '{"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;

-- Domain riêng để URL công khai giống 3 game kia (bomclaw.org/<game>).
-- Chưa dựng tunnel thì cột này vô hại: /g/blockdrop/ vẫn phục vụ được.
update games set domains = array['drop.bomclaw.org'] where id = 'blockdrop';
