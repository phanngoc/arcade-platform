-- 014_castle_economy — ví Castle trên server + cửa hàng + đơn VietQR + entitlement.
-- Server là nguồn sự thật cho vàng/thẻ/cấp quân/XP/entitlement (CONTRACT.md).
-- Các bảng này CHỈ được đọc/ghi bằng vai owner trong services (tác vụ hệ thống
-- có lọc player_id tường minh). arcade_app không được grant ⇒ RLS fail đóng.

create table castle_profiles (
  player_id        uuid primary key references players(id) on delete cascade,
  gold             bigint      not null default 0 check (gold >= 0),
  cards            jsonb       not null default '{}'::jsonb,   -- {unit: n}
  units            jsonb       not null default '{}'::jsonb,   -- {unit: lvl 1..9}
  level            int         not null default 1 check (level between 1 and 30),
  xp               int         not null default 0 check (xp >= 0), -- XP trong cấp hiện tại
  best_stage       int         not null default 0,
  pass_until       timestamptz,
  pass_claimed_day date,
  quest_day        date,
  quests           jsonb       not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

create table castle_matches (
  match_id    text primary key,
  player_id   uuid        not null references players(id) on delete cascade,
  mode        text        not null check (mode in ('campaign', 'standard')),
  stage       int         not null default 0,
  won         boolean     not null,
  duration_ms int         not null,
  rewarded    boolean     not null,
  reward      jsonb       not null default '{}'::jsonb,
  day         date        not null,
  created_at  timestamptz not null default now()
);
create index castle_matches_player_day on castle_matches (player_id, day);

create table orders (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid        not null references players(id) on delete cascade,
  game_id    text        not null,
  sku        text        not null,
  amount     int         not null check (amount > 0),
  code       text        not null unique,             -- 'ARC' + 8 ký tự, nằm trong nội dung CK
  params     jsonb       not null default '{}'::jsonb,
  status     text        not null default 'pending' check (status in ('pending', 'paid', 'expired')),
  sandbox    boolean     not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  paid_at    timestamptz
);
create index orders_player_sku on orders (player_id, sku, created_at);

create table payment_events (
  provider_txn text primary key,                      -- idempotent: một giao dịch chỉ xử lý một lần
  order_id     uuid references orders(id) on delete set null,
  amount       bigint      not null,
  outcome      text        not null,                  -- granted | already_paid
  payload      jsonb       not null,
  created_at   timestamptz not null default now()
);

create table entitlements (
  id         bigserial primary key,
  player_id  uuid        not null references players(id) on delete cascade,
  sku        text        not null,
  source     text        not null,                    -- order:<id> | level:<n>
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (player_id, sku, source)
);
create index entitlements_player on entitlements (player_id);

alter table castle_profiles enable row level security;
alter table castle_matches  enable row level security;
alter table orders          enable row level security;
alter table payment_events  enable row level security;
alter table entitlements    enable row level security;

-- Bảng 'standard' (Đấu Chuẩn, mọi quân ép cấp 5) cho castle.
update games
   set manifest = jsonb_set(manifest, '{capabilities,leaderboard}',
         coalesce(manifest #> '{capabilities,leaderboard}', '[]'::jsonb) || '["standard"]'::jsonb)
 where id = 'castle'
   and not coalesce(manifest #> '{capabilities,leaderboard}', '[]'::jsonb) ? 'standard';
