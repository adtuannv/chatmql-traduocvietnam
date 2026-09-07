import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { FEATURES } from '@/lib/features'
import type { Role } from '@/types/api'

// ── Kiểu dữ liệu ────────────────────────────────────────────────────

/** Bản đồ key-value cấu hình tổ chức (AppSetting). */
export interface SettingsMap {
  settings: Record<string, string | null>
}

export type MemberStatus = 'active' | 'inactive'

export interface TeamMember {
  id: string
  fullName: string
  email: string
  role: Role
  avatarUrl: string | null
  status: MemberStatus
  createdAt: string
  managerIds: string[]
  subordinateIds: string[]
  /** Vai trò động đang gán (null = còn dùng vai trò cố định ở `role`). */
  roleId?: string | null
  roleName?: string | null
  /** Tài khoản giao tiếp nhân viên này phụ trách (sở hữu + được cấp quyền, đã gộp). */
  accounts: { id: string; displayName: string | null; platform: number; status: string }[]
}

export interface TagDef {
  id: string
  name: string
  color: string
}

export interface Integration {
  id: string
  type: string
  name: string
  config: Record<string, unknown>
  enabled: boolean
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Profile {
  id: string
  fullName: string
  email: string
  role: Role
  avatarUrl: string | null
  createdAt: string
}

// ── App settings (Thông tin công ty) ────────────────────────────────

export function useSettings() {
  return useQuery<SettingsMap>({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data } = await api.get<SettingsMap>('/settings')
      return data
    },
  })
}

/** Lưu 1 hoặc nhiều cặp key-value (gọi tuần tự PUT /settings). */
export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (entries: { key: string; value: string }[]) => {
      for (const e of entries) {
        await api.put('/settings', e)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

// ── Nhân sự (team) ──────────────────────────────────────────────────

/**
 * Danh bạ nội bộ để @mention — endpoint riêng cho MỌI thành viên tổ chức
 * (useTeam gọi /settings/team bị 403 với member thường).
 */
export function useOrgMembers(enabled = true) {
  return useQuery<{ id: string; fullName: string | null; avatarUrl: string | null }[]>({
    queryKey: ['org-members'],
    // Backend TDVN không có /me/org-members (đi cùng tin nội bộ) → không gọi.
    enabled: enabled && FEATURES.CHAT_INTERNAL_NOTES,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.get<{ members: { id: string; fullName: string | null; avatarUrl: string | null }[] }>('/me/org-members')
      return data.members
    },
  })
}

export function useTeam(enabled = true) {
  return useQuery<TeamMember[]>({
    queryKey: ['settings', 'team'],
    // Member bị backend trả 403 → chỉ gọi khi người dùng thực sự có quyền xem.
    enabled,
    queryFn: async () => {
      // Backend TDVN: /settings/team KHÔNG trả `accounts` (tài khoản phụ trách);
      // dữ liệu đó nằm ở /settings/team/tree → gộp lại để cột "Tài khoản phụ
      // trách" và popup giao tài khoản vẫn chạy. Tree lỗi thì để rỗng, không chặn.
      const [{ data }, tree] = await Promise.all([
        api.get<{ members: TeamMember[] }>('/settings/team'),
        api
          .get<{ tree: OrgNode[]; unassigned: OrgNode[] }>('/settings/team/tree')
          .then((r) => r.data)
          .catch(() => null),
      ])
      const accountsByUser = new Map<string, TeamMember['accounts']>()
      const walk = (nodes: OrgNode[] | undefined) => {
        for (const n of nodes ?? []) {
          accountsByUser.set(
            n.id,
            (n.accounts ?? []).map((a) => ({
              id: a.id, displayName: a.displayName, platform: a.platform, status: a.status,
            })),
          )
          walk(n.subordinates)
        }
      }
      walk(tree?.tree)
      walk(tree?.unassigned)
      return data.members.map((m) => ({
        ...m,
        accounts: m.accounts ?? accountsByUser.get(m.id) ?? [],
      }))
    },
  })
}

export interface InviteMemberInput {
  email: string
  fullName?: string
  role?: Role
  password?: string
}

export interface InviteMemberResult {
  id: string
  fullName: string
  email: string
  role: Role
  status: MemberStatus
  createdAt: string
  /** Chỉ trả về khi admin không tự nhập mật khẩu. */
  generatedPassword?: string
}

export function useInviteMember() {
  const qc = useQueryClient()
  return useMutation<InviteMemberResult, unknown, InviteMemberInput>({
    mutationFn: async (input) => {
      const { data } = await api.post<InviteMemberResult>('/settings/team/invite', input)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'team'] }),
  })
}

export interface UpdateMemberInput {
  id: string
  fullName?: string
  role?: Role
  password?: string
  isActive?: boolean
  /** Vai trò động: id vai trò trong tổ chức, hoặc null để gỡ về vai trò cố định. */
  roleId?: string | null
}

export function useUpdateMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateMemberInput) => {
      const { data } = await api.patch(`/settings/team/${id}`, body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'team'] }),
  })
}

export function useDeleteMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/settings/team/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'team'] }),
  })
}

// ── Quyền hiệu lực của chính mình (ẩn/hiện hành động trên UI) ───────
export function useMyPermissions() {
  return useQuery<Set<string>>({
    queryKey: ['me', 'permissions'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await api.get<{ keys: string[] }>('/me/permissions')
      return new Set(data.keys ?? [])
    },
  })
}

// ── Nhãn (tags) ─────────────────────────────────────────────────────

export function useTags() {
  return useQuery<TagDef[]>({
    queryKey: ['tags'],
    queryFn: async () => {
      const { data } = await api.get<{ tags: TagDef[] }>('/tags')
      return data.tags
    },
  })
}

export function useCreateTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; color: string }) => {
      const { data } = await api.post<TagDef>('/tags', input)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  })
}

export function useUpdateTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; name?: string; color?: string }) => {
      const { data } = await api.put<TagDef>(`/tags/${id}`, body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  })
}

export function useDeleteTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/tags/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  })
}

// ── Tích hợp (chỉ xem) ──────────────────────────────────────────────

export function useIntegrations() {
  return useQuery<Integration[]>({
    queryKey: ['integrations'],
    queryFn: async () => {
      const { data } = await api.get<{ integrations: Integration[] }>('/integrations')
      return data.integrations
    },
  })
}

// ── Hồ sơ cá nhân ───────────────────────────────────────────────────

export function useProfile() {
  return useQuery<Profile>({
    queryKey: ['profile'],
    queryFn: async () => {
      const { data } = await api.get<Profile>('/profile')
      return data
    },
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { fullName?: string; avatarUrl?: string | null }) => {
      const { data } = await api.patch<Profile>('/profile', body)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] })
    },
  })
}

export function useUploadAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<Profile>('/profile/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  })
}

export function useDeleteAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.delete<Profile>('/profile/avatar')
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  })
}

// ── Mật khẩu & Bảo mật ──────────────────────────────────────────────

export function useChangePassword() {
  return useMutation({
    mutationFn: async (body: { currentPassword: string; newPassword: string }) => {
      const { data } = await api.post('/auth/change-password', body)
      return data
    },
  })
}

export interface ApiKeyItem {
  id: string
  name: string
  prefix?: string | null
  lastUsedAt?: string | null
  createdAt: string
}

export function useApiKeys() {
  return useQuery<ApiKeyItem[]>({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const { data } = await api.get<{ items: ApiKeyItem[] }>('/api-keys')
      return data.items
    },
  })
}

export function useCreateApiKey() {
  const qc = useQueryClient()
  return useMutation<{ apiKey: string; key: ApiKeyItem }, unknown, { name: string }>({
    mutationFn: async (body) => {
      const { data } = await api.post('/api-keys', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  })
}

export function useDeleteApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api-keys/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  })
}

// ── Thông báo ───────────────────────────────────────────────────────

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  link?: string | null
  isRead: boolean
  createdAt: string
}

export function useNotifications(limit = 30) {
  return useQuery<{ notifications: NotificationItem[]; unreadCount: number }>({
    queryKey: ['notifications', limit],
    queryFn: async () => {
      const { data } = await api.get('/notifications', { params: { limit } })
      return data
    },
  })
}

/** Đánh dấu MỘT thông báo đã đọc (PATCH /notifications/:id/read). */
export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/notifications/${id}/read`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.post('/notifications/read-all')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

// ── Sơ đồ tổ chức ───────────────────────────────────────────────────

export interface OrgAccount {
  id: string
  displayName: string
  platform: number
  status: string
  avatarUrl?: string | null
}

export interface OrgNode {
  id: string
  fullName: string
  email: string
  role: Role
  avatarUrl?: string | null
  isActive: boolean
  /** Tài khoản Zalo sở hữu + được cấp quyền, đã gộp trùng ở backend. */
  accounts: OrgAccount[]
  managerIds: string[]
  subordinateIds: string[]
  subordinates?: OrgNode[]
}

export function useOrgTree(enabled = true) {
  return useQuery<{ tree: OrgNode[]; unassigned: OrgNode[] }>({
    queryKey: ['settings', 'team', 'tree'],
    enabled,
    queryFn: async () => {
      const { data } = await api.get('/settings/team/tree')
      return data
    },
  })
}

/** Gán cấp trên cho một nhân viên (mảng rỗng = gỡ khỏi mọi quản lý). */
export function useSetManagers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { userId: string; managerIds: string[] }) => {
      const { data } = await api.post(`/settings/team/${vars.userId}/managers`, {
        managerIds: vars.managerIds,
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'team'] })
    },
  })
}

// ── Phân quyền tài khoản Zalo ───────────────────────────────────────

export interface ZaloAccessRow {
  id: string
  channelAccountId: string
  userId: string
  permission: string
  user: { id: string; fullName: string; email: string }
}

export function useZaloAccess(accountId: string | undefined) {
  return useQuery<ZaloAccessRow[]>({
    queryKey: ['zalo-access', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data } = await api.get<ZaloAccessRow[]>(`/zalo-accounts/${accountId}/access`)
      return data
    },
  })
}

export function useGrantZaloAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { accountId: string; userId: string }) => {
      const { data } = await api.post(`/zalo-accounts/${vars.accountId}/access`, {
        userId: vars.userId,
      })
      return data
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['zalo-access', vars.accountId] })
      // Bắt buộc: `/settings/team` trả kèm `accounts` của từng nhân viên. Thiếu
      // dòng này thì popup "Tài khoản phụ trách" tick xong không đổi trạng thái.
      qc.invalidateQueries({ queryKey: ['settings', 'team'] })
    },
  })
}

export function useRevokeZaloAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { accountId: string; userId: string }) => {
      // Backend nhận userId qua PATH, không phải body: /access/:userId
      await api.delete(`/zalo-accounts/${vars.accountId}/access/${vars.userId}`)
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['zalo-access', vars.accountId] })
      // Bắt buộc: `/settings/team` trả kèm `accounts` của từng nhân viên. Thiếu
      // dòng này thì popup "Tài khoản phụ trách" tick xong không đổi trạng thái.
      qc.invalidateQueries({ queryKey: ['settings', 'team'] })
    },
  })
}

// ── RBAC: vai trò & danh mục quyền (giai đoạn 1 — chỉ đọc) ──────────

export interface RoleSummary {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  systemKey: string | null
  /** all | team | own — phạm vi dữ liệu gắn với vai trò. */
  dataScope: string
  userCount: number
  permissionCount: number
}

export function useRoles(enabled = true) {
  return useQuery<RoleSummary[]>({
    queryKey: ['roles'],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<{ roles: RoleSummary[] }>('/roles')
      return data.roles
    },
  })
}

export interface PermissionDef {
  key: string
  module: string
  action: string
  label: string
  group: string
}

export function usePermissionCatalog(enabled = true) {
  return useQuery<{ total: number; groups: { group: string; permissions: PermissionDef[] }[] }>({
    queryKey: ['permissions'],
    enabled,
    queryFn: async () => {
      const { data } = await api.get('/permissions')
      return data
    },
  })
}

/** Quyền đang bật của một vai trò — dùng để tick sẵn ma trận. */
export function useRolePermissions(roleId: string | undefined) {
  return useQuery<string[]>({
    queryKey: ['roles', roleId, 'permissions'],
    enabled: !!roleId,
    queryFn: async () => {
      const { data } = await api.get<{ keys: string[] }>(`/roles/${roleId}/permissions`)
      return data.keys
    },
  })
}

// ── RBAC: ghi (giai đoạn 3) ─────────────────────────────────────────

export interface RoleInput {
  name: string
  description?: string
  dataScope: string
  permissionKeys: string[]
}

export function useCreateRole() {
  const qc = useQueryClient()
  return useMutation<{ id: string }, unknown, RoleInput>({
    mutationFn: async (body) => {
      const { data } = await api.post('/roles', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })
}

export function useUpdateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; name?: string; description?: string; dataScope?: string }) => {
      const { id, ...body } = vars
      await api.put(`/roles/${id}`, body)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })
}

export function useSetRolePermissions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; permissionKeys: string[] }) => {
      await api.put(`/roles/${vars.id}/permissions`, { permissionKeys: vars.permissionKeys })
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      qc.invalidateQueries({ queryKey: ['roles', vars.id, 'permissions'] })
    },
  })
}

export function useDeleteRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/roles/${id}`) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })
}
