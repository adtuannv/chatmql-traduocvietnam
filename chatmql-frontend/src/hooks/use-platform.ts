/**
 * use-platform.ts — TanStack Query hooks cho khu vực Platform (super-admin).
 * Tất cả gọi qua `platformApi` (token platform riêng), KHÔNG dùng `api` của CRM.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { platformApi } from '@/lib/platform-client'
import { TOKEN_KEY, REFRESH_KEY } from '@/lib/config'

// ── Kiểu dữ liệu ──────────────────────────────────────────────────
export type OrgDisplayStatus = 'active' | 'suspended' | 'expired' | 'unlimited'

export interface OrgStats {
  users: number
  contacts: number
  conversations: number
}

export interface OrgListItem {
  id: string
  name: string
  status: string
  expiresAt: string | null
  plan: string | null
  adminNotes: string | null
  createdAt: string
  updatedAt: string
  displayStatus: OrgDisplayStatus
  expiringSoon: boolean
  stats: OrgStats
}

export interface OrgUser {
  id: string
  email: string
  fullName: string
  role: 'owner' | 'admin' | 'manager' | 'member'
  isActive: boolean
  createdAt: string
}

export interface OrgDetail extends OrgListItem {
  users: OrgUser[]
}

export interface OrgListResponse {
  items: OrgListItem[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
}

export interface ReportOverview {
  companies: {
    total: number
    active: number
    suspended: number
    expired: number
    unlimited: number
    expiringIn7d: number
    newLast30d: number
  }
  users: number
  contacts: number
  conversations: number
}

// ── Reports ───────────────────────────────────────────────────────
export function usePlatformOverview() {
  return useQuery<ReportOverview>({
    queryKey: ['platform', 'overview'],
    queryFn: async () => {
      const { data } = await platformApi.get('/platform/reports/overview')
      return data
    },
  })
}

// ── Danh sách tổ chức ─────────────────────────────────────────────
export function usePlatformOrgs(params: { search?: string; page?: number; pageSize?: number }) {
  return useQuery<OrgListResponse>({
    queryKey: ['platform', 'orgs', params],
    queryFn: async () => {
      const { data } = await platformApi.get('/platform/orgs', { params })
      return data
    },
    placeholderData: (prev) => prev,
  })
}

export function usePlatformOrg(orgId: string | undefined) {
  return useQuery<OrgDetail>({
    queryKey: ['platform', 'org', orgId],
    queryFn: async () => {
      const { data } = await platformApi.get(`/platform/orgs/${orgId}`)
      return data
    },
    enabled: !!orgId,
  })
}

// ── Tạo tổ chức + chủ sở hữu ──────────────────────────────────────
export interface CreateOrgInput {
  orgName: string
  ownerFullName: string
  ownerEmail: string
  ownerPassword: string
  expiresAt?: string | null
  plan?: string | null
}

export function useCreateOrg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateOrgInput) => {
      const { data } = await platformApi.post('/platform/orgs', input)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'orgs'] }),
  })
}

// ── Cập nhật thông tin tổ chức (name / plan / notes) ──────────────
export function useUpdateOrg(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { name?: string; plan?: string | null; adminNotes?: string | null }) => {
      const res = await platformApi.patch(`/platform/orgs/${orgId}`, data)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'org', orgId] })
      qc.invalidateQueries({ queryKey: ['platform', 'orgs'] })
    },
  })
}

// ── Cấp phép: gia hạn (expiresAt) / khóa (status) ─────────────────
export function useUpdateOrgLicense(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { expiresAt?: string | null; status?: 'active' | 'suspended' }) => {
      const res = await platformApi.patch(`/platform/orgs/${orgId}/license`, data)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'org', orgId] })
      qc.invalidateQueries({ queryKey: ['platform', 'orgs'] })
      qc.invalidateQueries({ queryKey: ['platform', 'overview'] })
    },
  })
}

// ── Quản lý user của tổ chức ──────────────────────────────────────
export function useAddOrgUser(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { fullName: string; email: string; password: string; role?: string }) => {
      const res = await platformApi.post(`/platform/orgs/${orgId}/users`, data)
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'org', orgId] }),
  })
}

export function useSetOrgUserActive(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { userId: string; isActive: boolean }) => {
      const res = await platformApi.patch(`/platform/orgs/${orgId}/users/${vars.userId}`, {
        isActive: vars.isActive,
      })
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'org', orgId] }),
  })
}

export function useResetOrgUserPassword(orgId: string) {
  return useMutation({
    mutationFn: async (vars: { userId: string; newPassword: string }) => {
      const res = await platformApi.post(
        `/platform/orgs/${orgId}/users/${vars.userId}/reset-password`,
        { newPassword: vars.newPassword },
      )
      return res.data
    },
  })
}

// ── "Vào công ty": login-as → nhận company token → mở CRM ─────────
export function useEnterCompany() {
  return useMutation({
    mutationFn: async (vars: { orgId: string; userId?: string }) => {
      const { data } = await platformApi.post(`/platform/orgs/${vars.orgId}/login-as`, {
        userId: vars.userId,
      })
      return data as { token: string; user: unknown }
    },
    onSuccess: (data) => {
      // Ghi token company vào key của CRM rồi điều hướng full-reload sang CRM.
      // login-as chỉ cấp access token (4h, không refresh) nên xóa refresh cũ.
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.removeItem(REFRESH_KEY)
    },
  })
}

// ── Branding toàn hệ thống ────────────────────────────────────────
export interface BrandingMeta {
  brandName: string | null
  tagline?: string | null
  logoUrl?: string | null
  primaryColor?: string | null
  logoVersion: string | null
  faviconVersion: string | null
}

export function usePlatformBranding() {
  return useQuery<BrandingMeta>({
    queryKey: ['platform', 'branding'],
    queryFn: async () => {
      const { data } = await platformApi.get('/platform/branding')
      return data
    },
  })
}

export function useUpdateBrandName() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { brandName: string; tagline?: string; primaryColor?: string }) => {
      const res = await platformApi.put('/platform/branding', body)
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'branding'] }),
  })
}

export function useUploadBrandingImage(kind: 'logo' | 'favicon') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (dataUrl: string) => {
      const res = await platformApi.put(`/platform/branding/${kind}`, { dataUrl })
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'branding'] }),
  })
}

export function useClearBrandingImage(kind: 'logo' | 'favicon') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await platformApi.delete(`/platform/branding/${kind}`)
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'branding'] }),
  })
}
