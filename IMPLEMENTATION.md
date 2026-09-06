# Arcade — Design cho implement (M0 + M1)

> Tài liệu này **chốt các lựa chọn còn mở** trong [PLATFORM_DESIGN.md](PLATFORM_DESIGN.md) và mô tả đủ chi tiết
> để bắt đầu code. Phạm vi: **M0 (nền) + M1 (realtime)**. M2+ chỉ ghi chỗ nào cần chừa đường.
> Ngày: 2026-09-06.

---

## 0. Nguyên tắc dẫn đường

1. **Một process, một máy, một Postgres cho tới hết M1.** Không Redis, không Kubernetes, không hàng đợi.
   Mọi thứ phân tán để dành M2 — và chỉ thêm khi benchmark nói cần.
2. **SDK phải chạy được bằng `<script src>`.** 3 game hiện có đều không có build step. Nếu SDK bắt buộc
   npm + bundler thì chính 3 game test đầu tiên không dùng được nó. Đây là ràng buộc cứng, không phải sở thích.
3. **Ưu tiên xoá code hơn thêm code.** Thước đo M1 là *xoá được `server.js` + netcode của tank-battle*.
4. **Không nhận code người lạ cho tới khi có sandbox thật** (mục 3.4). Đây là cổng an toàn, không đàm phán.

---

## 1. Stack — đã chốt

| Thành phần | Chọn | Lý do / đánh đổi |
|---|---|---|
| Runtime | **Node.js 22 LTS + TypeScript** | Cùng ngôn ngữ client/server; `ws` đã dùng ở tank-battle |
| HTTP API | **Fastify 5** | Cần routing + schema validation + hook auth; nhẹ hơn Nest, đủ chín |
| WebSocket | **`ws`** (không dùng lớp bọc) | Cần kiểm soát backpressure và ping/pong thủ công |
| DB | **Postgres 16** + **`postgres.js`** | Không ORM: RLS và SQL thuần là thiết kế, ORM chỉ che mất nó |
| Migration | **file SQL đánh số + runner ~50 dòng** | Đủ dùng; tránh thêm một công cụ nữa để học |
| JWT | **`jose`** (HS256 ở M0) | Đổi sang EdDSA khi tách gateway khỏi API (M2) |
| Room isolate | **`node:vm` + watchdog** ở M1 → **`isolated-vm`** ở M2 | Xem mục 3.4 — đây là đánh đổi có rủi ro, đọc kỹ |
| Object storage | **S3-compatible** (MinIO local, Cloudflare R2 prod) | R2 egress $0 — điều kiện sống theo BUSINESS_MODEL §4.2 |
| Test | **`node:test`** + Playwright | Không thêm Jest/Vitest cho một dự án cỡ này |
| Local dev | **Docker Compose** (Postgres + MinIO) + `arcade dev` | |

**Không dùng:** Redis (M2), Kubernetes (không bao giờ ở quy mô này), ORM, GraphQL, monorepo tool
(npm workspaces là đủ).

**Hosting:** Hetzner hoặc tương đương có băng thông kèm theo. **Không AWS/GCP cho tầng realtime** —
egress $0,09/GB giết biên lợi nhuận (BUSINESS_MODEL §4.2).

---

## 2. Cấu trúc repo

```
arcade/
├── packages/
│   ├── protocol/          # dùng chung client+server: kiểu wire, diff/patch, mã phòng
│   │   ├── src/patch.ts       # diff(prev,next) -> Op[]; apply(state,Op[])
│   │   ├── src/wire.ts        # union type mọi message
│   │   └── src/roomcode.ts    # sinh/validate mã 4 ký tự
│   ├── sdk/               # @arcade/client — 0 dependency
│   │   ├── src/index.ts
│   │   └── dist/arcade.global.js   # BẢN IIFE cho <script src> — bắt buộc
│   ├── server/
│   │   ├── src/api/        # Fastify: auth, save, leaderboard, bundle
│   │   ├── src/gateway/    # ws: handshake, rate limit, routing phòng
│   │   ├── src/rooms/      # vòng đời phòng, tick loop, sandbox
│   │   ├── src/db/         # postgres.js + query
│   │   └── src/config.ts
│   ├── cli/               # arcade dev|deploy|test|typegen|bench
│   └── bench/             # sinh tải headless — công cụ cho kill criteria M1
├── templates/
│   ├── canvas2d-offline/          # + AGENTS.md, CLAUDE.md sinh từ skills/game-build
│   └── canvas2d-authoritative-mp/
├── migrations/            # 001_init.sql, 002_...
├── examples/tank-battle/  # bản port — bằng chứng abstraction đúng
└── docker-compose.yml
```

npm workspaces. `protocol` không phụ thuộc gì; `sdk` chỉ phụ thuộc `protocol`.

---

## 3. Thiết kế từng module

### 3.1 `protocol` — state diff/patch

Đây là trái tim kỹ thuật. Sai ở đây thì M1 trượt kill criteria.

```ts
type Op =
  | { o: 's'; p: Path; v: unknown }        // set
  | { o: 'd'; p: Path }                     // delete key
  | { o: 'i'; p: Path; i: number; v: unknown[] }  // splice insert
  | { o: 'r'; p: Path; i: number; n: number }     // splice remove
type Path = (string | number)[]

diff(prev: unknown, next: unknown): Op[]
apply<T>(state: T, ops: Op[]): T      // mutate tại chỗ, trả về chính state
checksum(state: unknown): number      // FNV-1a trên JSON đã sort key
```

Quy tắc:
- Đi sâu theo cấu trúc; **object so sánh theo key, array so sánh theo chỉ số** (không LCS —
  quá tốn cho 30Hz; game phải giữ array ổn định về thứ tự, ghi rõ trong docs).
- Số `float` làm tròn còn **3 chữ số thập phân trước khi diff** — vị trí pixel không cần hơn, và
  đây là đòn giảm băng thông rẻ nhất (bỏ nhiễu ở cuối mantissa).
- Key bắt đầu bằng `_` là **local-only**, không diff, không gửi (chỗ để game nhét cache).

Test bắt buộc: property-based — sinh cặp state ngẫu nhiên, `apply(prev, diff(prev,next))` phải
bằng `next` theo deep-equal, và checksum khớp. Chạy 10.000 cặp trong CI.

### 3.2 Giao thức đường truyền

Text JSON ở M1 (dễ debug); chừa chỗ cho binary bằng cách bọc mọi thứ trong `{t: ...}`.

**Client → Server**
```jsonc
{ "t":"hello",  "token":"<jwt>", "gameId":"...", "v":1 }
{ "t":"create", "mode":"coop", "opts":{...} }
{ "t":"join",   "code":"K3F9", "name":"Ngoc" }
{ "t":"rejoin", "session":"<opaque>" }
{ "t":"msg",    "n":"input", "d":{...} }      // n = tên message
{ "t":"pong",   "id":123 }
{ "t":"resync" }                               // client thấy checksum lệch
```

**Server → Client**
```jsonc
{ "t":"welcome", "playerId":"...", "session":"...", "code":"K3F9", "url":"https://..." }
{ "t":"snap", "s":{...}, "c":12345, "seq":1 }        // full snapshot + checksum
{ "t":"patch","ops":[...], "c":12346, "seq":2 }      // delta sau mỗi tick
{ "t":"ev",   "n":"explosion", "d":{...} }           // broadcast/send từ room
{ "t":"join", "p":{"id":"...","name":"..."} }
{ "t":"left", "p":"<id>", "r":"timeout" }
{ "t":"err",  "code":"ROOM_FULL", "msg":"..." }
{ "t":"ping", "id":123 }
```

- `seq` tăng đơn điệu. Client thấy nhảy số → gửi `resync` → server trả `snap`.
- Server gửi `ping` mỗi 5s; không có `pong` trong 15s → coi là mất kết nối (chưa xoá player,
  vào cửa sổ reconnect).
- **Patch rỗng thì không gửi gói nào.** Game turn-based đứng yên tốn 0 băng thông.

### 3.3 Vòng đời phòng và tick loop

Một `RoomHost` cho mỗi phòng, tất cả chạy chung một event loop ở M1:

```ts
class RoomHost {
  state: object; prevState: object      // prevState là bản clone sau lần diff trước
  players: Map<PlayerId, PlayerConn>
  seq = 0; tickMs: number
  tick() {
    const t0 = performance.now()
    this.drainInbox()                    // gọi onMessage cho input đã nhận
    this.module.onTick(this.room, this.dtSec)
    if (byteSize(this.state) > limits.state_bytes) return this.fail('STATE_TOO_BIG')
    for (const p of this.players.values()) {
      const view = this.module.view ? this.module.view(this.room, p) : this.state
      const ops = diff(p.prevView, view)          // diff theo từng người khi có view()
      if (ops.length) p.send({t:'patch', ops, c: checksum(view), seq: ++this.seq})
      p.prevView = clone(view)
    }
    this.cpuMs.push(performance.now() - t0)
  }
}
```

**Bộ định giờ:** một `setInterval` toàn cục ở 10ms chạy scheduler, không phải một timer mỗi phòng
(hàng nghìn timer làm event loop tệ đi). Mỗi vòng, scheduler chạy các phòng đã tới hạn tick.

**Tối ưu bắt buộc khi không có `view()`:** diff **một lần** cho cả phòng, gửi cùng một mảng ops cho
mọi người, serialize JSON **một lần**. Đây là khác biệt lớn nhất giữa 150 và 400 CCU/vCPU.

**Vượt ngân sách CPU:** nếu 30 tick liên tiếp vượt `cpu_ms_per_tick` → dispose phòng, báo lỗi rõ cho dev.
Một game xấu không được kéo sập host.

**Thu hồi:** phòng không còn kết nối nào (kể cả đang trong cửa sổ reconnect) quá `idle_timeout_sec`
→ `onDispose()` → flush save/leaderboard → xoá.

### 3.4 Sandbox — quyết định có rủi ro, ghi rõ

**M1: `node:vm` + watchdog.** Room module được load vào một `vm.Context` chỉ có `Math`, `JSON`, `Date.now`,
`console` (chuyển hướng vào `room.log`); không `require`, không `fetch`, không `process`.
Watchdog: `vm.runInContext(..., {timeout})` cho lần load, và đếm CPU mỗi tick cho phần chạy.

> ⚠️ **`node:vm` không phải ranh giới bảo mật.** Có kỹ thuật thoát context đã biết. Ở M1 điều này chấp nhận
> được vì **chỉ chạy code của chính mình** (tank-battle, castle, rumba). **Cổng chặn cứng: không nhận
> room module của người ngoài, và không mở Forge công khai, cho tới khi thay bằng `isolated-vm`
> (tiến trình riêng, heap riêng) hoặc Durable Objects.** Việc này nằm ở M2 và là điều kiện tiên quyết
> của M2, không phải "nice to have".

Ở M1, game `offline` (castle, rumba) không có room module → không chạm vào rủi ro này chút nào.

### 3.5 Auth

- `POST /v1/auth/guest` → tạo `players` row (`is_guest=true`), trả `{playerId, accessToken(15'), refreshToken(90d)}`.
- JWT claims: `sub`=playerId, `gid`=gameId, `gst`=true/false. **`gid` nằm trong token** — nền tảng của
  cách ly multi-tenant; mọi truy vấn dùng `gid` từ token, không bao giờ từ tham số request.
- Gateway verify chính JWT đó trong `hello`; không có đường đăng nhập riêng cho WebSocket.
- Refresh: `POST /v1/auth/refresh`. Link tài khoản (M0 chỉ email OTP) merge save của guest sang account.

### 3.6 HTTP API (M0)

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/v1/auth/guest` | không cần auth |
| POST | `/v1/auth/refresh` | |
| POST | `/v1/auth/link` | email OTP |
| GET/PUT | `/v1/save` | JSON ≤64KB; PUT nhận `If-Match: <version>` → 409 nếu lệch |
| POST | `/v1/leaderboard/:board` | ở game `authoritative` thì từ chối client, chỉ room server nộp |
| GET | `/v1/leaderboard/:board` | `?top=20` hoặc `?around=me&n=5` |
| POST | `/v1/events` | telemetry, gộp lô, fire-and-forget |
| GET | `/g/:gameId/*` | phục vụ bundle tĩnh (thay `server.js` của 3 game) |

Mọi route (trừ auth) qua hook đọc JWT → set `app.player`, `app.gameId`.

### 3.7 Client SDK

Hai bản dựng từ cùng nguồn:
- `dist/arcade.mjs` — ESM cho ai dùng bundler.
- `dist/arcade.global.js` — **IIFE, gán `window.Arcade`**, dùng được bằng `<script src>`. Đây là bản
  mà castle/rumba/tank-battle dùng. Ngân sách kích thước: **≤ 12KB gzip** (nếu vượt là dấu hiệu SDK đang phình).

SDK tự lo: refresh token, reconnect có backoff (0.5s → 5s, jitter), hàng đợi message khi đang mất kết nối,
resync khi lệch `seq`, và `visibilitychange` (tab ẩn → không gửi input, giữ kết nối).

### 3.8 CLI

```
arcade dev        # docker compose up + server watch + serve game trong cwd
arcade test       # chạy G1-G3 tại local (G4 nếu có room module)
arcade typegen    # arcade.toml -> arcade.d.ts (tên board, tên event, shape state nếu khai)
arcade bench      # sinh tải, in CCU/vCPU + p50/p99 tick + băng thông/CCU
arcade deploy     # M2
```

`arcade bench` **không phải công cụ phụ** — nó là thứ duy nhất trả lời được kill criteria M1
(≥150 CCU/vCPU, p99 tick < 8ms). Phải làm cùng lúc với gateway, không để cuối.

---

## 4. Migration đầu tiên

`migrations/001_init.sql` — lấy từ PLATFORM_DESIGN §7, thêm phần thực thi:

```sql
create extension if not exists pgcrypto;

create table players (
  id uuid primary key default gen_random_uuid(),
  is_guest boolean not null default true,
  linked_email text unique,
  created_at timestamptz not null default now()
);

create table games (
  id text primary key,
  owner_id uuid references players(id),
  name text not null,
  manifest jsonb not null,
  created_from text not null default 'human',   -- 'human' | 'forge'
  created_at timestamptz not null default now()
);

create table saves (
  game_id text not null references games(id),
  player_id uuid not null references players(id),
  data jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create table leaderboard_entries (
  game_id text not null references games(id),
  board text not null,
  player_id uuid not null references players(id),
  score bigint not null,
  verified boolean not null default false,
  meta jsonb,
  created_at timestamptz not null default now(),
  primary key (game_id, board, player_id)
);
-- đọc top nhanh; đây là truy vấn nóng nhất của M0
create index lb_top on leaderboard_entries (game_id, board, score desc);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  game_id text not null references games(id),
  code text not null,
  mode text not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  peak_players int not null default 0,
  close_reason text
);
create unique index room_code_open on rooms (code) where closed_at is null;  -- mã phòng chỉ duy nhất khi đang mở

create table events (
  game_id text not null,
  player_id uuid,
  name text not null,
  props jsonb,
  ts timestamptz not null default now()
) partition by range (ts);
```

**RLS bật từ ngày đầu**, không "để sau":
```sql
alter table saves enable row level security;
create policy own_save on saves
  using (player_id = current_setting('arcade.player_id')::uuid
         and game_id = current_setting('arcade.game_id'));
```
Mỗi request set `arcade.player_id` / `arcade.game_id` từ JWT trong transaction. Bật RLS sau khi có
dữ liệu thật đau hơn nhiều lần so với bật ngay.

---

## 5. Trình tự làm — có thứ tự phụ thuộc

**M0 — nền (mục tiêu: castle + rumba bỏ được `server.js`)**

| # | Việc | Phụ thuộc | Xong khi |
|---|---|---|---|
| 1 | docker-compose + migration runner + `001_init.sql` | — | `arcade dev` dựng được DB sạch |
| 2 | Fastify + auth guest + JWT hook + RLS context | 1 | test: guest A không đọc được save của B |
| 3 | `/v1/save` có optimistic locking | 2 | test: 2 tab ghi đồng thời → 1 cái nhận 409 |
| 4 | `/v1/leaderboard` + index | 2 | top-20 trên 1 triệu row < 10ms |
| 5 | Bundle server `/g/:gameId/*` | 2 | mở được castle qua platform |
| 6 | SDK: auth + save + leaderboard, bản IIFE | 2–4 | ≤12KB gzip, chạy bằng `<script src>` |
| 7 | **Port castle + rumba** | 5,6 | **xoá `server.js`; có save + bảng xếp hạng thật** |
| 8 | `arcade dev` + `arcade test` (G1–G3) | 1–6 | chạy được ở máy sạch |

**M1 — realtime (mục tiêu: tank-battle bỏ được toàn bộ netcode)**

| # | Việc | Phụ thuộc | Xong khi |
|---|---|---|---|
| 9 | `protocol`: diff/patch/checksum + property test | — | 10.000 cặp state pass trong CI |
| 10 | Gateway ws: hello/verify JWT, rate limit token bucket | 2,9 | vượt `msg_per_sec` bị drop, log rõ |
| 11 | RoomHost + scheduler 10ms + tick loop | 9,10 | 1 phòng chạy `onTick` đúng nhịp |
| 12 | Room module loader (`node:vm` + watchdog) | 11 | module vô hạn vòng lặp bị giết, host sống |
| 13 | Mã phòng + invite link + join/create | 11 | 2 tab vào chung phòng |
| 14 | Reconnect: session token + cửa sổ + snapshot | 13 | ngắt mạng 10s, vào lại đúng state |
| 15 | `view()` + interest management | 11 | game giấu bài không lộ state |
| 16 | Thu hồi phòng + `onDispose` flush | 11,3,4 | điểm cuối trận vào bảng xếp hạng |
| 17 | **`arcade bench`** | 10–14 | in ra CCU/vCPU, p50/p99 tick, KB/s mỗi CCU |
| 18 | **Port tank-battle** | 10–16 | **xoá `server.js` + netcode; 4 người chơi thật** |
| 19 | G4 trong `arcade test` (2 client headless hội tụ) | 18 | vào CI |
| 20 | **Chạy bench, đối chiếu kill criteria** | 17,18 | ≥150 CCU/vCPU & p99 < 8ms — **hoặc quay lại thiết kế state sync** |

Việc 9 và 17 là hai việc dễ bị đẩy về cuối nhất và cũng là hai việc quyết định M1 đỗ hay trượt.
Làm 9 trước tất cả; làm 17 ngay khi gateway chạy được, đừng đợi port xong tank-battle.

---

## 6. Chiến lược test

| Tầng | Công cụ | Bắt lỗi gì |
|---|---|---|
| Property | `node:test` | diff/patch không khứ hồi được — lỗi âm thầm phá state ở phút thứ 20 |
| Unit | `node:test` | rate limit, mã phòng, optimistic locking, RLS |
| Integration | `node:test` + client thật trong Node | join/rejoin/dispose, hội tụ checksum |
| E2E | Playwright, 2 browser context | đúng thứ G4 kiểm; dùng lại làm harness cho Forge |
| Tải | `arcade bench` | ngân sách CPU/băng thông — dữ liệu cho kill criteria |

**Không mock Postgres.** Test chạy trên Postgres thật trong Docker; RLS là thứ chính cần test và
mock sẽ cho cảm giác an toàn giả.

---

## 7. Quan sát vận hành (tối thiểu, làm ngay ở M1)

Log JSON một dòng mỗi sự kiện; số đo phơi ra `/metrics` dạng Prometheus text:
`arcade_rooms_open`, `arcade_players_connected`, `arcade_tick_ms{quantile}`,
`arcade_patch_bytes_total`, `arcade_room_disposed_total{reason}`.

Ba con số phải nhìn thấy hằng ngày từ ngày đầu: **CCU**, **p99 tick**, **byte/CCU/phút**.
Con số thứ ba là thứ dự báo hoá đơn egress — thứ giết biên lợi nhuận nhanh nhất.

---

## 8. Những gì cố tình chưa làm ở M0/M1

Ghi ra để khỏi tranh luận lại: Redis, nhiều node + sticky routing, prediction/reconciliation,
binary state, WebTransport, matchmaking theo MMR (chỉ có `join theo mã` + `quickMatch` ngẫu nhiên),
storage/UGC, dashboard web (dùng `arcade` CLI + `/metrics`), billing, moderation.

Mỗi thứ trên chỉ được mở khi có **số đo** hoặc **khách hàng** đòi — không mở vì "kiến trúc đẹp hơn".
