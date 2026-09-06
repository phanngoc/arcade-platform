# Arcade — Design cho implement (M0 + M1)

> Tài liệu này **chốt các lựa chọn còn mở** trong [PLATFORM_DESIGN.md](PLATFORM_DESIGN.md) và mô tả đủ chi tiết
> để bắt đầu code. Phạm vi: **M0 (nền) + M1 (realtime)**. M2+ chỉ ghi chỗ nào cần chừa đường.
> Ngày: 2026-09-06. **Trạng thái: M0 xong · M1 xong · 3 game đã chuyển sang platform (§12)** — §10 (M0) và §11 (M1) ghi những gì
> thực tế khác kế hoạch. Đo được: **462 CCU/vCPU, tick p99 0,99ms** (kill criteria: ≥150 và <8ms).

---

## 0. Nguyên tắc dẫn đường

1. **Ranh giới kiến trúc có từ ngày 1; topology triển khai chỉ là config.** Stateless service và
   stateful room server là hai module **không chia sẻ bộ nhớ**, nói chuyện qua interface rõ ràng —
   ngay cả khi M1 chạy chung một process. Tách thành deployable riêng ở M2 là đổi cấu hình, không phải viết lại.
   Ngược lại, **không dựng hạ tầng phân tán trước khi có tải**: Kubernetes, hàng đợi, service mesh — chưa.
2. **SDK phải chạy được bằng `<script src>`.** 3 game hiện có đều không có build step. Nếu SDK bắt buộc
   npm + bundler thì chính 3 game test đầu tiên không dùng được nó. Đây là ràng buộc cứng, không phải sở thích.
3. **Ưu tiên xoá code hơn thêm code.** Thước đo M1 là *xoá được `server.js` + netcode của tank-battle*.
4. **Không nhận code người lạ cho tới khi có sandbox thật** (§4.4). Đây là cổng an toàn, không đàm phán.

---

## 1. Stack — đã chốt

| Thành phần | Chọn | Lý do / đánh đổi |
|---|---|---|
| Runtime | **Node.js 22 LTS + TypeScript** | Cùng ngôn ngữ client/server; `ws` đã dùng ở tank-battle |
| HTTP API | **Fastify 5** | Cần routing + schema validation + hook auth; nhẹ hơn Nest, đủ chín |
| WebSocket | **`ws`** (không dùng lớp bọc) | Cần kiểm soát backpressure và ping/pong thủ công |
| Primary DB | **Postgres 16 (JSONB)** + **`postgres.js`** | Nguồn chân lý. Không ORM: RLS và SQL thuần là thiết kế, ORM chỉ che mất nó |
| In-memory | **Redis 7 (single node)** + `ioredis` | Leaderboard ZSET, room registry, presence, rate limit, sharded pub/sub. **Cluster chỉ khi vượt ngưỡng ở §2.5** |
| Migration | **file SQL đánh số + runner ~50 dòng** | Đủ dùng; tránh thêm một công cụ nữa để học |
| JWT | **`jose`** (HS256 ở M0) | Đổi sang EdDSA khi tách gateway khỏi API (M2) |
| Room isolate | **`node:vm` + watchdog** ở M1 → **`isolated-vm`** ở M2 | Xem §4.4 — đây là đánh đổi có rủi ro, đọc kỹ |
| Object storage | **S3-compatible** (MinIO local, Cloudflare R2 prod) | R2 egress $0 — điều kiện sống theo BUSINESS_MODEL §4.2 |
| Test | **`node:test`** + Playwright | Không thêm Jest/Vitest cho một dự án cỡ này |
| Local dev | **Docker Compose** (Postgres + MinIO) + `arcade dev` | |

**Không dùng:** Kubernetes (không cần ở quy mô này), ORM, GraphQL, service mesh, hàng đợi message,
monorepo tool (npm workspaces là đủ). **gRPC**: chỉ khi đã tách ≥3 service thật — xem §2.4.

**Hosting:** Hetzner hoặc tương đương có băng thông kèm theo. **Không AWS/GCP cho tầng realtime** —
egress $0,09/GB giết biên lợi nhuận (BUSINESS_MODEL §4.2).

---

## 2. Kiến trúc mục tiêu

```
               ┌────────────────────────────────────────────────────────┐
               │                     API Gateway                        │
               └───────────────┬────────────────────────┬───────────────┘
                               │ REST (gRPC nội bộ)     │ WebSocket (→ WebTransport)
                               ▼                        ▼
                   ┌──────────────────────┐  ┌──────────────────────┐
                   │  Stateless Services  │  │  Stateful Game Room  │
                   │  Auth · Save · LB    │  │   (Game Loop Server) │
                   │  Bundle · Telemetry  │  │   tick 30Hz, in-RAM  │
                   └───────────┬──────────┘  └──────────┬───────────┘
                               │                        │
                               ▼                        ▼
                   ┌──────────────────────┐  ┌──────────────────────┐
                   │  Postgres 16 (JSONB) │  │   Redis (cache,      │
                   │  nguồn chân lý       │◄─┤   pub/sub, ZSET LB,  │
                   │                      │  │   room registry)     │
                   └──────────────────────┘  └──────────────────────┘
                          ▲  write-behind từ Redis, reconcile định kỳ
```

Trục chia quan trọng nhất là **stateless ⟂ stateful**:

| | Stateless Services | Stateful Game Room |
|---|---|---|
| Giữ gì trong RAM | không gì (ngoài cache đọc) | **toàn bộ state phòng đang chạy** |
| Scale bằng | thêm bản sao, đứng sau load balancer bất kỳ | **sticky theo phòng** — client phải tới đúng node giữ phòng đó |
| Chết thì sao | request retry sang bản sao khác | **mất trận đang chơi** → cần reconnect + snapshot |
| Deploy | rolling bất kỳ lúc nào | **drain**: khoá phòng mới, đợi phòng hiện tại kết thúc |
| Giao thức | REST/JSON ra ngoài | WebSocket |

Đây là lý do hai bên không được chia sẻ bộ nhớ, kể cả khi M1 chạy chung một process:
chúng có mô hình scale và mô hình lỗi khác nhau về bản chất.

### 2.1 Dữ liệu nằm ở đâu — bảng quyết định

Đây là bảng quan trọng nhất của mục này. Sai chỗ nào là trả giá bằng hoá đơn hoặc bằng mất dữ liệu.

| Dữ liệu | Nơi ở | Lý do |
|---|---|---|
| Tài khoản, game, manifest, version | **Postgres** | Quan hệ, đọc ít, cần ràng buộc toàn vẹn |
| Save data người chơi | **Postgres JSONB** (+ cache Redis, TTL 60s) | JSONB cho phép sau này query *bên trong* save (`data->>'level'`) mà không cần migration |
| **Bảng xếp hạng** | **Redis ZSET là hot path · Postgres là nguồn chân lý** | `ZADD`/`ZREVRANGE`/`ZRANK` là O(log n) — "hạng của tôi" trong 1 triệu người là truy vấn Postgres không làm nổi ở tần suất này. **Write-behind**: ghi Redis ngay, đẩy sang Postgres theo lô 5s. Reconcile lại từ Postgres khi khởi động. |
| **State phòng đang chạy** | **RAM của chính room process. KHÔNG đưa vào Redis.** | Đây là lỗi kinh điển. 30Hz × N phòng ghi Redis = giết cả Redis lẫn biên lợi nhuận. Redis chỉ giữ *metadata* phòng, không giữ state tick. |
| Room registry `code → node` | **Redis**, TTL 90s, refresh mỗi 30s | Thứ khiến nhiều node hoạt động được. Node chết → key hết hạn → mã phòng tự giải phóng |
| Presence / CCU | **Redis**, TTL + heartbeat | |
| Session token reconnect | **Redis**, TTL = `reconnect_window_sec` | Phải sống được khi client nối lại trúng node khác |
| Rate limit counter | **Redis** (local ở M1) | |
| Broadcast liên node | **Redis sharded pub/sub** | Chỉ dùng cho sự kiện *ngoài phòng* (thông báo, lobby). Trong phòng thì không đi qua Redis. |
| Telemetry | **Postgres** partition theo ngày + rollup | |

**Quy tắc bất di bất dịch:** Redis **không bao giờ** là nguồn chân lý cho điểm số, tiền, hay tiến độ.
Mất Redis = mất cache và mất phòng đang chạy; **không được** mất dữ liệu người chơi.

### 2.2 Vì sao Redis vào sớm (đổi so với bản trước)

Bản trước của tài liệu này hoãn Redis tới M2. Sửa lại: **Redis vào từ M0**, vì hai việc nó làm
không có phương án thay thế rẻ hơn:

1. **Leaderboard ZSET.** Không có ZSET thì "hạng của tôi" phải `count(*) where score > x` — Postgres
   làm được ở 10K row, sập ở 1M row. Đây là tính năng của M0, không phải M2.
2. **Room registry.** Nếu M1 không có registry, mã phòng chỉ tồn tại trong RAM một process → M2 phải
   viết lại toàn bộ đường join. Rẻ hơn nhiều nếu registry có sẵn từ đầu, kể cả khi chỉ có một node.

Nhưng **Redis đơn, không Cluster** — xem ngưỡng ở §2.5.

### 2.3 Redis Cluster — những cạm bẫy phải biết trước

Nếu/khi lên Cluster, bốn thứ này sẽ cắn:

1. **Lệnh nhiều key phải cùng hash slot.** `ZUNIONSTORE`, `MGET`, transaction… fail ngang nếu key nằm
   khác slot. Giải pháp: **hash tag** — đặt tên key là `lb:{game_id}:daily`, `save:{game_id}:<player>`
   để mọi key của một game rơi vào cùng slot. Phải quyết quy ước đặt tên **từ M0**, đổi sau rất đau.
2. **Pub/Sub thường trong cluster mode phát ra mọi node** — tốn băng thông nội bộ tuyến tính theo số node.
   Dùng **sharded pub/sub (`SPUBLISH`/`SSUBSCRIBE`, Redis 7+)** với channel mang hash tag.
3. **Không có transaction xuyên slot** → mọi thao tác cần nguyên tử phải nằm trong một Lua script và
   một slot.
4. **Failover làm mất ghi chưa replicate.** Với write-behind leaderboard, cửa sổ mất là ≤ chu kỳ flush.
   Chấp nhận được cho điểm số; **không chấp nhận được** nếu sau này có tiền/vật phẩm — thứ đó ghi thẳng Postgres.

### 2.4 Giao thức — chọn gì, khi nào

| Kênh | M0–M1 | Về sau | Ghi chú thật |
|---|---|---|---|
| Client → Stateless | **REST/JSON** | REST/JSON | Public API, cần debug bằng curl. Không đổi. |
| Client → Room | **WebSocket** | + **WebTransport** (M4) | WebSocket đủ cho 2D 30Hz. |
| Nội bộ service ↔ service | **gọi hàm trực tiếp** | **gRPC** khi đã tách ≥3 service | gRPC giữa hai module của một người là chi phí thuần: thêm proto, thêm codegen, thêm tầng debug — không có lợi ích nào ở quy mô đó. Thêm khi có ranh giới đội ngũ hoặc ranh giới ngôn ngữ. |
| UDP | **không** | **WebRTC DataChannel** unordered/unreliable, hoặc WebTransport datagram | Trình duyệt **không có UDP thuần**. Chỉ đáng làm khi *đo được* jitter/RTT là nút thắt — với game 2D 30Hz thì không phải. Chi phí: cần TURN server, NAT traversal, và một đường code thứ hai phải bảo trì song song. |

### 2.5 Lộ trình topology — mỗi bước có ngưỡng kích hoạt

| Giai đoạn | Hình thù | Kích hoạt bước sau khi |
|---|---|---|
| **T1 (M0–M1)** | 1 process: Fastify + gateway + room host. Postgres + **Redis đơn**. 1 máy. | CPU > 60% kéo dài, **hoặc** cần deploy stateless mà không muốn ngắt trận đang chơi |
| **T2 (M2)** | Tách 3 deployable: `api` (n bản sao) · `gateway+room` (n node, sticky theo registry) · Postgres + Redis đơn | > 3 room node, **hoặc** Redis > 60% CPU một core, **hoặc** > 25GB dữ liệu nóng |
| **T3 (M3+)** | Redis **Cluster** (≥3 shard), room node auto-scale, Postgres read replica | Chỉ khi số đo ở T2 chạm ngưỡng. Không lên vì "kiến trúc đẹp hơn". |

**Drain khi deploy room node:** đánh dấu node `draining` → xoá khỏi registry (không nhận phòng mới)
→ đợi phòng hiện có kết thúc tự nhiên hoặc hết `idle_timeout` → tắt. Không kill phòng đang chơi.
Viết đường này **ở M1**, kể cả khi chỉ có một node — vì lúc có 3 node thì đã quá muộn để nghĩ.

### 2.6 Đường đi của một lần join phòng (nhiều node)

```
client ──POST /v1/rooms/join {code}──► API (stateless)
                                        └─► Redis GET room:{K3F9} ──► "node-2.arcade:8080"
client ◄──{wsUrl, sessionToken}─────────┘
client ──WS connect trực tiếp node-2──► Gateway trên node-2 ──► RoomHost trong RAM
```

Client kết nối **thẳng** tới node giữ phòng. Không cần L7 load balancer biết về phòng, không cần
consistent hashing ở tầng mạng. Đây là mô hình đơn giản nhất còn hoạt động, và là lý do room registry
phải có từ M0.

## 3. Cấu trúc repo

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
│   ├── core/              # hạ tầng dùng chung — KHÔNG chứa logic nghiệp vụ
│   │   ├── src/pg.ts          # postgres.js, RLS context, transaction
│   │   ├── src/redis.ts       # ioredis + quy ước hash tag {game_id}
│   │   └── src/registry.ts    # room registry: claim/renew/resolve/release
│   ├── services/          # STATELESS — mỗi thư mục là 1 deployable tương lai
│   │   ├── src/auth/
│   │   ├── src/save/
│   │   ├── src/leaderboard/   # ZSET hot path + write-behind sang Postgres
│   │   ├── src/bundle/
│   │   └── src/telemetry/
│   ├── roomd/             # STATEFUL — game loop server
│   │   ├── src/gateway.ts     # ws handshake, rate limit, routing
│   │   ├── src/host.ts        # RoomHost: state, tick, diff
│   │   ├── src/scheduler.ts   # 1 timer 10ms cho mọi phòng
│   │   ├── src/sandbox.ts     # node:vm + watchdog
│   │   └── src/drain.ts       # rút khỏi registry, đợi phòng kết thúc
│   ├── app/               # composition root: M1 gộp services+roomd 1 process
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

**Luật phụ thuộc (ép bằng lint, không phải bằng lời hứa):**
`services/` và `roomd/` **không được import lẫn nhau**. Cả hai chỉ nói chuyện qua `core/` hoặc
qua HTTP/registry. `app/` là nơi duy nhất được import cả hai — và đó chính là thứ bị xoá ở M2
khi tách deployable. Nếu một import xuyên biên giới lọt qua, việc tách ở M2 biến thành viết lại.

---

## 4. Thiết kế từng module

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

## 5. Migration đầu tiên

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

## 6. Trình tự làm — có thứ tự phụ thuộc

**M0 — nền (mục tiêu: castle + rumba bỏ được `server.js`)**

| # | Việc | Phụ thuộc | Xong khi |
|---|---|---|---|
| 1 | docker-compose (Postgres + **Redis** + MinIO) + migration runner + `001_init.sql` | — | `arcade dev` dựng được DB sạch |
| 2 | Fastify + auth guest + JWT hook + RLS context | 1 | test: guest A không đọc được save của B |
| 3 | `/v1/save` có optimistic locking | 2 | test: 2 tab ghi đồng thời → 1 cái nhận 409 |
| 4a | `core/redis.ts` + quy ước hash tag `{game_id}` | 1 | test: mọi key của 1 game cùng slot |
| 4b | Leaderboard **ZSET hot path + write-behind Postgres** | 2,4a | top-20 và **hạng của tôi** trên 1 triệu entry < 10ms; kill Redis → khởi động lại reconcile đúng từ Postgres |
| 5 | Bundle server `/g/:gameId/*` | 2 | mở được castle qua platform |
| 6 | SDK: auth + save + leaderboard, bản IIFE | 2–4 | ≤12KB gzip, chạy bằng `<script src>` |
| 7 | **Port castle + rumba** | 5,6 | **xoá `server.js`; có save + bảng xếp hạng thật** |
| 8 | `arcade dev` + `arcade test` (G1–G3) | 1–6 | chạy được ở máy sạch |
| 8b | Lint luật phụ thuộc `services/` ⊥ `roomd/` | 2 | CI fail khi có import xuyên biên giới |

**M1 — realtime (mục tiêu: tank-battle bỏ được toàn bộ netcode)**

| # | Việc | Phụ thuộc | Xong khi |
|---|---|---|---|
| 9 | `protocol`: diff/patch/checksum + property test | — | 10.000 cặp state pass trong CI |
| 10 | Gateway ws: hello/verify JWT, rate limit token bucket | 2,9 | vượt `msg_per_sec` bị drop, log rõ |
| 11 | RoomHost + scheduler 10ms + tick loop | 9,10 | 1 phòng chạy `onTick` đúng nhịp |
| 12 | Room module loader (`node:vm` + watchdog) | 11 | module vô hạn vòng lặp bị giết, host sống |
| 13 | Mã phòng + invite link + join/create | 11 | 2 tab vào chung phòng |
| 13b | **Room registry trên Redis** (claim/renew/resolve/release) + `POST /v1/rooms/join` trả `wsUrl` | 4a,13 | join đi đúng đường §2.6 dù chỉ có 1 node |
| 13c | **Drain**: rút khỏi registry, đợi phòng kết thúc, tắt sạch | 13b | deploy lại không giết trận đang chơi |
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

## 7. Chiến lược test

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

## 8. Quan sát vận hành (tối thiểu, làm ngay ở M1)

Log JSON một dòng mỗi sự kiện; số đo phơi ra `/metrics` dạng Prometheus text:
`arcade_rooms_open`, `arcade_players_connected`, `arcade_tick_ms{quantile}`,
`arcade_patch_bytes_total`, `arcade_room_disposed_total{reason}`, `arcade_lb_writebehind_lag_seconds`,
`arcade_registry_claims_total`, `redis_commands_total`.

Ba con số phải nhìn thấy hằng ngày từ ngày đầu: **CCU**, **p99 tick**, **byte/CCU/phút**.
Con số thứ ba là thứ dự báo hoá đơn egress — thứ giết biên lợi nhuận nhanh nhất.

---

## 9. Những gì cố tình chưa làm ở M0/M1

Ghi ra để khỏi tranh luận lại: **Redis Cluster** (dùng Redis đơn — ngưỡng lên Cluster ở §2.5),
tách deployable (ranh giới có sẵn, nhưng M1 vẫn 1 process), gRPC nội bộ, UDP/WebRTC/WebTransport,
prediction/reconciliation, binary state, matchmaking theo MMR (chỉ có `join theo mã` + `quickMatch`
ngẫu nhiên), storage/UGC, dashboard web (dùng `arcade` CLI + `/metrics`), billing, moderation.

Mỗi thứ trên chỉ được mở khi có **số đo** hoặc **khách hàng** đòi — không mở vì "kiến trúc đẹp hơn".


---

## 10. Nhật ký M0 — thực tế khác kế hoạch chỗ nào

M0 chạy xong 10/10 việc. Bốn điều học được khi code thật, ghi lại vì chúng đổi thiết kế:

### 10.1 Owner của bảng BỎ QUA RLS — policy ở 001 suýt thành trang trí

Postgres mặc định cho owner của bảng bỏ qua row level security. App kết nối bằng
chính user `arcade` (owner) nên mọi `create policy` ở `001_init.sql` **không có
tác dụng nào**. Test "người chơi B đọc save của A" sẽ pass sai.

Sửa bằng `003_app_role.sql`: tách hai vai — `arcade` (owner) cho migration và tác vụ
hệ thống (write-behind ghi thay nhiều người chơi, cố ý nằm ngoài RLS), `arcade_app`
(không owner) cho mọi truy vấn theo request. `packages/core/src/pg.ts` xuất hai
đường tương ứng: `sql` và `withActor`.

**Bài học:** bật RLS không đủ, phải kiểm chứng bằng test hai người chơi. Nếu chỉ
đọc code thì lỗi này vô hình.

### 10.2 Node 24 chạy TypeScript trực tiếp → bỏ được build step

Kế hoạch định dùng Node 22 + tsc. Node 24 trên máy chạy `.ts` bằng type-stripping,
nên **server không có build step** — đúng tinh thần "3 game không có build step".
Giá phải trả: chỉ dùng được cú pháp xoá-được. `constructor(public x: T)` (parameter
property) làm vỡ lúc chạy. `erasableSyntaxOnly: true` trong tsconfig bắt lỗi này ở
typecheck thay vì để vỡ trong production.

SDK vẫn cần esbuild vì phải ra bản IIFE cho `<script src>`.

### 10.3 Tách hàm thuần khỏi module có kết nối

`packages/core/src/redis.ts` vừa định nghĩa quy ước tên key vừa mở kết nối. Test quy
ước đặt tên (hàm thuần) import file đó → kết nối Redis giữ event loop sống → test
runner treo 90 giây rồi báo "Promise resolution is still pending".

Tách `keys.ts` (thuần, test được không cần hạ tầng) khỏi `redis.ts` (kết nối).
Quy tắc chung: **module có side effect lúc import không được chứa logic cần test riêng.**

### 10.4 Hook auth chạy cả cho route không khớp

`app.addHook('preHandler')` của Fastify chạy cho cả request không khớp route nào, nên
mọi URL sai trả **401 thay vì 404** — gây nhiễu log và lộ thông tin không cần thiết.
Sửa bằng `if (!req.routeOptions?.url) return` ở đầu hook.

### 10.5 Kết quả đo được

| Hạng mục | Kết quả |
|---|---|
| SDK bản IIFE | **1,7KB gzip** (ngân sách 12KB) |
| Test | **17/17 pass** trên Postgres + Redis thật, không mock |
| Typecheck | sạch, `erasableSyntaxOnly` bật |
| Luật phụ thuộc | không có import xuyên biên giới `services/` ⊥ `roomd/` |
| castle + rumba trên platform | SDK khởi tạo, guest auth, nộp điểm, đọc bảng xếp hạng — verify bằng browser thật |
| Redis chết rồi sống lại | bảng xếp hạng nạp lại đủ **cả điểm lẫn tên** từ Postgres |
| Path traversal (`%2e%2e`, `..%2f`) | bị chặn, trả `PATH_ESCAPE` |

### 10.6 Chưa làm, có lý do

- **`server.js` của castle/rumba vẫn còn.** Platform phục vụ được cả hai game tại
  `/g/castle/` và `/g/rumba/`, nhưng 3 site đang live qua launchd + Cloudflare tunnel.
  Chuyển traffic thật sang platform là quyết định vận hành riêng: cần platform chạy
  dưới launchd, có `.env` production, và trỏ lại ingress. Không tự làm điều đó với
  server hạng dev.
- **Cổng 8090 thay vì 8080** — nginx trên máy này đã chiếm 8080.
- **Refresh token là JWT stateless** → chưa thu hồi được trước hạn. Khi cần: lưu `jti`
  vào Redis và kiểm trong `/v1/auth/refresh`.
- **`/v1/auth/link` chưa gửi OTP thật** — mới gắn email và giữ nguyên `player_id`.


---

## 11. Nhật ký M1 — realtime

12/12 việc. **44/44 test pass**, gồm 10.000 cặp state cho diff/patch và 12 test G4 với
client WebSocket thật.

### 11.1 Kết quả đo (việc 20 — kill criteria)

`arcade bench --game tank-battle --rooms 25 --players 4 --seconds 20`, server chạy ở
**tiến trình riêng** nên CPU của nó tách khỏi bộ sinh tải:

| Chỉ số | Đo được | Ngưỡng | |
|---|---|---|---|
| CCU | 100 | — | |
| CPU server | 0,22 vCPU | — | |
| **CCU/vCPU** | **462** | ≥ 150 | ✓ vượt 3× |
| **tick p99** | **0,99 ms** | < 8 ms | ✓ |
| tick p50 | 0,31 ms | — | |
| Băng thông | **316 KB/CCU/phút** (5,3 KB/s) | — | |
| RSS | 158 MB | — | |

**Băng thông 5,3 KB/s xác nhận giả định 5 KB/s ở BUSINESS_MODEL §4.2** — giờ là số đo,
không còn là ước tính. Kết luận về egress giữ nguyên: 100 CCU trung bình ≈ 1,3 TB/tháng,
tức ~$117/tháng chỉ riêng egress trên AWS và ≈ $0 trên Hetzner/Cloudflare.

Vì sao con số tốt hơn kỳ vọng: diff **một lần** cho cả phòng rồi serialize **một lần**
(chỉ tách riêng khi game có `view()`), làm tròn số thực 3 chữ số, và một `setInterval`
10ms duy nhất thay cho một timer mỗi phòng.

### 11.2 tank-battle sau khi port

| | Trước | Sau |
|---|---|---|
| `server.js` | 193 dòng: HTTP tĩnh, WebSocket, sổ phòng, sinh mã, thu hồi phòng trống, vòng lặp, broadcast | **không dùng nữa** ở đường platform |
| `game.js` | 645 dòng gameplay | **không đổi một dòng** |
| `server/room.part.js` | — | ~130 dòng, thuần ánh xạ engine ↔ hook |

Abstraction đạt bài test: **toàn bộ netcode viết tay biến mất, gameplay giữ nguyên.**

Một tối ưu bắt buộc khi port: `tanks`/`bullets` chuyển từ **mảng sang object theo id**.
Platform diff mảng theo chỉ số (không LCS — quá đắt ở 30Hz), nên xoá một viên đạn ở giữa
mảng làm mọi phần tử sau dịch chỗ và patch to bằng cả mảng. Object keyed-by-id thì xoá =
một op. `events`/`mapDelta`/`effects` chuyển sang `room.broadcast()` vì chúng chỉ sống
một tick — nằm trong state thì mỗi tick sinh 2 op cho thứ không phải state.

### 11.3 Bốn lỗi chỉ lộ ra khi chạy thật

**a. Gateway xử lý message SONG SONG — client thật bị từ chối oan.**
Handler `ws.on('message')` là `async`, nên client gửi liền `hello` rồi `create` sẽ bị xử lý
ngược thứ tự: `create` chạy khi `hello` chưa verify xong → `TOKEN_INVALID` → đóng kết nối.
Mọi client thật đều gửi kiểu đó. Sửa: mỗi kết nối giữ một promise chain, message xử lý
tuần tự. *Đây là lỗi mà chỉ test tích hợp bắt được — unit test từng handler sẽ pass hết.*

**b. Input của client làm sập cả phòng.**
Bench gửi `dir` âm (`Date.now()/500|0` tràn int32), engine dùng `DIR[tank.dir]` → undefined
→ ném lỗi → platform thu hồi phòng → **cả 4 người trong trận bị văng vì một client hỏng**.
Platform xử lý đúng (cô lập lỗi, không sập host), nhưng bài học thuộc về room module:
**input của client là dữ liệu không tin được và phải kiểm tra trước khi chạm vào engine.**
Đã thêm kiểm tra `dir ∈ {0,1,2,3}` trong room module tank-battle.

**c. Lỗi ném từ trong vm không phải `instanceof Error` của host.**
Khác realm → `cause instanceof Error` luôn false → mất sạch stack đúng lúc cần nhất, chỉ
còn message. Phải duck-type (`typeof cause.stack === 'string'`). Trước khi sửa, lỗi (b)
chỉ hiện ra là "undefined is not iterable" không kèm vị trí.

**d. Công cụ đo báo ĐẠT trên một lần chạy hỏng.**
Lần bench đầu tiên in "✓ ĐẠT · CCU/vCPU 1075" trong khi 12/12 client lỗi và server không
xử lý tick nào. Một công cụ đo báo đạt sai còn tệ hơn không đo. Nay bench tự vô hiệu hoá
lần chạy nếu có client lỗi, không có byte nào về, hoặc server không báo tick.

### 11.4 Quyết định thiết kế đáng ghi

**Không đưa hàm nào của host vào vm.** Room module không gọi `room.broadcast()` của host —
nó đẩy lệnh vào `room._out` (mảng thuần), host đọc và thực thi sau khi hook trả về. Vừa bớt
một đường thoát sandbox, vừa khiến mọi tác động ra ngoài của module tuần tự và quan sát được.
`_out` bắt đầu bằng `_` nên diff bỏ qua — không tốn băng thông.

**Watchdog dựa vào `timeout` của `vm.Script.runInContext`**, thứ khiến V8 *kết thúc* script
đang chạy. Nhờ vậy `onTick` lặp vô hạn bị giết thay vì treo cả process — đã có test.

**`node:vm` vẫn KHÔNG phải ranh giới bảo mật.** Cổng chặn của M2 giữ nguyên: không nhận
room module của người ngoài, không mở Forge công khai, cho tới khi thay bằng `isolated-vm`.

### 11.5 Chưa làm

- **`server.js` của tank-battle vẫn còn**, cùng lý do như castle/rumba ở §10.6: 3 site đang
  live qua launchd + Cloudflare tunnel, và chuyển traffic thật sang server hạng dev là quyết
  định vận hành riêng.
- **Prediction/reconciliation**: chưa. Với 2D 30Hz và RTT nội địa thì chưa đo được là nút thắt.
- **Nhiều node**: registry, sticky routing và drain đã viết và có test, nhưng chưa chạy thật
  trên 2 node.
- `room.save()` mới nhận lệnh, chưa ghi xuống bảng riêng của game (M2).


---

## 12. Chuyển 3 game live sang platform

3 game đang chạy công khai (`tank/rumba/castle.bomclaw.org`) đã chuyển sang platform.
Server riêng của từng game đã tắt; plist giữ lại để rollback.

### 12.1 Bốn thứ phải bổ sung mới chuyển được

**a. Custom domain (migration 005).** URL công khai là `castle.bomclaw.org/`, không phải
`/g/castle/`. Không có ánh xạ host → game thì phải đổi URL — thứ đã in trong README và
người chơi đã bookmark. Route wildcard `/` + `/*`; router của Fastify vẫn ưu tiên mọi
route tĩnh (`/v1/*`, `/health`), có test khẳng định.

**b. `client_dir` trong manifest (006/007).** Game thật không thống nhất: castle/rumba để
file ngay gốc, tank-battle để trong `public/`. *007 phải sửa 006 vì `jsonb_set('{game,client_dir}')`
chỉ tạo được key CUỐI — manifest chưa có key `game` nên câu update không ăn mà cũng không báo lỗi.*

**c. SDK thiếu hẳn phần realtime.** M1 làm xong server nhưng SDK chỉ có auth/save/leaderboard.
Thêm `packages/sdk/src/room.ts`: `rooms.create/join`, `onState/onEvent/onStatus`, reconnect
backoff có jitter, hàng đợi input khi mất mạng, phát hiện nhảy `seq` → xin snapshot.
SDK 1,7 → **3,0 KB gzip** (ngân sách 12KB).

**d. URL phải dựng từ REQUEST, không từ cấu hình.** Đây là lỗi làm mất 2 lần thử:
`/v1/rooms/pick` trả `ws://127.0.0.1:8090/ws` nên trình duyệt ngoài internet nối vào
localhost của chính nó, và trên trang https còn bị chặn mixed-content. Tương tự, link mời
trả `http://127.0.0.1:8090/g/tank-battle/?room=XXXX`. Nay cả hai dựng từ `Host` +
`x-forwarded-proto` của request; link mời còn tra host → game để dùng gốc khi đúng custom
domain. Gateway nhận `inviteUrl()` tiêm từ `app/` vì việc tra host nằm ở `services` mà
`roomd` không được import `services`.

### 12.2 Port client tank-battle

`public/client.js` 669 dòng, phần dính giao thức chỉ ~50 dòng (6 loại message + `send`).
Renderer, âm thanh, nội suy chuyển động: **không đổi một dòng**. Thêm `toLegacy(state)` đổi
state của platform (object theo id) về hình dạng mảng mà renderer cũ đang dùng —
rẻ hơn nhiều so với sửa renderer, và giữ được lợi ích băng thông của keyed-by-id.

Mất một tính năng: **thống kê lobby toàn cục** ("N phòng đang hoạt động") — server cũ tự
broadcast, platform chưa có endpoint tương đương.

### 12.3 Hạ tầng

| | |
|---|---|
| Platform | launchd `com.ngocp.arcade`, port 8090, `KeepAlive` + `ThrottleInterval` 10s |
| Postgres/Redis | Docker, `restart: unless-stopped` |
| Tunnel | 3 hostname cùng trỏ `127.0.0.1:8090`, phân biệt bằng Host header |
| JWT_SECRET | đã thay bằng 48 byte ngẫu nhiên (không còn giá trị dev) |
| Rollback | `ops/rollback.sh` — trả ingress + bật lại 3 server riêng, một lệnh |

### 12.4 Kiểm chứng trên môi trường thật

Qua HTTPS/WSS công khai, bằng browser thật:

| | |
|---|---|
| tank.bomclaw.org | tạo phòng `7AYD`, link mời `https://tank.bomclaw.org/?room=7AYD`, status `playing`, tick chạy, 2 xe tăng, 20 địch |
| castle.bomclaw.org | nộp điểm 3131 → lên bảng, save đồng bộ |
| rumba.bomclaw.org | engine nạp, bàn 121 ô, nộp điểm 480 → lên bảng |
| 44 test | vẫn xanh sau mọi thay đổi |
