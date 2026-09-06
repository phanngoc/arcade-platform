-- 001_init — nền M0: players, games, saves, leaderboard, rooms, events.
-- RLS bật ngay từ migration đầu: bật sau khi có dữ liệu thật đau hơn nhiều lần.

create extension if not exists pgcrypto;

create table players (
  id            uuid primary key default gen_random_uuid(),
  is_guest      boolean     not null default true,
  linked_email  text unique,
  created_at    timestamptz not null default now()
);

create table games (
  id            text primary key,
  owner_id      uuid references players(id),
  name          text        not null,
  manifest      jsonb       not null default '{}'::jsonb,
  created_from  text        not null default 'human',
  created_at    timestamptz not null default now()
);

create table saves (
  game_id    text        not null references games(id) on delete cascade,
  player_id  uuid        not null references players(id) on delete cascade,
  data       jsonb       not null,
  version    int         not null default 1,
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create table leaderboard_entries (
  game_id    text        not null references games(id) on delete cascade,
  board      text        not null,
  player_id  uuid        not null references players(id) on delete cascade,
  score      bigint      not null,
  verified   boolean     not null default false,
  meta       jsonb,
  created_at timestamptz not null default now(),
  primary key (game_id, board, player_id)
);
-- truy vấn nóng nhất của M0: top-N của một bảng
create index lb_top on leaderboard_entries (game_id, board, score desc);

create table rooms (
  id            uuid primary key default gen_random_uuid(),
  game_id       text        not null references games(id) on delete cascade,
  code          text        not null,
  mode          text        not null,
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  peak_players  int         not null default 0,
  close_reason  text
);
-- mã phòng chỉ cần duy nhất trong số phòng đang mở
create unique index room_code_open on rooms (code) where closed_at is null;

create table events (
  game_id   text        not null,
  player_id uuid,
  name      text        not null,
  props     jsonb,
  ts        timestamptz not null default now()
) partition by range (ts);

create table events_default partition of events default;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Mỗi request set arcade.player_id / arcade.game_id từ JWT trong transaction.
-- current_setting(..., true) trả null khi chưa set -> policy fail đóng, không mở.

create or replace function arcade_player_id() returns uuid language sql stable as $$
  select nullif(current_setting('arcade.player_id', true), '')::uuid
$$;

create or replace function arcade_game_id() returns text language sql stable as $$
  select nullif(current_setting('arcade.game_id', true), '')
$$;

alter table saves               enable row level security;
alter table leaderboard_entries enable row level security;

create policy own_save on saves
  using      (player_id = arcade_player_id() and game_id = arcade_game_id())
  with check (player_id = arcade_player_id() and game_id = arcade_game_id());

-- Bảng xếp hạng: đọc được của cả game, chỉ ghi được dòng của chính mình.
create policy read_board on leaderboard_entries
  for select using (game_id = arcade_game_id());
create policy write_own_score on leaderboard_entries
  for all using      (game_id = arcade_game_id() and player_id = arcade_player_id())
      with check (game_id = arcade_game_id() and player_id = arcade_player_id());
