/**
 * Mã phòng 4 ký tự.
 *
 * Bảng chữ bỏ các ký tự dễ đọc sai khi đọc qua điện thoại hoặc nhìn màn hình
 * nhỏ: 0/O, 1/I/L, 2/Z, 5/S, 8/B. Còn 25 ký tự -> 25^4 = 390.625 mã.
 * Đủ cho M1; khi tỉ lệ trùng lúc cấp mã vượt ~1% thì tăng CODE_LENGTH —
 * registry đã kiểm trùng nên đây là đổi một hằng số, không phải đổi thiết kế.
 *
 * CỐ Ý KHÔNG "đoán" ký tự người dùng nhập sai (kiểu O -> 0). Đoán sai sẽ đưa
 * người chơi vào ĐÚNG một phòng khác đang tồn tại — tệ hơn nhiều so với báo lỗi
 * và để họ nhập lại.
 */
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679'
export const CODE_LENGTH = 4
export const CODE_SPACE = Math.pow(ALPHABET.length, CODE_LENGTH)

export function generateCode(rand: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)]
  return s
}

/**
 * Chuẩn hoá mã người dùng nhập: hoa hoá, bỏ khoảng trắng và dấu gạch.
 * Trả null nếu có ký tự không thuộc bảng chữ hoặc sai độ dài.
 */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '')
  if (s.length !== CODE_LENGTH) return null
  for (const ch of s) if (!ALPHABET.includes(ch)) return null
  return s
}

export function isValidCode(input: string): boolean {
  return normalizeCode(input) !== null
}
