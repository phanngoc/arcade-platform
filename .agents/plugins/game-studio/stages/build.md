# game-build — spec thành code

## Bắt đầu: `arcade new`, không viết tay từ trang trắng

```
node packages/cli/src/index.ts new <id> --spec <spec.json đã duyệt> [--dir thư-mục-cha]
```

Template lấy từ `spec.template`: `vite-offline` (một người) hoặc `vite-authoritative-mp` (phòng, server
là chân lý). Game ra đời đã có sẵn những thứ dưới đây — **sửa game mẫu thành game của spec, đừng dựng
lại khung**: engine thuần + `config.ts` + RNG có seed, bot + test G3, SDK + cầu nối platform, cổng
`window.__game` cho agent/playtest, và (MP) `server/room.ts` dùng chung luật với client, có test nạp
nó trong sandbox giống platform. Không có `--spec` thì `spec.json` mang mốc `__FILL__` và validate chặn.

## Quy ước bắt buộc (rút từ các game đã làm)

1. **Vite + TypeScript** (theo 9 game gần đây; tank/castle/rumba là vanilla từ trước). `npm run dev` chạy
   local không cần platform; `npm test` (vitest); `npm run build` ra `dist/` — thứ platform phục vụ.
2. **Mobile-first, portrait.** Người chơi thật vào bằng điện thoại. Vùng chạm ≥ 44px, D-pad + nút hành động
   cỡ lớn ở nửa dưới, canvas ở nửa trên. Desktop là bonus, không phải mục tiêu chính.
3. **Tách engine khỏi UI.** `src/engine.ts` (MP: `src/shared/`) = logic thuần, test được, không chạm DOM,
   không `Math.random` (RNG có seed — cùng seed cùng ván, bot/test mới tin được); `src/main.ts` = render + input.
   `rumba` làm đúng (generator + solver kiểm tra nghiệm duy nhất nằm trong engine) → sửa UI không sợ vỡ luật.
4. **Tham số cân bằng ở `src/config.ts`**, hằng số có tên kèm đơn vị: `export const GRAV = 1500; // px/s²`.
   Mỗi ràng buộc trong `spec.balance` có một dòng trong `BALANCE` để test kiểm trên số thật. Không rải magic number trong logic — `stages/iterate.md` cần sửa số này.
5. **DPR cap = 2.** `Math.min(window.devicePixelRatio || 1, 2)` — hơn nữa chỉ tốn fill rate trên mobile.
6. **Không cấp phát trong vòng lặp render.** Tái dùng object/array; đây là nguyên nhân giật số 1 trên mobile.
7. **Va chạm theo quãng đã đi trong bước, không chỉ vị trí cuối.** Bước dài (máy chậm, bot mô phỏng thô)
   không được cho vật "nhảy" qua nhau. *(block-dodge, template: bot mô phỏng ở 1/20s đi xuyên khối mà
   game thật ở 1/60s thì chết — luật phụ thuộc dt là lỗi luật.)*
8. **Giữ cổng `window.__game`** (`state`, `start`, `setInput`): agent và playtest điều khiển game qua đó, không
   đoán từ pixel. Input từ cổng thắng bàn phím/chạm cho tới khi `setInput(null)`.
9. **Bot G3 phản xạ như người** (chọn đích mỗi ~200ms, giữa đó đi tới đích rồi dừng). Bot phản xạ từng tick
   chứng minh game thắng được với máy, không phải với người.

## Nếu là game nhiều người

- **Server là chân lý** (authoritative). Client chỉ gửi input, không gửi vị trí.
- Tick 30Hz là đủ cho game 2D; đừng chạy 60Hz trên server.
- Mã phòng 4 ký tự, **bỏ ký tự dễ nhầm** (`0/O`, `1/I`), kèm link mời copy được. Phòng trống tự thu hồi
  sau ~60s. (Khi có Arcade SDK thì platform lo hết phần này — xoá code tự viết.)
- Người vào giữa trận phải vào được; đừng chặn join.

## Nếu đã có Arcade SDK

Đọc `arcade.toml` + typing SDK trước khi viết. Không gọi capability chưa khai báo trong manifest.
State phải là JSON thuần trong `room.state` — không tự serialize, không tự broadcast.

## Đầu ra

Game chạy được ở local + `arcade.toml` (hoặc `server.js` tối thiểu nếu chưa lên platform).
Chuyển ngay sang `stages/playtest.md` — **không tự tuyên bố "xong"** trước khi qua cổng verify.
