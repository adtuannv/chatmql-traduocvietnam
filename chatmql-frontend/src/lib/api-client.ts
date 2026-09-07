import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios'
import { API_BASE, REFRESH_KEY, TOKEN_KEY } from './config'

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY)
}
export function setTokens(token: string, refreshToken?: string) {
  localStorage.setItem(TOKEN_KEY, token)
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken)
}
export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
}
/**
 * Bỏ refresh token nhưng giữ access token.
 *
 * Dùng khi xem dưới quyền nhân viên: nếu vẫn còn refresh token của quản trị
 * viên, một lỗi 401 bất kỳ sẽ khiến interceptor lặng lẽ cấp lại token QUẢN TRỊ
 * trong khi giao diện vẫn hiển thị đang là nhân viên — sai quyền mà không ai biết.
 */
export function clearRefreshToken() {
  localStorage.removeItem(REFRESH_KEY)
}

// ── Gắn Bearer token ──────────────────────────────────────────────
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Auto-refresh khi 401 (gộp các request đồng thời) ──────────────
let isRefreshing = false
let waiters: Array<(token: string | null) => void> = []

function onRefreshed(token: string | null) {
  waiters.forEach((cb) => cb(token))
  waiters = []
}

function forceLogout() {
  clearTokens()
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login'
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    const status = error.response?.status
    const code = (error.response?.data as { code?: string } | undefined)?.code

    // Không thử refresh cho chính endpoint login/refresh
    const url = original?.url || ''
    const isAuthCall = url.includes('/auth/login') || url.includes('/auth/refresh')

    if (status === 401 && !original?._retry && !isAuthCall) {
      const refreshToken = getRefreshToken()
      if (!refreshToken || code === 'TOKEN_INVALID') {
        forceLogout()
        return Promise.reject(error)
      }
      original._retry = true

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          waiters.push((token) => {
            if (!token) return reject(error)
            original.headers.Authorization = `Bearer ${token}`
            resolve(api(original))
          })
        })
      }

      isRefreshing = true
      try {
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken })
        setTokens(data.token, data.refreshToken)
        onRefreshed(data.token)
        original.headers.Authorization = `Bearer ${data.token}`
        return api(original)
      } catch (e) {
        onRefreshed(null)
        forceLogout()
        return Promise.reject(e)
      } finally {
        isRefreshing = false
      }
    }

    // Org hết hạn / khóa → đăng xuất
    if (status === 403 && (code === 'ORG_EXPIRED' || code === 'ORG_SUSPENDED')) {
      forceLogout()
    }

    return Promise.reject(error)
  },
)

/** Trích thông điệp lỗi thân thiện từ response backend. */
export function apiError(err: unknown): string {
  // Backend có 2 kiểu lỗi: `{ error: 'chuỗi' }` (đa số) và envelope
  // `{ success:false, error: { code, message } }` (nhóm products/knowledge).
  // Trả về object sẽ làm React sập ("Objects are not valid as a React child").
  const e = err as AxiosError<{ error?: string | { code?: string; message?: string }; message?: string }>
  const raw = e?.response?.data?.error
  const fromError = typeof raw === 'string' ? raw : raw?.message
  return fromError || e?.response?.data?.message || e?.message || 'Đã có lỗi xảy ra'
}
