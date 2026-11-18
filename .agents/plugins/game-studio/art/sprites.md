# art/sprites — nhân vật và vật phẩm vẽ bằng code

Không có model ảnh? Không sao: sprite pixel/vector vẽ bằng code, đúng kỹ thuật, đẹp hơn ảnh AI lạc tông.
2.5D (mô hình 3D render thành sprite) → `art/25d.md`.

## Kích thước

| Thứ | Kích thước logic | Ghi chú |
|---|---|---|
| vật phẩm, đạn, xu | 16×16 | nghiêng 15–30°, 1–2px lấp lánh trắng, bóng elip dưới chân |
| người chơi, địch | 24×24 hoặc 32×32 | người chơi ≈ 8–12% chiều rộng màn hình |
| boss | 48–64 | |

Vẽ ở 1× rồi phóng ×3 (màn 360px).

## Quy trình mỗi sprite

1. **Định nghĩa bằng ma trận chuỗi theo chỉ số palette**, render MỘT lần ra canvas phụ, mỗi khung chỉ
   `drawImage` bản cache — không bao giờ vẽ từng pixel mỗi khung.
   ```ts
   const HERO = ['..1111..', '.122221.', '12322321', /* … */];   // 0/. = trong suốt, 1 = viền, 2 = thân…
   ```
2. **Lớp:** tô thân → 1px bóng mép dưới-phải → 1px sáng mép trên-trái → viền ngoài (màu tối nhất).
3. **Nhân vật có mắt.** Khuôn mặt là thứ mắt người đọc nhanh nhất; hai chấm đen + một chấm trắng là đủ.
4. **Biến thể thủ tục (địch, vật phẩm hàng loạt):** mặt nạ 2D (viền / rỗng / có-thể-thân / thân) → ngẫu
   nhiên hoá bằng RNG có seed → **lật gương theo trục X** (đối xứng = trông "có chủ đích") → viền + đổ bóng.
   Cùng seed ra cùng sprite: build lại không đổi hình.
5. **Tránh:** đổ bóng gối (tối dần từ giữa ra mọi phía), pixel lẻ loi, viền đen thuần, sprite chỉ khác màu.
6. **Kiểm bằng code:** thử bóng (tô đen, so hình), tương phản với nền (`art/direction.md` §4).

Nguồn: zfedoran/pixel-sprite-generator (MIT) — kỹ thuật mặt nạ + lật gương; yurkth/sprator (MIT);
game-creator `pixel-renderer` (chưa LICENSE — chỉ chưng cất); Saint11, Slynyrd (chưng cất).
