---
name: game-studio
description: 'Make or fix an arcade browser game: spec → build → playtest → iterate → ship. Use when asked to make, clone, tune or ship a game. NOT for: non-game apps.'
---

# game-studio — prompt thành game chơi được

Năm bước, mỗi bước là một file trong `stages/` cạnh file này. **Đọc đúng file của bước
trước khi làm bước đó** — mỗi file mang bài học đã trả giá từ các game thật (tank-battle,
castle, rumba, blockdrop), không phải lý thuyết.

| Bước | File | Vào → Ra | Cổng chặn |
|---|---|---|---|
| 1. Spec | `stages/spec.md` | prompt → `spec.json` | người duyệt spec |
| 2. Build | `stages/build.md` | spec → code chạy local | — |
| 3. Playtest | `stages/playtest.md` | code + spec → bảng pass/fail G1–G4 | **fail thì dừng** |
| 4. Iterate | `stages/iterate.md` | phản hồi / log fail → patch nhỏ | chạy lại playtest |
| 5. Ship | `stages/ship.md` | code đã pass → URL công khai | verify local + tunnel |

Hai vòng lặp: **fix** (playtest ⇄ iterate, tối đa 3 vòng rồi trả về cho người) và
**cải tiến** (người chơi → iterate → playtest → ship).

## Vào bước nào

- "Làm game …", "clone game …" → bắt đầu từ **Spec**. Không nhảy thẳng vào code.
- "Địch nhanh quá", "thêm màn", "giật trên iPhone", đổi luật theo đề xuất, hoặc playtest vừa fail → **Iterate**.
- "Đưa lên mạng", "cho bạn chơi thử" → chỉ **Ship** sau khi Playtest pass.

## Ở đâu

- Plugin này là bản gốc trong repo `phanngoc/arcade-platform` (`.agents/plugins/game-studio/`); sửa một
  bước là sửa file `stages/` ở đó.
- Code game: repo arcade-platform, bản clone chạy thật ở `~/goterm-workspace/games/` (mỗi game một thư mục +
  repo riêng). Thiết kế: `PLATFORM_DESIGN.md`, `SKILL_CHAIN.md` ở gốc repo.
- Dự án ch_arcade (`~/goterm-projects/arcade`): bảng game/hằng số trong `AGENTS.md`; Preview của dự án
  (`preview/serve.mjs`) phục vụ thẳng working tree để xem thử không đụng production.
- Playtest dùng browser headless (Playwright / skill `browser`) cộng `test/playtest.js` của từng game.
  Đừng tuyên bố "xong" khi chưa qua cổng của nó.

Học được gì mới (một lỗi cân bằng, một cạm bẫy deploy) → ghi vào file `stages/` của bước đó, cho lần sau.
