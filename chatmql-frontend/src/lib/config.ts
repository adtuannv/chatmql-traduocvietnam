/**
 * URL gốc backend (không kèm /api/v1).
 * - Dev: VITE_API_URL hoặc http://localhost:4520 khi chạy ở localhost.
 * - Production: để RỖNG = cùng origin — nginx đã proxy /api, /uploads, /socket.io
 *   về backend (xem deploy/nginx-chatmql-dev.conf). Không nhúng cứng tên miền.
 */
export const API_ORIGIN =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ??
  (typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:4520'
    : '')

export const API_BASE = `${API_ORIGIN}/api/v1`

/** Trùng khóa với bản build cũ của ChatMQL để phiên đăng nhập dùng chung khi chuyển đổi. */
export const TOKEN_KEY = 'token'
export const REFRESH_KEY = 'refreshToken'
