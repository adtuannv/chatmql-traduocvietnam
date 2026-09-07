import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { FEATURES } from '@/lib/features'

// ─────────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ─────────────────────────────────────────────────────────────────────────────

/** Mã nền tảng (khớp backend `shared/constants.ts`). */
export const PLATFORM = {
  ZALO_OA: 1,
  ZALO_USER: 2,
  FACEBOOK_PAGE: 10,
} as const

/** Trạng thái sống của một kênh (liveStatus từ backend). */
export type ChannelStatus =
  | 'connected'
  | 'connecting'
  | 'qr_pending'
  | 'webhook_pending'
  | 'token_expired'
  | 'disconnected'
  | (string & {})

export interface ChannelOwner {
  id: string
  fullName: string
  email: string
}

/** Bản ghi tài khoản kênh trả về từ `/zalo-accounts`. */
export interface ChannelAccount {
  id: string
  platform: number
  externalUid: string | null
  externalPageId: string | null
  displayName: string | null
  avatarUrl: string | null
  phone: string | null
  status: ChannelStatus | null
  isDisabled: boolean
  lastConnectedAt: string | null
  createdAt: string
  owner: ChannelOwner | null
  liveStatus: ChannelStatus
}

export interface PancakePage {
  id: string
  name: string
  platform: string
  platformLabel: string
  shopId: string | null
  isActive: boolean
  isConnected: boolean
  hasToken: boolean
  activeUsers: number
}

export interface PancakeAccount {
  id: string
  displayName: string | null
  platform: number
  platformLabel: string
  externalPageId: string | null
  status: ChannelStatus | null
  lastConnectedAt: string | null
  createdAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Zalo — tài khoản (cá nhân + OA dùng chung endpoint, lọc theo ?type)
// ─────────────────────────────────────────────────────────────────────────────

export const zaloAccountsKey = (type?: 'personal' | 'oa', connectedOnly?: boolean) =>
  ['integrations', 'zalo-accounts', type ?? 'all', connectedOnly ? 'connected' : 'all-status'] as const

/**
 * Danh sách tài khoản kênh.
 * - `type='personal'` → Zalo cá nhân (platform 2)
 * - `type='oa'`       → Zalo OA (platform 1)
 * - bỏ trống          → tất cả kênh (dùng để lọc Facebook phía client)
 */
export function useZaloAccounts(type?: 'personal' | 'oa', connectedOnly = false) {
  return useQuery<ChannelAccount[]>({
    queryKey: zaloAccountsKey(type, connectedOnly),
    queryFn: async () => {
      const { data } = await api.get<ChannelAccount[]>('/zalo-accounts', {
        params: type ? { type } : {},
      })
      // Chỉ tài khoản đã kết nối thật. Trang Tích hợp KHÔNG bật cờ này vì ở đó
      // cần thấy cả bản nháp `qr_pending` để quét QR tiếp. Backend TDVN không
      // đọc `?connected=` nên lọc ở client.
      return connectedOnly
        ? data.filter((a) => !a.isDisabled && (a.liveStatus ?? a.status) === 'connected')
        : data
    },
  })
}

/** Bắt đầu kết nối Zalo cá nhân qua QR (tạo account tạm + phát sự kiện `zalo:qr`). */
export function useConnectZalo() {
  const qc = useQueryClient()
  return useMutation<{ accountId: string; message: string }, unknown, { phone?: string } | void>({
    mutationFn: async (body) => {
      const { data } = await api.post<{ accountId: string; message: string }>(
        '/zalo-accounts/connect',
        body ?? {},
      )
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'zalo-accounts'] }),
  })
}

/** Đăng nhập lại bằng QR cho một account đã tồn tại. */
export function useZaloLogin() {
  return useMutation<{ accountId: string; message: string }, unknown, string>({
    mutationFn: async (id) => {
      const { data } = await api.post<{ accountId: string; message: string }>(
        `/zalo-accounts/${id}/login`,
      )
      return data
    },
  })
}

/** Kết nối lại bằng phiên đã lưu (không cần quét QR). */
export function useZaloReconnect() {
  const qc = useQueryClient()
  return useMutation<{ accountId: string; message: string }, unknown, string>({
    mutationFn: async (id) => {
      const { data } = await api.post<{ accountId: string; message: string }>(
        `/zalo-accounts/${id}/reconnect`,
      )
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'zalo-accounts'] }),
  })
}

/** Ngắt kết nối / xóa mềm một tài khoản kênh. */
export function useDeleteZaloAccount() {
  const qc = useQueryClient()
  return useMutation<void, unknown, string>({
    mutationFn: async (id) => {
      await api.delete(`/zalo-accounts/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'zalo-accounts'] }),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth (Zalo OA + Facebook Page) — lấy URL rồi redirect
// ─────────────────────────────────────────────────────────────────────────────

/** Lấy URL uỷ quyền OAuth (backend trả `{ url }`). */
async function fetchOAuthUrl(path: string): Promise<string> {
  const { data } = await api.get<{ url: string }>(path)
  return data.url
}

/** Bắt đầu kết nối Zalo OA (redirect sang trang uỷ quyền). */
export function useConnectZaloOa() {
  return useMutation<string, unknown, void>({
    mutationFn: () => fetchOAuthUrl('/zalo-oa/connect/start'),
  })
}

/** Bắt đầu kết nối Facebook Page (redirect sang hộp thoại đăng nhập Facebook). */
export function useConnectFacebookPage() {
  return useMutation<string, unknown, void>({
    mutationFn: () => fetchOAuthUrl('/facebook-page/connect/start'),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Pancake
// ─────────────────────────────────────────────────────────────────────────────

export function usePancakeConfig() {
  return useQuery<{ hasToken: boolean }>({
    queryKey: ['integrations', 'pancake', 'config'],
    queryFn: async () => {
      const { data } = await api.get<{ hasToken: boolean }>('/pancake/config')
      return data
    },
  })
}

/** Lưu user access token của Pancake (backend tự xác thực bằng cách gọi listPages). */
export function useSavePancakeToken() {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean }, unknown, string>({
    mutationFn: async (userAccessToken) => {
      const { data } = await api.post<{ ok: boolean }>('/pancake/config', { userAccessToken })
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'pancake'] }),
  })
}

/** Danh sách page khả dụng từ Pancake (chỉ gọi khi đã có token). */
export function usePancakePages(enabled: boolean) {
  return useQuery<PancakePage[]>({
    queryKey: ['integrations', 'pancake', 'pages'],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<{ pages: PancakePage[] }>('/pancake/pages')
      return data.pages
    },
  })
}

/** Các tài khoản Pancake đã kết nối. */
export function usePancakeConnected() {
  return useQuery<PancakeAccount[]>({
    queryKey: ['integrations', 'pancake', 'connected'],
    queryFn: async () => {
      const { data } = await api.get<{ accounts: PancakeAccount[] }>('/pancake/connected')
      return data.accounts
    },
  })
}

export function useConnectPancakePage() {
  const qc = useQueryClient()
  return useMutation<
    { ok: boolean; channelAccountId: string },
    unknown,
    { pageId: string; pageName: string; platform: string }
  >({
    mutationFn: async (body) => {
      const { data } = await api.post<{ ok: boolean; channelAccountId: string }>(
        '/pancake/connect',
        body,
      )
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'pancake'] }),
  })
}

export function useDisconnectPancakePage() {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean }, unknown, string>({
    mutationFn: async (id) => {
      const { data } = await api.delete<{ ok: boolean }>(`/pancake/disconnect/${id}`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'pancake'] }),
  })
}

export function useSyncPancakePage() {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean; message: string }, unknown, string>({
    mutationFn: async (id) => {
      const { data } = await api.post<{ ok: boolean; message: string }>(`/pancake/sync/${id}`, {
        direction: 'pull',
      })
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'pancake'] }),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiện ích hiển thị
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusMeta {
  label: string
  variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
}

/** Ánh xạ trạng thái kênh → nhãn tiếng Việt + variant Badge. */
export function statusMeta(status: ChannelStatus | null | undefined, disabled = false): StatusMeta {
  if (disabled) return { label: 'Đã tắt', variant: 'secondary' }
  switch (status) {
    case 'connected':
      return { label: 'Đã kết nối', variant: 'success' }
    case 'connecting':
      return { label: 'Đang kết nối', variant: 'warning' }
    case 'qr_pending':
      return { label: 'Chờ quét QR', variant: 'warning' }
    case 'webhook_pending':
      return { label: 'Chờ webhook', variant: 'warning' }
    case 'token_expired':
      return { label: 'Token hết hạn', variant: 'destructive' }
    default:
      return { label: 'Chưa kết nối', variant: 'secondary' }
  }
}

/** Trạng thái cấu hình Zalo OA — cho biết thiếu biến môi trường nào. */
export interface OaConfigStatus {
  configured: boolean
  missing: string[]
  redirectUri: string
  webhookUrl: string
  webhookStrict: boolean
}

/** Backend TDVN không có /config-status → coi như đã cấu hình (không hiện bảng hướng dẫn). */
const OA_CONFIGURED: OaConfigStatus = {
  configured: true, missing: [], redirectUri: '', webhookUrl: '', webhookStrict: true,
}

export function useZaloOaConfig() {
  return useQuery<OaConfigStatus>({
    queryKey: ['integrations', 'zalo-oa', 'config'],
    enabled: FEATURES.CHANNEL_CONFIG_STATUS,
    initialData: FEATURES.CHANNEL_CONFIG_STATUS ? undefined : OA_CONFIGURED,
    queryFn: async () => {
      const { data } = await api.get<OaConfigStatus>('/zalo-oa/config-status')
      return data
    },
  })
}

/** Trạng thái cấu hình Facebook Page. */
export interface FbConfigStatus {
  configured: boolean
  missing: string[]
  redirectUri: string
  webhookUrl: string
  graphVersion: string
  scopes: string[]
  webhookFields: string[]
  /** Chuỗi gợi ý cho verify token — chỉ có khi chưa cấu hình. */
  suggestedVerifyToken: string | null
}

const FB_CONFIGURED: FbConfigStatus = {
  configured: true, missing: [], redirectUri: '', webhookUrl: '', graphVersion: '',
  scopes: [], webhookFields: [], suggestedVerifyToken: null,
}

export function useFacebookConfig() {
  return useQuery<FbConfigStatus>({
    queryKey: ['integrations', 'facebook-page', 'config'],
    enabled: FEATURES.CHANNEL_CONFIG_STATUS,
    initialData: FEATURES.CHANNEL_CONFIG_STATUS ? undefined : FB_CONFIGURED,
    queryFn: async () => {
      const { data } = await api.get<FbConfigStatus>('/facebook-page/config-status')
      return data
    },
  })
}

// ── Kho lưu trữ module ──────────────────────────────────────────────

export interface AppModule {
  key: string
  label: string
  archived: boolean
  reason?: string
  archivedAt?: string
  dataNote?: string
}

/**
 * Danh sách module và trạng thái lưu trữ. Nguồn là
 * `bizcrm_backend_source (backend TDVN không có module-registry; xem use-integrations.ts)` — sửa ở đó, không
 * hardcode danh sách ở frontend, tránh hai đầu lệch nhau.
 */
export function useAppModules() {
  return useQuery<AppModule[]>({
    queryKey: ['app-modules'],
    // Chỉ đổi khi deploy lại backend nên không cần hỏi lại liên tục.
    staleTime: 10 * 60_000,
    // Backend TDVN không có /modules → danh sách rỗng = mọi module đều BẬT.
    enabled: FEATURES.MODULES_API,
    initialData: FEATURES.MODULES_API ? undefined : [],
    queryFn: async () => {
      const { data } = await api.get<{ modules: AppModule[] }>('/modules')
      return data.modules
    },
  })
}

/** Module có đang bật không. Chưa tải xong hoặc khoá lạ → coi như BẬT. */
export function useModuleEnabled(key: string): boolean {
  const { data } = useAppModules()
  const m = data?.find((x) => x.key === key)
  return !(m?.archived ?? false)
}

// ── Widget Live Chat cho website ────────────────────────────────────

export interface WebsiteWidget {
  id: string
  name: string
  siteKey: string
  domains: string[]
  isActive: boolean
  /** Tên thương hiệu khách nhìn thấy trong cửa sổ chat (khác `name` — dùng nội bộ). */
  displayName: string | null
  /** Logo hiện trên nút chat và đầu cửa sổ. */
  logoUrl: string | null
  title: string
  greeting: string
  primaryColor: string
  position: string
  liveChatEnabled: boolean
  zaloUrl: string | null
  facebookUrl: string | null
  phoneNumber: string | null
  conversationCount?: number
}

export function useWidgets() {
  return useQuery<WebsiteWidget[]>({
    queryKey: ['widgets'],
    enabled: FEATURES.WEBSITE_WIDGETS,
    queryFn: async () => {
      const { data } = await api.get<{ widgets: WebsiteWidget[] }>('/widgets')
      return data.widgets
    },
  })
}

export function useCreateWidget() {
  const qc = useQueryClient()
  return useMutation<WebsiteWidget, unknown, { name: string; domains?: string[] }>({
    mutationFn: async (body) => (await api.post('/widgets', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['widgets'] }),
  })
}

export function useUpdateWidget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: Partial<WebsiteWidget> & { id: string }) => {
      await api.put(`/widgets/${id}`, body)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['widgets'] }),
  })
}

export function useDeleteWidget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/widgets/${id}`) },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['widgets'] }),
  })
}
