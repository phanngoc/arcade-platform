-- Hai game tham chiếu, để `arcade dev` có sẵn thứ chạy được.
insert into games (id, name, manifest, created_from) values
  ('castle', 'Castle Busters',
   '{"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human'),
  ('rumba',  'Rumba',
   '{"runtime":{"mode":"offline"},"capabilities":{"save":true,"leaderboard":["daily","alltime"]}}'::jsonb,
   'human')
on conflict (id) do nothing;
