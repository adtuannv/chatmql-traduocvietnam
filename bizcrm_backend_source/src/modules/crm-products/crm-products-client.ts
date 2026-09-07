/**
 * crm-products-client.ts — Đọc sản phẩm TRỰC TIẾP từ CRM (nguồn sự thật duy nhất).
 *
 * Khác với bảng `products` nội bộ (dùng cho RAG của AI), module này KHÔNG lưu
 * gì cả: mỗi lần tìm là một lần hỏi CRM, nên giá/tồn kho luôn đúng thời điểm.
 *
 * Hai đường lấy dữ liệu, chọn bằng biến môi trường:
 *   1. `bridge`   → /api/external/chatmql/products/catalog, xác thực bằng
 *                   service key X-ChatMQL-API-Key (KHÔNG hết hạn) — nên dùng.
 *   2. `dashboard`→ /api/dashboard/search-products, xác thực bằng Bearer JWT
 *                   của MỘT tài khoản CRM. Token này hết hạn theo phiên đăng
 *                   nhập nên chỉ hợp cho thử nghiệm, trừ khi CRM cấp token
 *                   dịch vụ dài hạn.
 *   3. `local`    → bảng `products` nội bộ — danh mục thật đã có sẵn trong hệ
 *                   thống, dùng khi CRM chưa mở API. Đây là NGUỒN TẠM: khi
 *                   TDVN cấp API chính thức thì đổi biến môi trường sang
 *                   bridge/dashboard, bảng nội bộ sẽ bỏ. Vì vậy dữ liệu vẫn đi
 *                   qua đúng `CrmProduct` chứ không lộ hình dạng bảng ra ngoài.
 *
 * Token/key chỉ nằm ở backend, không bao giờ đi ra trình duyệt.
 */
import { logger } from '../../shared/logger.js'
import { prisma } from '../../shared/prisma-client.js'
import { fetchProductCatalog } from '../orders/crm-order-client.js'

const TIMEOUT_MS = 15_000

/** Nguồn dữ liệu đang bật. Thiếu cấu hình dashboard thì tự về bridge. */
export type CrmProductSource = 'bridge' | 'dashboard' | 'local'

export function resolveSource(): CrmProductSource {
  const want = (process.env.CRM_PRODUCT_SOURCE || '').toLowerCase()
  if (want === 'dashboard' && process.env.CRM_DASHBOARD_TOKEN) return 'dashboard'
  if (want === 'local') return 'local'
  return 'bridge'
}

/**
 * CẤU TRÚC DỮ LIỆU SẢN PHẨM CHUẨN của ChatMQL.
 *
 * Đây là hợp đồng dữ liệu duy nhất mà toàn bộ giao diện và AI dựa vào. Nguồn
 * gốc (CRM hôm nay, hệ thống TDVN sau này) chỉ cần map về đúng hình dạng này
 * trong `normalizeProduct` là mọi nơi chạy được, không phải sửa gì thêm.
 *
 * `code` là KHOÁ NGHIỆP VỤ: tài liệu bán hàng (ảnh/mô tả/video do ChatMQL sở
 * hữu) gắn vào sản phẩm theo mã này, nên đổi nguồn dữ liệu vẫn giữ nguyên tri
 * thức đã soạn.
 */
export interface CrmProduct {
  // ── Định danh ──
  /** Id bên hệ thống nguồn. Chỉ để đối chiếu, không dùng làm khoá liên kết. */
  id: string | number | null
  /** Mã sản phẩm (SKU). KHOÁ chính để gắn tài liệu bán hàng và lên đơn. */
  code: string | null
  name: string
  // ── Bán hàng ──
  price: number | null
  /** Cận trên khi sản phẩm bán theo khoảng giá. */
  priceMax: number | null
  currency: string
  unit: string | null
  /** Ghi chú thuế của hệ thống nguồn, ví dụ "Đã có VAT 8%". */
  vatNote: string | null
  // ── Kho ──
  inventory: number | null
  weight: number | null
  warehouseId: number | null
  warehouseName: string | null
  // ── Phân loại ──
  categoryId: string | number | null
  categoryName: string | null
  brand: string | null
  /** active | inactive | ngừng bán… theo hệ thống nguồn. */
  status: string | null
  /**
   * Ảnh đại diện để dựng thẻ sản phẩm. Bộ ảnh đầy đủ vẫn thuộc tài liệu bán
   * hàng — đây chỉ là một tấm để nhận diện, thiếu thì giao diện vẽ ô trống.
   */
  imageUrl: string | null
  /**
   * Mã sản phẩm bên Zalo Mini App, ví dụ `FX/TP-CC03-100/KR-ZL`.
   *
   * KHÔNG dùng `code` để dựng link được: hệ quản trị Mini App đánh mã riêng
   * theo từng quy cách đóng gói (túi kraft, hộp thiếc, hộp mica), trong khi
   * `code` bên này chỉ có một mã cho cả dòng sản phẩm.
   */
  miniAppId: string | null
  /** Bản ghi gốc — giữ lại để hiện thêm cột mà không phải sửa backend. */
  raw: Record<string, unknown>
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

/** Lấy giá trị đầu tiên có thật trong danh sách khoá ứng viên. */
function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k]
  }
  return undefined
}

/**
 * CRM đặt tên trường không thống nhất giữa các endpoint (`code_product`, `sku`,
 * `ma_sp`…), nên dò theo danh sách khoá thay vì cứng một tên. `raw` luôn đi kèm
 * để không mất dữ liệu nào.
 */
export function normalizeProduct(row: Record<string, unknown>): CrmProduct {
  return {
    id: (pick(row, ['id', 'product_id', 'id_product']) as string | number) ?? null,
    code: str(pick(row, ['code', 'code_product', 'sku', 'ma_sp', 'product_code'])),
    name: str(pick(row, ['name', 'product_name', 'ten_sp', 'title'])) ?? '(không tên)',
    price: num(pick(row, ['price', 'gia_ban', 'sale_price', 'unit_price', 'price_sale'])),
    priceMax: num(pick(row, ['price_max', 'gia_max', 'max_price'])),
    currency: str(pick(row, ['currency', 'don_vi_tien'])) ?? 'VND',
    unit: str(pick(row, ['unit', 'don_vi', 'unit_name', 'dvt'])),
    vatNote: str(pick(row, ['vat_note', 'ghi_chu_vat', 'vat'])),
    inventory: num(pick(row, ['inventory', 'ton_kho', 'stock', 'quantity', 'so_luong'])),
    weight: num(pick(row, ['weight', 'khoi_luong', 'trong_luong'])),
    warehouseId: num(pick(row, ['warehouse_id', 'id_kho', 'kho_id'])),
    warehouseName: str(pick(row, ['warehouse_name', 'ten_kho', 'kho'])),
    categoryId: (pick(row, ['category_id', 'id_danh_muc', 'nhom_id', 'group_id']) as string | number) ?? null,
    categoryName: str(pick(row, ['category_name', 'category', 'danh_muc', 'nhom_sp', 'ten_nhom'])),
    brand: str(pick(row, ['brand', 'thuong_hieu', 'brand_name'])),
    status: str(pick(row, ['status', 'trang_thai', 'active'])),
    imageUrl: firstImage(row),
    miniAppId: str(pick(row, ['miniapp_id', 'mini_app_id', 'zalo_product_id', 'ma_zalo'])),
    raw: row,
  }
}

/** Ảnh đại diện: nhận cả trường ảnh đơn lẫn mảng ảnh, tuỳ endpoint CRM. */
function firstImage(row: Record<string, unknown>): string | null {
  const single = str(pick(row, ['image_url', 'image', 'thumbnail', 'thumb', 'avatar', 'picture', 'anh']))
  if (single) return single
  for (const k of ['images', 'photos', 'gallery', 'anh_sp']) {
    const v = row[k]
    if (Array.isArray(v) && v.length) {
      const first = str(v[0])
      if (first) return first
    }
  }
  return null
}

/** Bóc mảng bản ghi ra khỏi các kiểu vỏ bọc phổ biến của CRM. */
function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>
    for (const k of ['data', 'products', 'items', 'results', 'rows']) {
      const v = o[k]
      if (Array.isArray(v)) return v as Record<string, unknown>[]
      // Vỏ hai lớp kiểu { data: { data: [...] } }
      if (v && typeof v === 'object') {
        const inner = extractRows(v)
        if (inner.length) return inner
      }
    }
  }
  return []
}

async function searchViaDashboard(q: string, limit: number): Promise<CrmProduct[]> {
  const base = (process.env.CRM_DASHBOARD_API_URL || 'https://apicrm.traduoc.vn').replace(/\/$/, '')
  const token = process.env.CRM_DASHBOARD_TOKEN || ''
  if (!token) throw new Error('CRM_DASHBOARD_TOKEN chưa cấu hình')

  const url = `${base}/api/dashboard/search-products?q=${encodeURIComponent(q)}&limit=${limit}&exclude_deal_soc=false`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      // 401 gần như luôn là token hết hạn — nói rõ để nhân viên biết phải làm gì.
      const hint = res.status === 401 || res.status === 403
        ? 'Token CRM đã hết hạn hoặc không hợp lệ — cập nhật CRM_DASHBOARD_TOKEN.'
        : text.slice(0, 200)
      throw new Error(`CRM trả lỗi ${res.status}: ${hint}`)
    }
    const rows = extractRows(text ? JSON.parse(text) : null)
    if (!rows.length && text) {
      logger.warn({ sample: text.slice(0, 300) }, '[crm-products] Không bóc được mảng sản phẩm từ phản hồi CRM')
    } else if (rows.length) {
      // Ghi khoá thật của CRM một lần để chỉnh normalizeProduct nếu lệch tên.
      logger.debug({ keys: Object.keys(rows[0]) }, '[crm-products] khoá dữ liệu CRM')
    }
    return rows.map(normalizeProduct)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Đọc từ bảng `products` nội bộ và map về `CrmProduct`.
 *
 * Bảng nội bộ không quản kho nên `inventory`/`warehouse` để trống — trống nghĩa
 * là "không theo dõi ở nguồn này", khác với 0 là hết hàng, nên giao diện không
 * được hiểu nhầm thành ngừng bán.
 *
 * `priceType='range'` bên nội bộ tương ứng cặp price/priceMax của cấu trúc
 * chuẩn; các kiểu còn lại (contact/free) để giá trống cho đúng nghĩa.
 */
async function searchViaLocal(orgId: string, q: string, limit: number): Promise<CrmProduct[]> {
  const needle = q.trim()
  const rows = await prisma.product.findMany({
    where: {
      orgId,
      ...(needle
        ? {
            OR: [
              { name: { contains: needle, mode: 'insensitive' as const } },
              { code: { contains: needle, mode: 'insensitive' as const } },
              { keywords: { contains: needle, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    include: { category: { select: { id: true, name: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    take: limit,
  })

  return rows.map((r) => {
    const priced = r.priceType === 'fixed' || r.priceType === 'range'
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      price: priced && r.price != null ? Number(r.price) : null,
      priceMax: r.priceType === 'range' && r.priceMax != null ? Number(r.priceMax) : null,
      currency: r.currency,
      unit: null,
      vatNote: null,
      inventory: null,
      weight: null,
      warehouseId: null,
      warehouseName: null,
      categoryId: r.category?.id ?? null,
      categoryName: r.category?.name ?? null,
      brand: null,
      status: r.status,
      imageUrl: r.images[0] ?? null,
      // Ghép từ hệ quản trị Mini App, cất trong `specs` để không phải đổi lược đồ.
      miniAppId: (r.specs as Record<string, unknown> | null)?.miniapp_id as string ?? null,
      // Ảnh/mô tả/video có sẵn trong bảng nội bộ — đưa qua `raw` để thư viện tài
      // liệu dựng được nội dung mà cấu trúc chuẩn không phải phình thêm cột.
      raw: {
        description: r.description,
        images: r.images,
        video_urls: r.videoUrls,
        keywords: r.keywords,
        tags: r.tags,
        price_type: r.priceType,
        slug: r.slug,
      },
    }
  })
}

async function searchViaBridge(q: string, limit: number, warehouseId?: number): Promise<CrmProduct[]> {
  // Bridge trả cả danh mục theo kho; lọc theo từ khoá ngay tại backend.
  const { products } = await fetchProductCatalog({ q: q || undefined, warehouseId })
  const needle = q.trim().toLowerCase()
  const rows = (products as unknown as Record<string, unknown>[])
    .filter((p) => {
      if (!needle) return true
      const hay = `${p.name ?? ''} ${p.code ?? ''}`.toLowerCase()
      return hay.includes(needle)
    })
    .slice(0, limit)
  return rows.map(normalizeProduct)
}

/**
 * Tìm sản phẩm ở hệ thống nguồn đang bật.
 *
 * `orgId` chỉ cần cho nguồn `local` (bảng nội bộ có nhiều tổ chức); hai nguồn
 * kia đã bị ràng buộc tổ chức bằng chính khoá/token cấu hình.
 */
export async function searchCrmProducts(
  q: string,
  limit = 20,
  orgId?: string,
): Promise<{ source: CrmProductSource; products: CrmProduct[] }> {
  const source = resolveSource()
  const safeLimit = Math.min(100, Math.max(1, limit))
  const products = source === 'dashboard'
    ? await searchViaDashboard(q, safeLimit)
    : source === 'local'
      ? await searchViaLocal(requireOrg(orgId), q, safeLimit)
      : await searchViaBridge(q, safeLimit)
  return { source, products }
}

/** Nguồn nội bộ mà thiếu tổ chức là lỗi lập trình, không phải lỗi cấu hình. */
function requireOrg(orgId?: string): string {
  if (!orgId) throw new Error('Nguồn sản phẩm nội bộ cần orgId')
  return orgId
}

export interface ListParams {
  /** Bắt buộc khi nguồn là `local`. */
  orgId?: string
  q?: string
  warehouseId?: number
  category?: string
  /** Chỉ lấy hàng còn tồn — nhân viên thường chỉ quan tâm hàng bán được. */
  inStockOnly?: boolean
  page?: number
  pageSize?: number
}

export interface ListResult {
  source: CrmProductSource
  products: CrmProduct[]
  /** Danh mục có trong tập kết quả — để dựng bộ lọc mà không cần API riêng. */
  categories: string[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
}

/**
 * Danh sách sản phẩm để DUYỆT (không bắt buộc gõ từ khoá).
 *
 * Hệ thống nguồn hiện chưa có API phân trang, nên lấy trọn danh mục rồi lọc và
 * cắt trang tại backend. Khi TDVN cấp API chính thức có `page`/`total`, chỉ cần
 * thay phần thân hàm này, hình dạng trả về giữ nguyên.
 */
export async function listCrmProducts(params: ListParams = {}): Promise<ListResult> {
  const source = resolveSource()
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50))

  const all = source === 'dashboard'
    ? await searchViaDashboard(params.q ?? '', 200)
    : source === 'local'
      ? await searchViaLocal(requireOrg(params.orgId), '', 1000)
      : await searchViaBridge('', 1000, params.warehouseId)

  const needle = (params.q ?? '').trim().toLowerCase()
  let rows = all.filter((p) => {
    if (needle && !`${p.name} ${p.code ?? ''}`.toLowerCase().includes(needle)) return false
    if (params.warehouseId != null && p.warehouseId != null && p.warehouseId !== params.warehouseId) return false
    if (params.category && (p.categoryName ?? '') !== params.category) return false
    if (params.inStockOnly && !(p.inventory != null && p.inventory > 0)) return false
    return true
  })

  const categories = [...new Set(all.map((p) => p.categoryName).filter((c): c is string => !!c))].sort()
  const total = rows.length
  rows = rows.slice((page - 1) * pageSize, page * pageSize)

  return {
    source,
    products: rows,
    categories,
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  }
}
