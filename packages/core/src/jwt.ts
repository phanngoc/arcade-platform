// JWT HS256 cho M0. Claim gid nằm TRONG token: mọi truy vấn lấy gameId từ token,
// không bao giờ từ tham số request — đây là nền của cách ly multi-tenant.
// M2: đổi sang EdDSA khi gateway tách khỏi api (gateway chỉ cần public key).
import { SignJWT, jwtVerify } from 'jose'

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-only-change-me')
const ACCESS_TTL = Number(process.env.ACCESS_TTL_SEC ?? 900)
const REFRESH_TTL = Number(process.env.REFRESH_TTL_SEC ?? 7776000)

export type Claims = { sub: string; gid: string; gst: boolean; typ: 'access' | 'refresh' }

async function mint(c: Claims, ttl: number): Promise<string> {
  return new SignJWT({ gid: c.gid, gst: c.gst, typ: c.typ })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(secret)
}

export function mintAccess(sub: string, gid: string, gst: boolean): Promise<string> {
  return mint({ sub, gid, gst, typ: 'access' }, ACCESS_TTL)
}
export function mintRefresh(sub: string, gid: string, gst: boolean): Promise<string> {
  return mint({ sub, gid, gst, typ: 'refresh' }, REFRESH_TTL)
}

export async function verify(token: string, typ: 'access' | 'refresh' = 'access'): Promise<Claims> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
  if (payload.typ !== typ) throw new Error(`sai loại token: cần ${typ}`)
  return { sub: payload.sub!, gid: payload.gid as string, gst: payload.gst as boolean, typ }
}

export const accessTtlSec = ACCESS_TTL
