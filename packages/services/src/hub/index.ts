// Hub công khai: danh mục game + Forge (tạo game từ template có tham số).
//
// Ranh giới an toàn của Forge:
//  - người dùng KHÔNG gửi mã nguồn; chỉ chọn template + tham số trong khoảng cho phép
//  - server chỉ ghi đúng một file index.html vào <gamesDir>/<id>/, id do server sinh
//  - phải có access token (guest cũng được) và token phải thuộc chính game "hub"
//  - hạn mức: MAX_PER_PLAYER game/người và COOLDOWN_MS giữa 2 lần tạo
import type { FastifyInstance } from 'fastify'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { sql, badRequest, forbidden, notFound, conflict } from '@arcade/core'
import { TEMPLATES, normalize, render } from './template.ts'

export const HUB_GAME_ID = 'hub'
const MAX_PER_PLAYER = 5
const COOLDOWN_MS = 15_000

type Job = { id: string; owner: string; status: 'building' | 'ready' | 'failed'; gameId: string; playUrl?: string; error?: string }
const jobs = new Map<string, Job>()
const lastCreate = new Map<string, number>()

const rand = (n: number): string => {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]
  return s
}

/** Tên người dùng nhập -> id an toàn cho URL và cho tên thư mục. */
function slugify(title: string): string {
  const base = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 24)
  return `u-${base || 'game'}-${rand(5)}`
}

export async function hubRoutes(app: FastifyInstance, opts: { gamesDir: string }): Promise<void> {
  const root = resolve(opts.gamesDir)

  // Danh mục công khai. Không lộ owner_id, không lộ đường dẫn máy chủ.
  app.get('/v1/games', async () => {
    const rows = await sql<{ id: string; name: string; domains: string[] | null; created_from: string; manifest: Record<string, unknown>; created_at: Date }[]>`
      select id, name, domains, created_from, manifest, created_at
      from games where id <> ${HUB_GAME_ID} order by created_at asc, id asc`
    // Row DB không đủ: game chỉ vào danh mục khi bundle thật sự phục vụ được.
    // Nếu không, người chơi bấm vào và nhận 404.
    const playable = await Promise.all(rows.map(async (r) => {
      const m = (r.manifest ?? {}) as { game?: { client_dir?: string } }
      const dir = join(root, r.id, m.game?.client_dir || '.')
      try { return (await stat(join(dir, 'index.html'))).isFile() } catch { return false }
    }))
    return {
      games: rows.filter((_, i) => playable[i]!).map((r) => {
        const m = (r.manifest ?? {}) as { game?: { tagline?: string }; runtime?: { mode?: string } }
        const domain = (r.domains ?? [])[0]
        return {
          id: r.id,
          name: r.name,
          tagline: m.game?.tagline ?? null,
          mode: m.runtime?.mode ?? 'offline',
          createdFrom: r.created_from,
          playUrl: `/g/${r.id}/`,
          homeUrl: domain ? `https://${domain}/` : null,
        }
      }),
    }
  })

  app.get('/v1/forge/templates', async () => ({ templates: TEMPLATES, limits: { maxPerPlayer: MAX_PER_PLAYER, cooldownMs: COOLDOWN_MS } }))

  app.post('/v1/forge/games', async (req, reply) => {
    const actor = req.actor
    // Token phải là token của hub. Token của một game khác không được tạo game.
    if (actor.gameId !== HUB_GAME_ID) throw forbidden('FORGE_WRONG_AUDIENCE')

    const prev = lastCreate.get(actor.playerId) ?? 0
    if (Date.now() - prev < COOLDOWN_MS) throw conflict('FORGE_COOLDOWN', 'chờ vài giây rồi tạo tiếp')

    const [cnt] = await sql<{ n: string }[]>`select count(*)::text as n from games where owner_id = ${actor.playerId}`
    if (Number(cnt?.n ?? 0) >= MAX_PER_PLAYER) throw forbidden('FORGE_QUOTA', `tối đa ${MAX_PER_PLAYER} game mỗi người`)

    let params
    try {
      params = normalize((req.body ?? {}) as Record<string, unknown>)
    } catch (e) {
      throw badRequest((e as Error).message, 'tên game 2-32 ký tự, chỉ chữ/số/dấu câu cơ bản')
    }

    const gameId = slugify(params.title)
    const jobId = rand(12)
    const job: Job = { id: jobId, owner: actor.playerId, status: 'building', gameId }
    jobs.set(jobId, job)
    lastCreate.set(actor.playerId, Date.now())

    // Sinh ngoài vòng request: client hỏi trạng thái qua /v1/forge/jobs/:id.
    void (async () => {
      try {
        const dir = join(root, gameId)
        if (!dir.startsWith(root + '/')) throw new Error('PATH_ESCAPE')
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, 'index.html'), render(gameId, params), 'utf8')
        await sql`
          insert into games (id, owner_id, name, manifest, created_from)
          values (${gameId}, ${actor.playerId}, ${params.title}, ${sql.json({
            game: { client_dir: '.', tagline: `${params.template === 'dodge' ? 'Né' : 'Hứng'} · tốc độ ${params.speed}/5` },
            runtime: { mode: 'offline' },
            capabilities: { save: false, leaderboard: ['alltime'] },
            forge: { template: params.template, hue: params.hue, speed: params.speed, density: params.density },
          })}, 'forge')`
        job.status = 'ready'
        job.playUrl = `/g/${gameId}/`
      } catch (e) {
        job.status = 'failed'
        job.error = (e as Error).message
        app.log.error({ err: e, gameId }, 'forge lỗi')
      }
    })()

    return reply.code(202).send({ jobId, gameId, status: 'building' })
  })

  app.get('/v1/forge/jobs/:jobId', async (req) => {
    const { jobId } = req.params as { jobId: string }
    const job = jobs.get(jobId)
    // Job của người khác trả 404 y như job không tồn tại: không xác nhận sự tồn tại.
    if (!job || job.owner !== req.actor.playerId) throw notFound('JOB_NOT_FOUND')
    return { jobId: job.id, status: job.status, gameId: job.gameId, playUrl: job.playUrl ?? null, error: job.error ?? null }
  })

  // Game của chính người chơi (để hub hiện "game của bạn").
  app.get('/v1/forge/mine', async (req) => {
    const rows = await sql<{ id: string; name: string }[]>`
      select id, name from games where owner_id = ${req.actor.playerId} order by created_at desc`
    return { games: rows.map((r) => ({ id: r.id, name: r.name, playUrl: `/g/${r.id}/` })) }
  })
}
