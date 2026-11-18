# art/animation — chuyển động có hồn

1. **Chạy logic bước cố định, vẽ nội suy; tween theo thời gian thực, không theo số khung.**
2. **Ngân sách khung:** idle 2–4 khung @ 4–6 fps; chạy 6–8 @ 10–12 fps; tấn công 3–5 có một khung
   "lấy đà" giữ lâu hơn.
3. **Chuyển động thủ tục là mặc định rẻ:** nhấp nhô `sin(t·2π·2Hz)·(1–2px)`, thở scale ±3%, chớp mắt 0.15s
   mỗi 2–4s (ngẫu nhiên). Rất ít code, game "sống" hẳn.
4. **Co–giãn giữ diện tích** (scaleX·scaleY ≈ 1): tiếp đất (1.25, 0.8), bật nhảy (0.85, 1.2); về nghỉ trong
   120–180ms bằng easeOutBack.
5. **Easing:** easeOutCubic cho di chuyển/UI (150–300ms); easeOutBack (s = 1.70158) cho bật vào; easeInBack
   cho lấy đà. **Không dùng linear cho thứ có "vật lý".** Tự viết ~10 công thức (đừng chép easings.net — GPL).
6. **Mọi tween phải kết thúc đúng giá trị nghỉ** — có test khẳng định điều đó (lỗi hay gặp: scale kẹt 1.02).
7. **Sprite sheet:** khung = `floor(t·fps) % frames` (xem `src/sprites.ts`); đổi hướng nhìn theo
   `directionRow` chứ không lật ảnh với 2.5D (bóng đổ sẽ sai phía).

Nguồn: tweenjs/tween.js (MIT), gre/bezier-easing (MIT), juliangarnier/anime (MIT); Penner easing; nguyên
lý squash & stretch / anticipation (chưng cất).
