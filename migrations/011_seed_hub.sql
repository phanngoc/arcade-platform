-- Hub công khai: trang danh mục + Forge.
--
-- Hub tự nó là một row trong bảng games, client_dir "." -> tái dùng nguyên si
-- bundle server có sẵn (packages/services/src/bundle/index.ts), không thêm
-- đường phục vụ tĩnh nào. Nhờ vậy hub vừa chạy ở /g/hub/ vừa chạy ở domain riêng.
--
-- Row này còn là "audience" của token: /v1/auth/guest cần gameId tồn tại, và
-- /v1/forge/* chỉ nhận token có gid = 'hub'.

insert into games (id, name, manifest, domains, created_from) values
  ('hub', 'Arcade Hub',
   '{"game":{"client_dir":".","tagline":"Danh mục + Forge"},"runtime":{"mode":"offline"},"capabilities":{"save":false,"leaderboard":[]}}'::jsonb,
   array['play.bomclaw.org'],
   'human')
on conflict (id) do update set domains = excluded.domains, manifest = excluded.manifest;
