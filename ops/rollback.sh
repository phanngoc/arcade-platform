#!/bin/bash
# Trả các game về server riêng của từng game (trạng thái trước khi chuyển sang platform).
# Chạy khi platform có vấn đề. Không cần dừng platform trước.
set -e
U=$(id -u)

echo "▸ khôi phục ingress cloudflared"
cp "$(dirname "$0")/cloudflared.config.pre-arcade.bak" ~/.cloudflared/config.yml

echo "▸ bật lại server riêng của từng game"
# blockdrop chỉ sống trên platform lúc bình thường, nên plist của nó nằm trong
# repo và được cài vào đây — thiếu bước này thì rollback làm drop.bomclaw.org
# chết im lặng.
cp -f "$(dirname "$0")/com.ngocp.blockdrop.plist" "$HOME/Library/LaunchAgents/" 2>/dev/null || true
for L in com.ngocp.tankbattle com.ngocp.rumba com.ngocp.castle com.ngocp.blockdrop; do
  [ -f "$HOME/Library/LaunchAgents/$L.plist" ] || { echo "  ! thiếu $L.plist, bỏ qua"; continue; }
  launchctl bootout "gui/$U/$L" 2>/dev/null || true
  launchctl bootstrap "gui/$U" "$HOME/Library/LaunchAgents/$L.plist"
done

echo "▸ tắt platform"
# Since 2026-11-06 the platform runs under pm2 (~/.goterm-shared/pm2/arcade.config.cjs);
# the launchd line stays for a machine that still has the old job.
PM2=$(command -v pm2 || ls -d "$HOME"/.nvm/versions/node/*/bin/pm2 2>/dev/null | tail -1)
[ -n "$PM2" ] && "$PM2" stop arcade 2>/dev/null && "$PM2" save >/dev/null 2>&1 || true
launchctl bootout "gui/$U/com.ngocp.arcade" 2>/dev/null || true

echo "▸ nạp lại cloudflared"
launchctl kickstart -k "gui/$U/com.cloudflare.cloudflared" 2>/dev/null || \
  launchctl kickstart -k "system/com.cloudflare.cloudflared" 2>/dev/null || true

sleep 5
for h in tank rumba castle drop; do
  printf "  %-22s %s\n" "$h.bomclaw.org" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$h.bomclaw.org/")"
done
echo "✓ đã rollback"
