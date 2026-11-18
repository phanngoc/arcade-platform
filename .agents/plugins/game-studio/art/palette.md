# art/palette — một bảng màu, gọi theo vai trò

1. **16–32 màu từ MỘT bảng Lospec** (Sweetie 16, PICO-8, Endesga 32, Resurrect 64) — chép mã hex vào
   `src/palette.ts`, ghi tên bảng + tác giả trong comment. Màu nằm ngoài bảng là lỗi: grep mã hex trong
   `src/` phải chỉ ra palette.ts.
2. **Code gọi vai trò, không gọi mã hex:** `bg0 bg1 bg2 fg player danger pickup ui flash`. Đổi bảng màu =
   sửa một file.
3. **Dải sáng–tối 3–5 bậc mỗi màu, có xoay hue:** bóng xoay 15–30° về xanh/tím, sáng xoay về vàng.
   **Không bao giờ làm tối bằng cách trộn đen** — ra màu bùn.
4. **Viền dùng màu tối nhất của bảng**, không phải `#000`.
5. **Hướng sáng cố định cho cả game** (mặc định trên-trái): sáng ở mép trên-trái, bóng ở mép dưới-phải.
   Sprite render từ Blender đã theo đúng hướng này (đèn cố định trong `sprites.render`).
6. **Nền nhạt hơn và tối hơn vật gameplay** (xem tỉ lệ ở `art/direction.md`). Đỏ/cam chỉ dành cho nguy
   hiểm — người chơi đọc màu nhanh hơn đọc chữ.
7. **Màn hình chói nắng:** thử bảng màu ở độ sáng 50% và chế độ thang xám; vật gameplay vẫn phải tách nền.

```ts
// src/palette.ts — Sweetie 16 by GrafxKid (lospec.com/palette-list/sweetie-16)
export const PAL = { bg0: '#1a1c2c', bg1: '#333c57', bg2: '#566c86', fg: '#f4f4f4', player: '#41a6f6',
  danger: '#b13e53', pickup: '#ffcd75', ui: '#94b0c2', flash: '#ffffff', outline: '#1a1c2c' } as const;
```

Nguồn: lospec.com/palette-list (mã hex dùng được, ghi công tác giả bảng); kỹ thuật xoay hue — Slynyrd
Pixelblog, Saint11 (chỉ chưng cất).
