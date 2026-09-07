# games/

Platform "Supabase cho game": backend realtime/storage dùng chung cho nhiều game,
cộng lớp AI Forge sinh game từ prompt. Repo này chứa **thiết kế + dây chuyền skill**;
mỗi game là một repo riêng và là test case của abstraction.

| Thư mục | Kiểu | Git | Live |
|---|---|---|---|
| `tank-battle/` | Co-op 4P realtime, server authoritative 30Hz | [phanngoc/tank-battle-90](https://github.com/phanngoc/tank-battle-90) | [tank.bomclaw.org](https://tank.bomclaw.org) |
| `castle/` | 1P canvas castle-battle, vòng 60s | [phanngoc/castle-busters](https://github.com/phanngoc/castle-busters) | [castle.bomclaw.org](https://castle.bomclaw.org) |
| `rumba/` | 1P puzzle logic (Binairo family) | [phanngoc/rumba-puzzle](https://github.com/phanngoc/rumba-puzzle) | [rumba.bomclaw.org](https://rumba.bomclaw.org) |
| `blockdrop/` | 1P xếp khối, điều khiển bằng thanh kéo + hologram cổ vũ | local (chưa có remote) | chưa ship — `/g/blockdrop/` |

## Tài liệu

| File | Nội dung |
|---|---|
| [PLATFORM_DESIGN.md](PLATFORM_DESIGN.md) | Thiết kế kỹ thuật: abstraction, realtime engine, data model, AI Forge, roadmap |
| [BUSINESS_MODEL.md](BUSINESS_MODEL.md) | Thị trường, giá đối thủ, unit economics, bảng giá, 3 kịch bản tài chính, định giá, kill criteria |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Design cho implement M0+M1: kiến trúc stateless⟂stateful, Postgres JSONB + Redis, stack đã chốt, giao thức, migration, 24 việc có thứ tự |
| [SKILL_CHAIN.md](SKILL_CHAIN.md) | 5 skill làm game (`skills/`) và cách đóng gói vào platform |

PLATFORM_DESIGN.md — thiết kế platform "Supabase cho game": backend realtime/storage
dùng chung cho nhiều game + lớp AI Forge sinh game từ prompt. Các game trên là bộ test case của
abstraction đó.

`blockdrop` là test case mới nhất và là game đầu tiên đi qua platform từ đầu: đăng ký bằng
migration (`008_seed_blockdrop.sql`), phục vụ ngay ở `/g/blockdrop/` **không cần restart**
service (bảng domain/client_dir tự làm mới), và mang theo harness verify riêng
(`blockdrop/test/playtest.js`) chạy đúng cổng G2/G3 của [SKILL_CHAIN.md](SKILL_CHAIN.md).
