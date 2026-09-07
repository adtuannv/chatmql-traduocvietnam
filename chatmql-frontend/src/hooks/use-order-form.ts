/**
 * use-order-form.ts — Hook dữ liệu cho form "Tạo đơn" (TDVN).
 *
 * Mọi endpoint đi qua ChatMQL backend (`/api/v1/orders/*`), backend cầm
 * service key gọi sang CRM. Kiểu dữ liệu bám theo
 * bizcrm_backend_source/src/modules/orders/{order-routes,order-service,crm-order-client}.ts
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { ShippingProvider, TypeFeeDelivery } from '@/lib/order-calc'

// ── Kiểu dữ liệu tra cứu ─────────────────────────────────────────────

export interface OrderStatus {
  id: number
  label: string
  group_id: number | null
  group: string | null
}
export interface Warehouse { id: number; name: string }
export interface Province { id: number; name: string }
export interface Ward { id: number; name: string }

/** GET /orders/form-lookups */
export interface FormLookups {
  statuses: OrderStatus[]
  warehouses: Warehouse[]
  provinces: Province[]
}

/** GET /orders/catalog — sản phẩm thật từ FM. */
export interface CatalogProduct {
  id: number
  /** SKU / code_product. */
  code: string
  name: string
  price: number
  /** Khối lượng 1 đơn vị (gram). */
  weight: number | null
  inventory: number
  unit: string | null
  vat_note: string | null
  warehouse_id: number | null
  status: string | null
}

// ── Khách hàng & hội thoại ───────────────────────────────────────────

/** Hồ sơ CRM — trường tự do, chỉ khai báo những gì form dùng. */
export interface CrmCustomer {
  id_kh?: number
  full_name?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  gmv_total?: number | null
  order_count?: number | null
  staff_in_charge?: string | null
  thich_dung_hang?: string | null
  nhom_kh?: string | null
  priority_level?: string | null
  cap_vip?: string | null
  [key: string]: unknown
}

/** GET /orders/conversation-context?conversationId */
export interface ConversationContext {
  conversationId: string
  contact: {
    id: string | null
    name: string
    phone: string
    /** 'name' = số suy ra từ tên hội thoại — nhắc nhân viên kiểm lại. */
    phoneSource: 'contact' | 'name' | 'none'
    address: string
    city: string
  }
  crm: CrmCustomer | null
}

/** GET /orders/customer?phone */
export interface CustomerLookup {
  found: boolean
  customer: CrmCustomer | null
}

// ── Ưu đãi & điểm ────────────────────────────────────────────────────

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

/** GET /orders/promotions?phone */
export interface PromotionsResponse {
  promotions: Promotion[]
  customer: Record<string, unknown> | null
  total: number
}

/** POST /orders/promotions/apply */
export interface ApplyPromotionBody {
  code: string
  phone?: string
  /** Tiền hàng trước giảm, không gồm quà tặng. */
  orderSubtotal: number
}
export interface ApplyPromotionResult {
  valid: boolean
  promotion: Promotion
  discount_amount: number
  free_shipping: boolean
  message: string
}

/** GET /orders/customer-points?phone — sổ cái "Lá". */
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
  entries: Array<{
    at: string | null
    ref: string | null
    delta: number
    balance_after: number | null
    kind: 'earn' | 'spend'
    category: string
  }>
}

// ── Tạo đơn ──────────────────────────────────────────────────────────

export interface OrderItemInput {
  productId?: string | number
  productCode: string
  productName: string
  quantity: number
  unitPrice: number
  isGift?: boolean
}

/**
 * Body POST /orders/create — đúng `CreateOrderInput` của backend trừ các trường
 * backend tự điền (orgId, createdUserId, sellerUsername).
 */
export interface CreateOrderBody {
  requestId: string
  conversationId?: string
  contactId?: string
  /** Backend ưu tiên trường này, nếu bỏ trống sẽ lấy tên người đăng nhập từ JWT. */
  sellerName?: string
  customerName: string
  customerPhone: string
  shippingAddress: string
  city?: string
  items: OrderItemInput[]
  discountAmount?: number
  shippingFee?: number
  paymentMethod?: 'cod' | 'vietqr' | 'bank_transfer'
  shippingProvider?: ShippingProvider
  notes?: string
  // Đợt 1
  orderStatusId?: number
  warehouseId?: number
  provinceId?: number
  provinceName?: string
  wardId?: number
  wardName?: string
  addressDetail?: string
  // Đợt 3
  depositAmount?: number
  orderType?: string
  orderSource?: string
  selfShipping?: boolean
  isFragile?: boolean
  isExchange?: boolean
  typeFeeDelivery?: TypeFeeDelivery
}

export interface CreateOrderResult {
  success: boolean
  /** 'partial' (HTTP 207) = đã vào CRM, FM sẽ được đẩy lại sau. */
  status: 'ok' | 'partial'
  message: string
  order_code: string
  request_id: string
  subtotal: number
  discount_amount: number
  shipping_fee: number
  total_amount: number
  payment_method: string
  vietqr_url: string | null
  crm_saved: boolean
  fm_saved: boolean
  fm_error: string | null
  /** true khi request_id đã xử lý trước đó — trả lại đơn cũ. */
  replayed: boolean
  contactUpdated: boolean
  chatMessageCreated: boolean
}

// ── Nhãn ─────────────────────────────────────────────────────────────

export const ORDER_SOURCE_OPTIONS = ['Zalo', 'Facebook', 'Website', 'Hotline', 'Khác'] as const
export const ORDER_TYPE_OPTIONS = ['Bán lẻ', 'Bán buôn', 'Đơn mẫu'] as const

// ── Hooks ────────────────────────────────────────────────────────────

const LOOKUP_STALE = 10 * 60_000
const LOOKUP_GC = 30 * 60_000

/** Trạng thái đơn, kho, tỉnh/thành — gần như không đổi trong phiên làm việc. */
export function useFormLookups() {
  return useQuery({
    queryKey: ['order-lookups', 'form'],
    queryFn: async () => (await api.get<FormLookups>('/orders/form-lookups')).data,
    staleTime: LOOKUP_STALE,
    gcTime: LOOKUP_GC,
  })
}

/** Phường/xã theo tỉnh đã chọn. */
export function useWards(provinceId: number | null | undefined) {
  return useQuery({
    queryKey: ['order-lookups', 'wards', provinceId ?? null],
    queryFn: async () =>
      (await api.get<{ wards: Ward[] }>('/orders/wards', { params: { provinceId } })).data.wards ?? [],
    enabled: !!provinceId,
    staleTime: LOOKUP_STALE,
    gcTime: LOOKUP_GC,
  })
}

/** Danh mục sản phẩm theo kho (tồn kho khác nhau theo từng kho). Không có kho → toàn bộ. */
export function useCatalog(warehouseId: number | null | undefined) {
  return useQuery({
    queryKey: ['order-lookups', 'catalog', warehouseId ?? 'all'],
    queryFn: async () =>
      (
        await api.get<{ products: CatalogProduct[] }>('/orders/catalog', {
          params: warehouseId ? { warehouseId } : undefined,
        })
      ).data.products ?? [],
    staleTime: 5 * 60_000,
    gcTime: LOOKUP_GC,
  })
}

/** Ngữ cảnh khách của hội thoại: tên, SĐT, địa chỉ + hồ sơ CRM (nếu có). */
export function useConversationContext(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: ['orders', 'conversation-context', conversationId ?? null],
    queryFn: async () =>
      (await api.get<ConversationContext>('/orders/conversation-context', { params: { conversationId } })).data,
    enabled: !!conversationId,
  })
}

/** Hồ sơ CRM theo SĐT — tra khi nhân viên gõ số. */
export function useCrmCustomer(phone: string | null | undefined) {
  const p = (phone ?? '').trim()
  return useQuery({
    queryKey: ['orders', 'customer', p],
    queryFn: async () => (await api.get<CustomerLookup>('/orders/customer', { params: { phone: p } })).data,
    enabled: !!p,
    retry: 0,
  })
}

/** Ưu đãi đang chạy — gắn riêng khách + toàn hệ thống. */
export function usePromotions(phone: string | null | undefined) {
  const p = (phone ?? '').trim()
  return useQuery({
    queryKey: ['orders', 'promotions', p],
    queryFn: async () =>
      (await api.get<PromotionsResponse>('/orders/promotions', { params: p ? { phone: p } : undefined })).data,
    staleTime: 60_000,
    retry: 0,
  })
}

/** Kiểm tra mã và tính tiền giảm — không ghi gì. */
export function useApplyPromotion() {
  return useMutation({
    mutationFn: async (body: ApplyPromotionBody) =>
      (await api.post<ApplyPromotionResult>('/orders/promotions/apply', body)).data,
  })
}

/** Sổ cái tích điểm ("Lá") của khách. */
export function useCustomerPoints(phone: string | null | undefined) {
  const p = (phone ?? '').trim()
  return useQuery({
    queryKey: ['orders', 'customer-points', p],
    queryFn: async () => (await api.get<PointsLedger>('/orders/customer-points', { params: { phone: p } })).data,
    enabled: !!p,
    retry: 0,
  })
}

/** POST /orders/create — sau khi tạo, làm mới mọi query `['orders', …]` (lịch sử, ngữ cảnh, điểm…). */
export function useCreateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateOrderBody) =>
      (await api.post<CreateOrderResult>('/orders/create', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}
