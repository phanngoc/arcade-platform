# art/maps — map đẹp và luôn chơi được

1. **Sinh vào lưới số nguyên trước, vẽ sau.** Một RNG có seed (`src/rng.ts`) cho mọi thứ sinh ra —
   cùng seed cùng map, bot và người chơi daily thấy cùng một map.
2. **Ô 16px logic** (~22 cột ở 360px). Mép địa hình: **marching squares 16 ô** (mặt nạ 4 bit theo góc).
   Tường: **blob 47 ô** (mặt nạ 8 bit rút còn 47) chỉ khi cần góc trong/ngoài đẹp.
3. **Chọn thuật toán theo nội dung:** địa hình = noise fBm 3–4 octave; hang = cellular automata (45% đầy,
   4–5 vòng); dungeon = phòng + cây khung (rooms & mazes); kề nhau có luật = Wave Function Collapse.
4. **Kiểm mọi map:** flood-fill từ điểm xuất phát tới đích phải tới được; vùng an toàn quanh điểm xuất phát
   ≥ 3 ô. Hỏng → seed+1, tối đa 10 lần, rồi báo lỗi (đừng ship map kẹt). Đây là ràng buộc `balance`.
5. **Chiều sâu bằng parallax 2–3 lớp** tốc độ 0.2 / 0.5 / 1.0. Game portrait cuộn dọc.
6. **Trang trí rải Poisson-disk**, phủ 5–15%, 2–3 biến thể mỗi loại ô, lật/xoay để phá lặp.
7. **Nướng lớp tĩnh ra một canvas phụ mỗi chunk**; mỗi khung chỉ vẽ lớp động.
8. **2.5D:** lưới dimetric (`src/iso.ts`), sắp thứ tự vẽ theo chiều sâu (`depthSort`), ô nền là hình thoi
   (`tilePath`) — xem `art/25d.md`.

Nguồn: kchapelier/wavefunctioncollapse (MIT), mxgmn/WaveFunctionCollapse (MIT), jwagner/simplex-noise.js
(MIT), ondras/rot.js (BSD-3), redblobgames/mapgen4 (Apache-2.0); Boris the Brave "classification of
tilesets", Bob Nystrom "Rooms and Mazes", bài viết Red Blob Games (chưng cất).
