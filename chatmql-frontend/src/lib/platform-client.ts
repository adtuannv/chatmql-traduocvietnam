/**
 * platform-client.ts — Axios instance RIÊNG cho khu vực Platform (super-admin).
 *
 * Tách biệt hoàn toàn với `api` của người dùng CRM: token platform lưu ở key
 * localStorage riêng (`platform_token` / `platform_refreshToken`) và không
 * bao giờ dùng chung interceptor với app CRM.
 */
import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios'
import { API_BASE } from './config'

export const PLATFORM_TOKEN_KEY = 'platform_token'
export const PLATFORM_REFRESH_KEY = 'platform_refreshToken'

export const platformApi: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

// ── Token helpers ─────────────────────────────────────────────────
export function getPlatformToken() {
  return localStorage.getItem(PLATFORM_TOKEN_KEY)
}
export function getPlatformRefreshToken() {
  return localStorage.getItem(PLATFORM_REFRESH_KEY)
}
export function setPlatformTokens(token: string, refreshToken?: string) {
  localStorage.setItem(PLATFORM_TOKEN_KEY, token)
  if (refreshToken) localStorage.setItem(PLATFORM_REFRESH_KEY, refreshToken)
}
export function clearPlatformTokens() {
  localStorage.removeItem(PLATFORM_TOKEN_KEY)
  localStorage.removeItem(PLATFORM_REFRESH_KEY)
}

// ── Gắn Bearer token platform ─────────────────────────────────────
platformApi.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getPlatformToken()
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
  clearPlatformTokens()
  if (!window.location.pathname.startsWith('/platform/login')) {
    window.location.href = '/platform/login'
  }
}

platformApi.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    const status = error.response?.status
    const code = (error.response?.data as { code?: string } | undefined)?.code

    const url = original?.url || ''
    const isAuthCall =
      url.includes('/platform/auth/login') || url.includes('/platform/auth/refresh')

    if (status === 401 && !original?._retry && !isAuthCall) {
      const refreshToken = getPlatformRefreshToken()
      if (!refreshToken || code === 'TOKEN_INVALID' || code === 'NOT_PLATFORM_ADMIN') {
        forceLogout()
        return Promise.reject(error)
      }
      original._retry = true

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          waiters.push((token) => {
            if (!token) return reject(error)
            original.headers.Authorization = `Bearer ${token}`
            resolve(platformApi(original))
          })
        })
      }

      isRefreshing = true
      try {
        const { data } = await axios.post(`${API_BASE}/platform/auth/refresh`, { refreshToken })
        setPlatformTokens(data.token, data.refreshToken)
        onRefreshed(data.token)
        original.headers.Authorization = `Bearer ${data.token}`
        return platformApi(original)
      } catch (e) {
        onRefreshed(null)
        forceLogout()
        return Promise.reject(e)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  },
)

/** Trích thông điệp lỗi thân thiện từ response backend. */
export function platformApiError(err: unknown): string {
  const e = err as AxiosError<{ error?: string; message?: string }>
  return (
    e?.response?.data?.error ||
    e?.response?.data?.message ||
    e?.message ||
    'Đã có lỗi xảy ra'
  )
}
