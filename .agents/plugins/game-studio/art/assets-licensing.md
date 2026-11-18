# art/assets-licensing — dùng asset có sẵn mà không dính bản quyền

1. **Được dùng:** CC0 (Kenney — kenney.nl, không cần ghi công nhưng nên ghi), CC-BY 3.0/4.0, OGA-BY.
   **Hỏi chủ trước:** CC-BY-SA, GPL. **Không bao giờ:** NC (phi thương mại), ND, "free for personal use",
   ảnh lấy từ Google/Pinterest, asset game thương mại.
2. **Mỗi file trong `public/` lấy từ ngoài có một dòng trong `public/CREDITS.json`:** file, URL nguồn,
   tác giả, giấy phép + link văn bản giấy phép, ngày, đã sửa gì. Asset không có dòng = không ship.
   (`assets_list` liệt kê mọi resource — đối chiếu với CREDITS.json.)
3. **Có asset CC-BY → game có màn Credits** và `CREDITS.md`. game-icons.net (CC BY 3.0) ghi đúng mẫu:
   "Icons made by {tác giả}. Available on https://game-icons.net".
4. **Asset tự sinh** (vẽ bằng code, render từ Blender bằng mô hình tự dựng) không cần credit — ghi
   `"source": "generated"` để phân biệt với asset ngoài.
5. **Mô hình 3D tải về** (Poly Haven CC0, Sketchfab theo từng mô hình, Poly Pizza) cũng theo quy tắc 1–2;
   Blender MCP `import_asset` không miễn trách nhiệm ghi nguồn.
6. **Chép text/code từ repo Apache-2.0** (gamedev-skills, anthropics/skills) vào game: giữ LICENSE/NOTICE
   trong `third_party/`, ghi "modified from" ở đầu file.

Nguồn: kenney.nl/support, game-icons.net, opengameart.org (bộ lọc giấy phép).
