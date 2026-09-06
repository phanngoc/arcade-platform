-- tank-battle: game authoritative đầu tiên. Đây là bài test của abstraction ở M1.
insert into games (id, name, manifest, created_from) values (
  'tank-battle', 'Tank Battle 90',
  '{"runtime":{"mode":"authoritative","tick_rate":30,"max_players":4,"idle_timeout_sec":60,"reconnect_window_sec":30},
    "capabilities":{"save":false,"leaderboard":["daily","alltime"]},
    "limits":{"state_bytes":131072,"msg_per_sec":30,"cpu_ms_per_tick":8}}'::jsonb,
  'human'
) on conflict (id) do update set manifest = excluded.manifest;
