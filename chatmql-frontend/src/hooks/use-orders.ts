/**
 * use-orders.ts — Hook gọi nhóm API /orders (proxy sang CRM Trà Dược).
 *
 * Trình duyệt KHÔNG gọi thẳng CRM: mọi thứ đi qua ChatMQL backend (service key
 * nằm ở đó). Kiểu dữ liệu bên dưới bám theo
 * bizcrm_backend_source/src/modules/orders/{order-routes,crm-order-client}.ts.
 *
 * Quy ước khoá query: ['orders', <tên>, <tham số>].
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { api } from '@/lib/api-client'
import { formatNumber } from '@/lib/utils'
import type { BadgeProps } from '@/components/ui/badge'

// ── Kiểu dữ liệu ─────────────────────────────────────────────────────

/** Hồ sơ khách trong CRM (đã được backend chuẩn hoá tên trường). */
export interface CrmCustomer {
  id_kh?: number | null
  customer_code?: string | null
  full_name?: string | null
  phone?: string | null
  phone2?: string | null
  staff_in_charge?: string | null
  gmv_total?: number | null
  gmv?: number | null
  aov?: number | null
  order_count?: number | null
  occupation?: string | null
  cap_vip?: string | null
  nhom_kh?: string | null
  priority_level?: string | null
  gender?: string | null
  birthday?: string | null
  referral_source?: string | null
  thich_dung_hang?: string | null
  nhu_cau_sd?: string | null
  purchase_frequency?: string | null
  address?: string | null
  address2?: string | null
  city?: string | null
  next_sales_at?: string | null
  next_care_at?: string | null
  appointment_type?: string | null
  profile_note?: string | null
  [key: string]: unknown
}

export interface CrmOrderItem {
  name: string
  quantity: number
  price?: number
  code?: string
  is_gift?: boolean
}

export interface CrmOrder {
  order_code: string
  status?: string | null
  created_at?: string | null
  total_amount?: number | null
  seller?: string | null
  items?: CrmOrderItem[]
  [key: string]: unknown
}

export interface ConversationContext {
  conversationId: string
  contact: {
    id: string | null
    name: string
    phone: string
    /** name = số rút từ tên hội thoại, nhân viên cần kiểm lại trước khi lên đơn. */
    phoneSource: 'contact' | 'name' | 'none'
    address: string
    city: string
  }
  crm: CrmCustomer | null
}

export interface CustomerProfileChatmql {
  id: string
  crmName: string | null
  zaloName: string | null
  email: string | null
  source: string | null
  leadScore: number
  lifecycleStage: string | null
  firstSeenAt: string
  address: string | null
}

export interface CustomerProfile {
  phone: string
  chatmql: CustomerProfileChatmql | null
  crm: CrmCustomer | null
  orders: CrmOrder[]
}

/**
 * Kết quả tra hồ sơ. 400 = khách chưa có số điện thoại — là tình trạng bình
 * thường với hàng nghìn contact Zalo, KHÔNG phải lỗi hệ thống, nên không ném
 * ra error mà trả về trạng thái riêng để giao diện hướng dẫn nhân viên.
 */
export type CustomerProfileState =
  | { status: 'ok'; profile: CustomerProfile }
  | { status: 'no_phone'; contact: { id: string; name: string | null } | null; message: string }

export interface PointsEntry {
  at: string | null
  ref: string | null
  delta: number
  balance_after: number | null
  kind: 'earn' | 'spend'
  category: string
}

export interface PointsLedger {
  phone: string
  balance: number
  total_earned: number
  total_spent: number
  entry_count: number
  rank: string | null
  rank_reward: string | null
  balance_mismatch: boolean
  computed_balance: number
  entries: PointsEntry[]
}

export interface Promotion {
  id: number
  code: string | null
  name: string
  description: string | null
  type: 'percent' | 'amount' | 'freeship' | 'gift'
  value: number
  max_discount: number | null
  min_order: number
  scope: 'system' | 'customer'
  conditions: Record<string, unknown>
  from: string | null
  to: string | null
  source: 'system' | 'customer'
  used: boolean
  eligible: boolean
  conditions_text: string[]
}

export interface PromotionsResponse {
  promotions: Promotion[]
  customer: Record<string, unknown> | null
  total: number
}

export interface BoughtProduct {
  code: string
  name: string | null
  price: number | null
  unit: string | null
  quantity: number
  order_count: number
  last_bought_at: string | null
  is_gift: boolean
  orders: Array<{ code: string; at: string | null; status: string | null }>
}

export interface CustomerProductsResponse {
  products: BoughtProduct[]
  total: number
  order_count: number
}

export type ActivityType = 'message' | 'note' | 'appointment' | 'event' | 'lifecycle' | 'order'

export interface ActivityItem {
  id: string
  type: ActivityType
  at: string
  title: string
  detail: string | null
  meta?: Record<string, unknown>
}

export interface ActivityResponse {
  items: ActivityItem[]
  total: number
  counts: Partial<Record<ActivityType, number>>
}

export interface ActivityParams {
  conversationId: string | undefined
  q?: string
  types?: ActivityType[]
  limit?: number
}

export type ConversationLibraryKind = 'media' | 'file' | 'link'

export interface ConversationLibraryItem {
  id: string
  kind: string
  at: string
  sender: string
  url: string | null
  title: string | null
  size: string | null
  host?: string
}

export interface ConversationLibraryResponse {
  groups: Array<{ date: string; items: ConversationLibraryItem[] }>
  total: number
  counts: { media: number; file: number; link: number }
}

export interface UpdateScheduleInput {
  phone: string
  /** ISO 8601. Chuỗi rỗng = xoá lịch. Bỏ trống = giữ nguyên. */
  nextSalesAt?: string
  nextCareAt?: string
  appointmentType?: string
  careNote?: string
}

export interface UpdateScheduleResult {
  success: boolean
  id_kh: number
  next_sales_at: string | null
  next_care_at: string | null
  appointment_type: string | null
}

export interface OrderSyncStatus {
  order_code: string
  request_id: string
  crm_saved: boolean
  fm_saved: boolean
  fm_attempts: number
  last_error: string | null
}

// ── Định dạng dùng chung cho cột phải / drawer / modal AI ────────────

/** `1.234.567 ₫` — null/undefined thành `0 ₫`. */
export function formatVnd(n: number | string | null | undefined): string {
  return `${formatNumber(Math.round(Number(n) || 0))} ₫`
}

/** dd/mm/yyyy theo vi-VN; sai định dạng trả về null. */
export function formatDateVi(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** dd/mm/yyyy HH:mm theo vi-VN. */
export function formatDateTimeVi(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** ISO → giá trị cho <input type="datetime-local"> theo giờ máy. */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Nhãn & helper nghiệp vụ ──────────────────────────────────────────

export const ACTIVITY_LABELS: Record<ActivityType, { label: string; icon: string }> = {
  message: { label: 'Tin nhắn', icon: '💬' },
  note: { label: 'Ghi chú', icon: '📝' },
  order: { label: 'Đơn hàng', icon: '🛍️' },
  appointment: { label: 'Lịch hẹn', icon: '📅' },
  event: { label: 'Sự kiện', icon: '⚡' },
  lifecycle: { label: 'Vòng đời', icon: '🔄' },
}

export const ACTIVITY_TYPES: ActivityType[] = ['message', 'note', 'order', 'appointment', 'event', 'lifecycle']

/** Đơn "Giao thành công" là mốc duy nhất được coi là xong. */
export function orderStatusVariant(status?: string | null): BadgeProps['variant'] {
  if (status === 'Giao thành công') return 'success'
  if (/hu[ỷy]|tr[ảa] h[àa]ng|ho[àa]n/i.test(status || '')) return 'destructive'
  return 'warning'
}

/** Cấp VIP theo GMV luỹ kế (triệu đồng) — trùng logic bridge & backend. */
export function getVipLevelFromGMV(gmv: number | null | undefined): string {
  const m = (Number(gmv) || 0) / 1_000_000
  if (m < 1) return 'VIP 0'
  if (m < 10) return `VIP ${Math.floor(m)}`
  if (m < 60) return `VIP ${Math.min(Math.floor((m - 10) / 5) + 10, 19)}`
  if (m < 160) return `VIP ${Math.min(Math.floor((m - 60) / 10) + 20, 29)}`
  return `VIP ${Math.min(Math.floor((m - 160) / 50) + 30, 39)}`
}

/** Hạng theo giá trị trung bình mỗi đơn. */
export function getAOVClass(aov: number | null | undefined): string {
  const v = Number(aov) || 0
  if (v < 500_000) return 'A'
  if (v < 1_000_000) return 'B'
  if (v < 2_000_000) return 'C'
  if (v <= 3_000_000) return 'D'
  return 'E'
}

/**
 * Cấp VIP hiển thị. CRM có sẵn `cap_vip` thì dùng, trừ khi đó là mã nội bộ
 * dạng FT1/KT2/NC3… (không phải cấp VIP) — lúc đó tự tính từ GMV + AOV.
 */
export function formatCombinedVip(crm?: CrmCustomer | null): string {
  if (!crm) return '—'
  if (crm.cap_vip && !/^(FT|KT|NC|PL|KD|KL)\d/i.test(crm.cap_vip)) return crm.cap_vip
  const gmv = Number(crm.gmv_total ?? crm.gmv) || 0
  const aov = Number(crm.aov) || (crm.order_count ? gmv / crm.order_count : gmv)
  return `${getVipLevelFromGMV(gmv)}${getAOVClass(aov)}`
}

// ── Khoá query ───────────────────────────────────────────────────────
export const orderKeys = {
  all: ['orders'] as const,
  context: (convId: string) => ['orders', 'conversation-context', convId] as const,
  profile: (convId: string) => ['orders', 'customer-profile', convId] as const,
  customer: (phone: string) => ['orders', 'customer', phone] as const,
  customerOrders: (phone: string) => ['orders', 'customer-orders', phone] as const,
  points: (phone: string) => ['orders', 'customer-points', phone] as const,
  products: (phone: string) => ['orders', 'customer-products', phone] as const,
  promotions: (phone: string) => ['orders', 'promotions', phone] as const,
  activity: (p: ActivityParams) => ['orders', 'customer-activity', p] as const,
  library: (convId: string, kind: ConversationLibraryKind) => ['orders', 'conversation-library', convId, kind] as const,
  orderStatus: (code: string) => ['orders', 'status', code] as const,
}

// ── Hooks đọc ────────────────────────────────────────────────────────

/** Khách của hội thoại đang mở — backend đối chiếu với org của nhân viên. */
export function useConversationContext(convId: string | undefined) {
  return useQuery<ConversationContext>({
    queryKey: orderKeys.context(convId ?? ''),
    enabled: !!convId,
    queryFn: async () =>
      (await api.get<ConversationContext>('/orders/conversation-context', { params: { conversationId: convId } })).data,
  })
}

/** Hồ sơ gộp ChatMQL + CRM + lịch sử đơn. 400 (chưa có SĐT) trả về trạng thái riêng. */
export function useCustomerProfile(convId: string | undefined) {
  return useQuery<CustomerProfileState>({
    queryKey: orderKeys.profile(convId ?? ''),
    enabled: !!convId,
    retry: false,
    queryFn: async () => {
      try {
        const { data } = await api.get<CustomerProfile>('/orders/customer-profile', {
          params: { conversationId: convId },
        })
        return { status: 'ok', profile: data }
      } catch (err) {
        const e = err as AxiosError<{ error?: string; contact?: { id: string; name: string | null } | null }>
        if (e.response?.status === 400) {
          return {
            status: 'no_phone',
            contact: e.response.data?.contact ?? null,
            message: e.response.data?.error || 'Khách chưa có số điện thoại',
          }
        }
        throw err
      }
    },
  })
}

export function useCrmCustomer(phone: string | undefined) {
  return useQuery<{ found: boolean; customer: CrmCustomer | null }>({
    queryKey: orderKeys.customer(phone ?? ''),
    enabled: !!phone,
    queryFn: async () => (await api.get('/orders/customer', { params: { phone } })).data,
  })
}

export function useCustomerOrders(phone: string | undefined) {
  return useQuery<{ orders: CrmOrder[] }>({
    queryKey: orderKeys.customerOrders(phone ?? ''),
    enabled: !!phone,
    queryFn: async () => (await api.get('/orders/customer-orders', { params: { phone } })).data,
  })
}

export function useCustomerPoints(phone: string | undefined) {
  return useQuery<PointsLedger>({
    queryKey: orderKeys.points(phone ?? ''),
    enabled: !!phone,
    queryFn: async () => (await api.get('/orders/customer-points', { params: { phone } })).data,
  })
}

export function useCustomerProducts(phone: string | undefined) {
  return useQuery<CustomerProductsResponse>({
    queryKey: orderKeys.products(phone ?? ''),
    enabled: !!phone,
    queryFn: async () => (await api.get('/orders/customer-products', { params: { phone } })).data,
  })
}

/** Ưu đãi đang chạy: gắn riêng khách (source=customer) + toàn hệ thống. */
export function useCustomerPromotions(phone: string | undefined) {
  return useQuery<PromotionsResponse>({
    queryKey: orderKeys.promotions(phone ?? ''),
    enabled: !!phone,
    queryFn: async () => (await api.get('/orders/promotions', { params: { phone } })).data,
  })
}

/** Dòng thời gian gom từ tin nhắn, ghi chú, lịch hẹn, sự kiện, vòng đời, đơn CRM. */
export function useCustomerActivity(params: ActivityParams) {
  return useQuery<ActivityResponse>({
    queryKey: orderKeys.activity(params),
    enabled: !!params.conversationId,
    queryFn: async () =>
      (await api.get('/orders/customer-activity', {
        params: {
          conversationId: params.conversationId,
          q: params.q?.trim() || undefined,
          types: params.types?.length ? params.types.join(',') : undefined,
          limit: params.limit,
        },
      })).data,
  })
}

/** Ảnh/video, tệp, link ĐÃ trao đổi trong hội thoại (khác kho tài liệu duyệt). */
export function useConversationLibrary(convId: string | undefined, kind: ConversationLibraryKind = 'media') {
  return useQuery<ConversationLibraryResponse>({
    queryKey: orderKeys.library(convId ?? '', kind),
    enabled: !!convId,
    queryFn: async () =>
      (await api.get('/orders/conversation-library', { params: { conversationId: convId, kind } })).data,
  })
}

export function useOrderStatus(orderCode: string | undefined) {
  return useQuery<OrderSyncStatus>({
    queryKey: orderKeys.orderStatus(orderCode ?? ''),
    enabled: !!orderCode,
    queryFn: async () => (await api.get(`/orders/${encodeURIComponent(orderCode ?? '')}/status`)).data,
  })
}

// ── Hooks ghi ────────────────────────────────────────────────────────

/** Đặt lịch bán hàng / chăm sóc kế tiếp — lưu vào CRM, dùng chung với đội CSKH. */
export function useUpdateCustomerSchedule() {
  const qc = useQueryClient()
  return useMutation<UpdateScheduleResult, unknown, UpdateScheduleInput>({
    mutationFn: async (input) => (await api.post<UpdateScheduleResult>('/orders/customer-schedule', input)).data,
    onSuccess: () => {
      // Hồ sơ (theo hội thoại) và hồ sơ CRM (theo SĐT) đều chứa lịch — làm mới cả hai.
      qc.invalidateQueries({ queryKey: ['orders', 'customer-profile'] })
      qc.invalidateQueries({ queryKey: ['orders', 'customer'] })
      qc.invalidateQueries({ queryKey: ['orders', 'conversation-context'] })
    },
  })
}
