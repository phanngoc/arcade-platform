# art/direction — chốt phong cách TRƯỚC khi vẽ

Game bắt mắt không đến từ vẽ đẹp từng hình, mà từ **một** phong cách nhất quán, đọc được trong nháy mắt
trên màn hình điện thoại. Đọc file này ở bước Build, trước khi vẽ thứ gì; ghi quyết định vào `art.json`
cạnh `spec.json` (spec nói *game là gì*, art.json nói *game trông thế nào*).

## art.json

```json
{
  "style": "pixel | flat-vector | neon | 2.5d",
  "logical": [360, 640],
  "palette": "sweetie-16",
  "light": "top-left",
  "outline": "darkest-palette-color, 1px (pixel) | 2–3px (vector)",
  "player": "8–12% chiều rộng màn hình",
  "mood": "một câu: cảm giác người chơi nên có"
}
```

## Quy tắc

1. **Một phong cách cho cả game.** Pixel (sprite 16–32px), flat vector (Path2D/SVG, viền 2–3px),
   neon (glow bằng `shadowBlur`, cache ra canvas phụ), hoặc 2.5D (sprite render từ Blender — `art/25d.md`).
   Trộn hai phong cách là thứ đầu tiên làm game trông "rẻ".
2. **Độ phân giải logic 360×640 portrait**, phóng nguyên lần + letterbox. Pixel art: `imageSmoothingEnabled = false`.
3. **Thử bóng (silhouette test):** tô đen mọi sprite — người chơi, địch, vật nhặt phải khác nhau bằng
   **hình dạng**, không chỉ bằng màu. Người mù màu và màn hình chói nắng đều chỉ thấy hình.
4. **Thử độ tương phản, đo bằng code:** độ sáng trung bình của vật gameplay so với nền ≥ 3:1 (tỉ lệ WCAG);
   giữa các lớp nền với nhau ≤ 1.5:1 (nền phải lùi lại). Ngưỡng là quy ước nhà — chỉnh ở playtest.
5. **Màu 60/30/10:** 60% nền (tối hơn, nhạt màu hơn), 30% vật gameplay (bão hoà), 10% màu nhấn — chỉ cho
   người chơi và nguy hiểm.
6. **Có chuyển động trong mọi khung hình**, kể cả màn chờ: nền trôi chậm, vật nhặt nhấp nhô, nhân vật thở.
   Màn hình đứng im trông như game bị treo.
7. **Màn mở đầu có "cú đập":** chớp sáng + logo/người chơi trượt vào 0.4s trước input đầu tiên.
8. **Chấm điểm trước khi ship:** chụp màn hình 390×844, tự chấm 1–5 cho *không khí, thứ bậc thị giác,
   bảng màu, chuyển động, phản hồi*. Mục nào < 3 → quay lại `stages/iterate.md`.

Đọc tiếp: `art/palette.md` → `art/sprites.md` (hoặc `art/25d.md`) → `art/maps.md` → `art/animation.md`
→ `art/juice.md`. Dùng asset có sẵn: `art/assets-licensing.md`.

Nguồn (chưng cất ý tưởng, không chép): gamedev-skills/awesome-gamedev-agent-skills `create-game-assets`
(Apache-2.0); PlayableIntelligence/game-creator `game-designer` — checklist "viral spectacle" (chưa có
LICENSE, chỉ chưng cất).
