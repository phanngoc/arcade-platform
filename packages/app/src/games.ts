// Nạp định nghĩa game từ DB (manifest) + đĩa (room module, nếu có).
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from '@arcade/core'
import type { GameDef } from '@arcade/roomd'

type Manifest = {
  runtime?: { mode?: string; tick_rate?: number; max_players?: number; idle_timeout_sec?: number; reconnect_window_sec?: number }
  limits?: { state_bytes?: number; msg_per_sec?: number; cpu_ms_per_tick?: number }
}

export async function loadGameDefs(gamesDir: string): Promise<GameDef[]> {
  const rows = await sql<{ id: string; manifest: Manifest }[]>`select id, manifest from games`
  const out: GameDef[] = []
  for (const r of rows) {
    const m = r.manifest ?? {}
    const mode = (m.runtime?.mode ?? 'offline') as GameDef['mode']
    // Room module là tuỳ chọn: game offline không có server/room.js và không
    // chạm vào rủi ro sandbox chút nào.
    const p = join(gamesDir, r.id, 'server', 'room.js')
    const roomSource = mode !== 'offline' && existsSync(p) ? readFileSync(p, 'utf8') : null
    out.push({
      gameId: r.id,
      mode,
      roomSource,
      limits: {
        ...(m.runtime?.tick_rate ? { tickRate: m.runtime.tick_rate } : {}),
        ...(m.runtime?.max_players ? { maxPlayers: m.runtime.max_players } : {}),
        ...(m.runtime?.idle_timeout_sec ? { idleTimeoutSec: m.runtime.idle_timeout_sec } : {}),
        ...(m.runtime?.reconnect_window_sec ? { reconnectWindowSec: m.runtime.reconnect_window_sec } : {}),
        ...(m.limits?.state_bytes ? { stateBytes: m.limits.state_bytes } : {}),
        ...(m.limits?.msg_per_sec ? { msgPerSec: m.limits.msg_per_sec } : {}),
        ...(m.limits?.cpu_ms_per_tick ? { cpuMsPerTick: m.limits.cpu_ms_per_tick } : {}),
      },
    })
  }
  return out
}
