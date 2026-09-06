# games/

Các game trong workspace, gom về một chỗ ngày 2026-09-06.

| Thư mục | Kiểu | Git | Server |
|---|---|---|---|
| `tank-battle/` | Co-op 4P realtime (WebSocket, server authoritative) | [phanngoc/tank-battle-90](https://github.com/phanngoc/tank-battle-90) | `node server.js` — port 3000 (0.0.0.0) |
| `castle/` | 1P canvas, Castle Busters clone, round 60s | chưa init | `node server.js` — port 8789 (127.0.0.1) |
| `rumba/` | 1P puzzle (grid, nhiều mode/độ khó) | chưa init | `node server.js` — port 8788 (127.0.0.1) |

## Tài liệu

| File | Nội dung |
|---|---|
| [PLATFORM_DESIGN.md](PLATFORM_DESIGN.md) | Thiết kế kỹ thuật: abstraction, realtime engine, data model, AI Forge, roadmap |
| [BUSINESS_MODEL.md](BUSINESS_MODEL.md) | Thị trường, giá đối thủ, unit economics, bảng giá, 3 kịch bản tài chính, định giá, kill criteria |
| [SKILL_CHAIN.md](SKILL_CHAIN.md) | 5 skill làm game (`skills/`) và cách đóng gói vào platform |

PLATFORM_DESIGN.md — thiết kế platform "Supabase cho game": backend realtime/storage
dùng chung cho nhiều game + lớp AI Forge sinh game từ prompt. 3 game trên là bộ test case đầu tiên của
abstraction đó.
