/**
 * use-crm-products.ts — Sản phẩm đọc THẲNG từ CRM (không lưu ở ChatMQL).
 * Backend: GET /crm-products/search, /crm-products/source (crm-products-routes.ts).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

/**
 * Cấu trúc dữ liệu sản phẩm CHUẨN (khớp `CrmProduct` ở backend).
 * `code` là khoá nghiệp vụ — tài liệu bán hàng gắn vào sản phẩm theo mã này.
 */
export interface CrmProduct {
  id: string | number | null
  code: string | null
  name: string
  price: number | null
  priceMax: number | null
  currency: string
  unit: string | null
  vatNote: string | null
  inventory: number | null
  weight: number | null
  warehouseId: number | null
  warehouseName: string | null
  categoryId: string | number | null
  categoryName: string | null
  brand: string | null
  status: string | null
  /** Ảnh đại diện để dựng thẻ sản phẩm; thiếu thì vẽ ô trống. */
  imageUrl: string | null
  /** Mã bên Zalo Mini App, dùng dựng link gửi khách. */
  miniAppId: string | null
  /** Bản ghi gốc CRM — dùng khi cần cột chưa được chuẩn hoá. */
  raw: Record<string, unknown>
}

export interface CrmProductListParams {
  q?: string
  warehouseId?: number
  category?: string
  page?: number
  pageSize?: number
}

export interface CrmProductListResult {
  source: CrmProductSource
  products: CrmProduct[]
  categories: string[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
}

export type CrmProductSource = 'official' | 'bridge' | 'dashboard' | 'local'

export const SOURCE_LABELS: Record<CrmProductSource, string> = {
  official: 'Hệ thống sản phẩm chính thức TDVN',
  bridge: 'Cầu nối ChatMQL ↔ CRM (service key)',
  dashboard: 'API dashboard CRM (Bearer token)',
  local: 'Bảng sản phẩm nội bộ (tạm, chờ API chính thức)',
}

/** Một mục trong danh mục sản phẩm bên Zalo Mini App. */
export interface MiniAppItem {
  id: string
  name: string
  price: number
  active: boolean
}

/** Danh mục Mini App để chọn khi ghép — khỏi gõ tay chuỗi mã dễ sai. */
export function useMiniAppCatalog() {
  return useQuery<{ items: MiniAppItem[]; updatedAt: string | null }>({
    queryKey: ['crm-products', 'miniapp-catalog'],
    queryFn: async () => (await api.get('/crm-products/miniapp-catalog')).data,
    staleTime: 10 * 60_000,
  })
}

/** Ghép theo MÃ sản phẩm — ánh xạ sống độc lập với nguồn đang bật. */
export function useSetMiniAppId() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ code, miniAppId }: { code: string; miniAppId: string | null }) =>
      (await api.patch(`/crm-products/${encodeURIComponent(code)}/miniapp`, { miniAppId })).data,
    // Danh sách sản phẩm phải tải lại để cột mã và nút Gửi cập nhật theo.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-products'] }),
  })
}

export interface NguonInfo {
  source: CrmProductSource
  /** Nguồn quản trị đã chọn; null = đang theo cấu hình máy chủ. */
  chosenSource: CrmProductSource | null
  envSource: CrmProductSource
  sources: CrmProductSource[]
  dashboardConfigured: boolean
  officialConfigured: boolean
  /** Mẫu link Mini App, chứa {miniapp}/{code}/{id}. Rỗng = chưa cấu hình. */
  miniAppUrlTemplate: string
  canEdit: boolean
}

/** Đổi nguồn sản phẩm. `null` = bỏ lựa chọn, quay về cấu hình máy chủ. */
export function useSetProductSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (source: CrmProductSource | null) =>
      (await api.put('/crm-products/source', { source })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-products'] }),
  })
}

export function useCrmProductSource() {
  return useQuery<NguonInfo>({
    queryKey: ['crm-products', 'source'],
    queryFn: async () => (await api.get('/crm-products/source')).data,
    staleTime: 5 * 60_000,
  })
}

/** Danh sách sản phẩm để duyệt — không cần gõ từ khoá. */
export function useCrmProductList(params: CrmProductListParams) {
  const query: Record<string, unknown> = {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 50,
  }
  if (params.q?.trim()) query.q = params.q.trim()
  if (params.warehouseId != null) query.warehouseId = params.warehouseId
  if (params.category) query.category = params.category

  return useQuery<CrmProductListResult>({
    queryKey: ['crm-products', 'list', query],
    // Giá và tồn kho đổi liên tục bên hệ thống nguồn — cache ngắn.
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async () => (await api.get('/crm-products', { params: query })).data,
  })
}

/** Tìm sản phẩm trên CRM. `enabled=false` khi ô tìm còn trống. */
export function useCrmProductSearch(q: string, limit = 20) {
  const term = q.trim()
  return useQuery<{ source: CrmProductSource; products: CrmProduct[] }>({
    queryKey: ['crm-products', 'search', term, limit],
    enabled: term.length > 0,
    // Giá và tồn kho đổi liên tục bên CRM — giữ cache ngắn thôi.
    staleTime: 30_000,
    queryFn: async () =>
      (await api.get('/crm-products/search', { params: { q: term, limit } })).data,
  })
}
