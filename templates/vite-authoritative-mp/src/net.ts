/**
 * Hai nguồn state cho cùng một màn hình:
 *  - online: phòng trên platform (SDK window.Arcade) — server là chân lý;
 *  - local: "chơi thử" khi không có platform (npm run dev) — mô phỏng bằng
 *    chính src/shared/rules.ts, bạn + 1 bot. Cùng luật, nên thứ thấy ở local
 *    là thứ sẽ chạy trên server.
 */
import * as C from './shared/config';
import { initialState, join, setInput, tick, botInput, type GameState } from './shared/rules';

export interface Session {
  mode: 'online' | 'local';
  me: string;
  code: string | null;
  state(): GameState | null;
  input(dx: number, dy: number): void;
  step(dt: number): void; // chỉ local cần; online thì server lo
}

interface SdkRoom {
  code: string;
  playerId: string;
  state: unknown;
  send(name: string, data?: unknown): void;
  onStatus(f: (s: string) => void): SdkRoom;
}
interface SdkClient {
  rooms: { create(): Promise<SdkRoom>; join(code: string): Promise<SdkRoom>; codeFromUrl(): string | null };
}
type ArcadeGlobal = { init(o: { gameId: string; baseUrl?: string }): Promise<SdkClient> };

const w = globalThis as typeof globalThis & { Arcade?: ArcadeGlobal; ARCADE_GAME_ID?: string; ARCADE_BASE_URL?: string };

/** Giống arcade-bridge.js: chỉ nói chuyện với platform khi chắc chắn đang được nó phục vụ. */
export function platformAvailable(): boolean {
  return !!w.Arcade && !!w.ARCADE_GAME_ID && (!!w.ARCADE_BASE_URL || location.pathname.startsWith('/g/'));
}

export function inviteCode(): string | null {
  return new URLSearchParams(location.search).get('room');
}

export async function online(code: string | null): Promise<Session> {
  const opts: { gameId: string; baseUrl?: string } = { gameId: w.ARCADE_GAME_ID! };
  if (w.ARCADE_BASE_URL) opts.baseUrl = w.ARCADE_BASE_URL;
  const client = await w.Arcade!.init(opts);
  const room = code ? await client.rooms.join(code) : await client.rooms.create();
  let last = '';
  return {
    mode: 'online',
    me: room.playerId,
    code: room.code,
    state: () => (room.state as GameState | undefined) ?? null,
    input(dx, dy) {
      const key = `${dx.toFixed(2)},${dy.toFixed(2)}`;
      if (key === last) return; // chỉ gửi khi đổi — 20Hz × người chơi là đủ nặng rồi
      last = key;
      room.send('input', { dx, dy });
    },
    step() {},
  };
}

export function local(seed: number): Session {
  const s = initialState(seed);
  join(s, 'me', 'Bạn');
  join(s, 'bot', 'Bot');
  let acc = 0;
  return {
    mode: 'local',
    me: 'me',
    code: null,
    state: () => s,
    input: (dx, dy) => setInput(s, 'me', dx, dy),
    step(dt) {
      // Chạy đúng nhịp server (TICK_RATE), không theo khung hình: cảm giác ở local = trên platform.
      acc += dt;
      while (acc >= 1 / C.TICK_RATE) {
        const b = botInput(s, 'bot');
        setInput(s, 'bot', b.dx * 0.8, b.dy * 0.8); // bot chậm hơn bạn một chút
        tick(s, 1 / C.TICK_RATE);
        acc -= 1 / C.TICK_RATE;
      }
    },
  };
}
