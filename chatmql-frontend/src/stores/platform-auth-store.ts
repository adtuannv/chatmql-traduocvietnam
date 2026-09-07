/**
 * platform-auth-store.ts — Zustand store cho danh tính super-admin (Platform).
 *
 * Danh tính này TÁCH BIỆT với `auth-store` của người dùng CRM: gọi các endpoint
 * `/platform/auth/*` và dùng token riêng qua `platformApi`.
 */
import { create } from 'zustand'
import {
  platformApi,
  clearPlatformTokens,
  setPlatformTokens,
  getPlatformToken,
} from '@/lib/platform-client'

export interface PlatformAdmin {
  id: string
  email: string
  fullName: string
  isActive?: boolean
  lastLoginAt?: string | null
  createdAt?: string
}

interface PlatformAuthState {
  admin: PlatformAdmin | null
  loading: boolean
  login: (email: string, password: string) => Promise<PlatformAdmin>
  logout: () => Promise<void>
  loadMe: () => Promise<void>
  setAdmin: (a: PlatformAdmin | null) => void
}

export const usePlatformAuthStore = create<PlatformAuthState>((set) => ({
  admin: null,
  loading: true,

  login: async (email, password) => {
    const { data } = await platformApi.post('/platform/auth/login', { email, password })
    setPlatformTokens(data.token, data.refreshToken)
    // `admin` từ login là payload JWT (id nằm ở `sub`); tải profile đầy đủ ngay sau.
    const me = await platformApi.get('/platform/auth/me')
    set({ admin: me.data, loading: false })
    return me.data
  },

  logout: async () => {
    try {
      await platformApi.post('/platform/auth/logout')
    } catch {
      /* bỏ qua lỗi mạng khi đăng xuất */
    }
    clearPlatformTokens()
    set({ admin: null })
  },

  loadMe: async () => {
    if (!getPlatformToken()) {
      set({ admin: null, loading: false })
      return
    }
    try {
      const { data } = await platformApi.get('/platform/auth/me')
      set({ admin: data, loading: false })
    } catch {
      set({ admin: null, loading: false })
    }
  },

  setAdmin: (a) => set({ admin: a }),
}))
