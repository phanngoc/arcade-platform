// Không dùng parameter property (`constructor(public x)`) — Node chạy TS bằng
// strip-only, cú pháp đó không xoá được. tsconfig bật erasableSyntaxOnly để
// tsc chặn ngay lúc typecheck thay vì để vỡ lúc chạy.
export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message?: string) {
    super(message ?? code)
    this.status = status
    this.code = code
  }
}
export const badRequest = (code: string, m?: string) => new HttpError(400, code, m)
export const unauthorized = (code = 'UNAUTHORIZED', m?: string) => new HttpError(401, code, m)
export const forbidden = (code = 'FORBIDDEN', m?: string) => new HttpError(403, code, m)
export const notFound = (code = 'NOT_FOUND', m?: string) => new HttpError(404, code, m)
export const conflict = (code = 'CONFLICT', m?: string) => new HttpError(409, code, m)
