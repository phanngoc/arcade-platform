# art/juice — phản hồi làm game "đã tay"

Một điểm vào duy nhất: `feedback(tier, x, y)`. Mọi va chạm/nhặt/thắng gọi nó — không rải hiệu ứng khắp nơi.

| tier | trauma | hit-stop | hạt | thêm |
|---|---|---|---|---|
| small (nhặt xu) | 0.1–0.2 | — | 0–4 | âm "ting" |
| medium (trúng đòn) | 0.3–0.5 | 40–60ms | 6–12 | chớp trắng |
| large (nổ, thắng) | 0.7–1.0 | 100–150ms | 20–40 | chớp, zoom nhẹ, số bật lên |

1. **Rung = trauma² × ~12px** (nhân width/360), nguồn là tổng các sin/noise mượt — **không** random mỗi
   khung (rung giật, gây chóng mặt). trauma giảm ~1.2/giây theo thời gian thực.
2. **Chớp trúng đòn:** vẽ sprite trắng 1–2 khung (50–80ms). **Số bật lên** bay 20–30px, mờ dần 0.6s.
3. **Hạt từ pool cấp sẵn**, trần ~300 hạt sống trên mobile (quy ước nhà); sống 0.3–0.8s, co lại + mờ đi,
   màu lấy từ dải palette.
4. **Lưu dấu:** mảnh vỡ/vết cháy ở lại màn hình một lúc — thế giới nhớ việc người chơi làm.
5. **Âm thanh là một nửa juice:** mỗi sự kiện một tiếng (ZzFX sinh tiếng bằng code, MIT, < 1KB).
6. **Trợ năng:** cài đặt rung 0–100% và "giảm chớp sáng".
7. **Test:** hai cú đánh cách nhau 30ms → timeScale trở về 1 và trauma về 0 trong 1/decay giây. Juice
   không được làm game kẹt chậm.

Nguồn: gamedev-skills `game-feel` (Apache-2.0) — bảng tier; grapefrukt/juicy-breakout (Zlib); "Juice it or
lose it" (Jonasson & Purho), "The art of screenshake" (Nijman), GDC "Juicing your cameras with math"
(chưng cất); KilledByAPixel/LittleJS + ZzFX (MIT).
