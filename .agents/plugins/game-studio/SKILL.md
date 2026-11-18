---
name: game-studio
description: 'Make or fix an arcade browser game (2D or 2.5D/isometric): spec → build (art, Blender sprites) → playtest → iterate → ship. Use when asked to make, clone, tune, beautify or ship a game. NOT for: non-game apps.'
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

## Công cụ: mọi thao tác là một tool

Plugin khai MCP server `arcade` (khi đã `bomclaw plugins trust game-studio`): **dùng tool, đừng tự đọc/đoán
file** khi có tool làm việc đó — `spec_validate`, `spec_get`, `manifest_get`, `games_list`, `assets_list`,
`game_new`; gameplay: `balance_check`, `curves_get`, `bot_simulate` (tỉ lệ thắng theo seed), `bot_replay`,
`config_set` (sửa một số cân bằng rồi kiểm lại — dùng ở bước iterate thay vì sửa tay).
Developer review cùng những thứ đó ở `arcade studio <thư-mục-game>` (trang local): mỗi nút là một action. Cùng lệnh trong shell: `arcade actions`, `arcade call <action> '<json>'` (bin/ của plugin nằm
trong PATH). Trong trình duyệt, game điều khiển qua `window.__game` (`state`, `start`, `setInput`).

## Art: game phải bắt mắt

Ở bước Build (và Iterate khi người chơi chê "xấu", "nhạt"), đọc `art/` theo thứ tự:
`art/direction.md` (chốt phong cách, ghi `art.json`) → `art/palette.md` → `art/sprites.md` hoặc
`art/25d.md` (mô hình 3D trong Blender → sprite isometric) → `art/maps.md` → `art/animation.md` →
`art/juice.md`. Dùng asset có sẵn: `art/assets-licensing.md`. **Game chạy đúng mà trông như hình
khối xám là chưa xong.**

Tool art: `blender_status`, `sprites_render` (MCP `arcade`, Blender headless); MCP `blender` khi người
đang mở Blender.

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
