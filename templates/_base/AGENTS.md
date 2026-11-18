# __GAME_NAME__ (`__GAME_ID__`)

Game trên platform Arcade, sinh bởi `arcade new` (template `__TEMPLATE__`). Dây chuyền làm game:
plugin `game-studio` của repo arcade-platform — spec → build → playtest → iterate → ship.

## Lệnh

| Lệnh | Làm gì |
|---|---|
| `npm run dev` | chạy local (http://localhost:5173), không cần platform |
| `npm test` | vitest: luật trong engine, ràng buộc `balance`, bot thắng được |
| `npm run build` | typecheck + build ra `dist/` (thứ platform phục vụ) |
| `arcade spec validate .` | (từ repo platform) kiểm `spec.json` + `arcade.toml` — cổng G1 |

## Quy ước (đừng phá)

1. **`spec.json` là nguồn chân lý.** Đổi luật hay cân bằng → sửa spec cùng commit, chạy lại `arcade spec validate`.
2. **Engine tách UI.** `src/engine.ts` (hoặc `src/shared/`) là logic thuần: không DOM, không `Math.random`
   trực tiếp (dùng RNG có seed), test được bằng vitest. `src/main.ts` chỉ vẽ + nhận input.
3. **Tham số cân bằng ở `src/config.ts`**, hằng số có tên kèm đơn vị. Không rải magic number trong logic.
4. **Mobile-first, portrait.** Vùng chạm ≥ 44px; desktop là phần thêm.
5. **Không cấp phát trong vòng lặp render** (tái dùng object/array). DPR chặn ở 2 (`src/canvas.ts`).
6. **Platform là bổ sung.** Mọi lời gọi platform qua `src/arcade.ts`, ngoài platform thì no-op.
7. Capability dùng trong code phải khai trong `arcade.toml` (bảng xếp hạng: `[capabilities].leaderboard`).

## Chưa xong khi

`npm test`, `npm run build` và `arcade spec validate` chưa cùng xanh — và playtest (G2/G3) chưa chạy.
