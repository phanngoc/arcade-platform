---
name: game-ship
version: 1.0.0
description: |
  Đưa game đã qua verify lên chạy thật, có tên miền và tự khởi động lại. Dùng sau /game-playtest pass.
  Hiện tại: launchd + Cloudflare tunnel. Về sau: đăng ký vào Arcade registry.
allowed-tools: [Bash, Read, Write, Edit]
---

# game-ship — deploy

## Hạ tầng hiện tại (đã dùng cho tank/rumba/castle)

launchd giữ process sống + Cloudflare tunnel `bomclaw` đưa ra internet. Cụ thể:
`<game>.bomclaw.org` → ingress → `127.0.0.1:<PORT>`.

**Checklist:**
1. Chọn PORT chưa dùng (đang dùng: 3000 tank, 8788 rumba, 8789 castle).
2. Viết `~/Library/LaunchAgents/com.ngocp.<game>.plist`: `ProgramArguments` = [node tuyệt đối, server.js tuyệt đối],
   `WorkingDirectory`, `EnvironmentVariables` (PORT, HOST=127.0.0.1 nếu sau tunnel), `RunAtLoad`+`KeepAlive` = true,
   log ra file trong thư mục game.
3. `launchctl bootout gui/$(id -u)/com.ngocp.<game>` rồi `launchctl bootstrap gui/$(id -u) <plist>`.
4. Thêm ingress vào config cloudflared + DNS record.
5. Verify **cả hai tầng**: `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:<PORT>/` **và** `https://<game>.bomclaw.org/`.

## Cạm bẫy đã gặp

- **Đường dẫn tuyệt đối trong plist.** Di chuyển thư mục game là hỏng service, và **không có lỗi nào hiện ra
  cho tới khi ai đó mở trang**. Đổi chỗ thư mục thì phải sửa plist + reload. *(Xảy ra thật ngày 2026-09-06
  khi gom 3 game vào `games/`.)*
- **cloudflared không hot-reload**: SIGHUP làm nó thoát, launchd khởi động lại. Đừng tưởng là crash.
- Dùng `node` bằng đường dẫn nvm tuyệt đối; launchd không có PATH của shell.

## Khi đã có platform

Thay toàn bộ mục trên bằng `arcade deploy`: bundle bất biến theo version, room module đẩy vào isolate pool,
rollback 1 lệnh. launchd/tunnel chỉ còn dùng cho self-host.
