-- Owner của bảng MẶC ĐỊNH BỎ QUA RLS trong Postgres. Nếu app kết nối bằng chính
-- owner thì mọi policy ở 001 là trang trí. Tách hai vai:
--   arcade      (owner)      -> migration + tác vụ hệ thống (write-behind, reconcile)
--   arcade_app  (không owner) -> mọi truy vấn theo request, CHỊU RLS
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'arcade_app') then
    create role arcade_app login password 'arcade_app';
  end if;
end $$;

grant usage on schema public to arcade_app;
grant select, insert, update, delete on saves, leaderboard_entries to arcade_app;
grant select on games, players to arcade_app;
grant insert on events to arcade_app;
grant execute on function arcade_player_id(), arcade_game_id() to arcade_app;
