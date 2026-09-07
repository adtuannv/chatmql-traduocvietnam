import { create } from 'zustand'
import type { AuthUser } from '@/types/api'
import { api, clearRefreshToken, clearTokens, setTokens } from '@/lib/api-client'
import { disconnectSocket, reconnectSocket } from '@/lib/socket'

interface AuthState {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  loadMe: () => Promise<void>
  setUser: (u: AuthUser | null) => void
  /** Owner/admin xem hệ thống dưới quyền một nhân viên. */
  impersonate: (userId: string) => Promise<AuthUser>
  /** Thoát chế độ xem hộ, quay lại tài khoản quản trị gốc. */
  stopImpersonation: () => Promise<AuthUser>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    setTokens(data.token, data.refreshToken)
    reconnectSocket()
    set({ user: data.user, loading: false })
    return data.user
  },

  logout: async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      /* bỏ qua lỗi mạng khi logout */
    }
    clearTokens()
    disconnectSocket()
    set({ user: null })
  },

  loadMe: async () => {
    try {
      const { data } = await api.get('/auth/me')
      set({ user: data, loading: false })
    } catch {
      set({ user: null, loading: false })
    }
  },

  setUser: (u) => set({ user: u }),

  impersonate: async (userId) => {
    // Backend chỉ trả access token (hạn 4h), không kèm refresh token. Phải xoá
    // refresh token của quản trị viên, nếu không 401 sẽ lặng lẽ cấp lại quyền
    // admin trong khi giao diện vẫn tưởng đang là nhân viên. Hết 4h → về /login.
    const { data } = await api.post(`/auth/impersonate/${userId}`)
    setTokens(data.token)
    clearRefreshToken()
    reconnectSocket()
    set({ user: { ...data.user, impersonatedBy: data.user.impersonatedBy ?? null } })
    return data.user
  },

  stopImpersonation: async () => {
    const { data } = await api.post('/auth/stop-impersonation')
    setTokens(data.token, data.refreshToken)
    reconnectSocket()
    set({ user: data.user })
    return data.user
  },
}))
