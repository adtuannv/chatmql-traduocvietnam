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
 *   3. `official` → FM backend của TDVN, /api/products/external/list, xác thực
 *                   bằng header x-api-key. ĐÂY LÀ NGUỒN CHÍNH THỨC — khi chạy
 *                   được thì các nguồn còn lại chỉ còn để dự phòng.
 *   4. `local`    → bảng `products` nội bộ — danh mục thật đã có sẵn trong hệ
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

/** Trần `limit` của FM; vượt là lỗi 422 chứ không được cắt bớt giúp. */
const FM_LIMIT_MAX = 500

/** Nguồn dữ liệu đang bật. Thiếu cấu hình dashboard thì tự về bridge. */
export type CrmProductSource = 'bridge' | 'dashboard' | 'local' | 'official'

export const CAC_NGUON: CrmProductSource[] = ['official', 'bridge', 'dashboard', 'local']

/** Khoá lưu nguồn do quản trị chọn trong giao diện. */
const KHOA_NGUON = 'crm.product_source'

/** Khoá lưu mẫu link Mini App do quản trị đặt trong giao diện. */
const KHOA_MAU_LINK = 'miniapp.url_template'

/**
 * Mẫu link Mini App của Trà Dược Việt Nam — dùng khi chưa ai cấu hình gì.
 *
 * Để trống làm mặc định thì mọi nút gửi sản phẩm bị khoá ngay từ lúc dựng máy
 * chủ, và thông báo lại bảo đi đặt biến môi trường — đúng cái đã xảy ra trên
 * bản thật. Có sẵn giá trị đúng thì cài xong là chạy; nơi nào khác vẫn đè được
 * bằng giao diện hoặc biến môi trường.
 */
export const MAU_LINK_MAC_DINH =
  'https://zalo.me/s/1575573710529516487/?page=detail-product&product_id={miniapp}'

// Mỗi tin đến đều hỏi nguồn; cache ngắn để khỏi truy vấn liên tục, và đủ ngắn
// để quản trị đổi xong là thấy hiệu lực gần như ngay.
const NGUON_TTL_MS = 15_000
const cacheNguon = new Map<string, { at: number; value: CrmProductSource | null }>()

export function xoaCacheNguon(orgId?: string): void {
  if (orgId) cacheNguon.delete(orgId)
  else cacheNguon.clear()
}

/**
 * Nguồn quản trị đã chọn trong giao diện, hoặc null nếu chưa chọn.
 *
 * Cho phép đổi nguồn mà không phải sửa tệp cấu hình rồi khởi động lại máy chủ —
 * việc đó chỉ kỹ thuật làm được, còn đây là quyết định vận hành.
 */
export async function nguonDaChon(orgId: string): Promise<CrmProductSource | null> {
  const hit = cacheNguon.get(orgId)
  if (hit && Date.now() - hit.at < NGUON_TTL_MS) return hit.value
  let value: CrmProductSource | null = null
  try {
    const row = await prisma.appSetting.findFirst({
      where: { orgId, settingKey: KHOA_NGUON },
      select: { valuePlain: true },
    })
    const v = (row?.valuePlain ?? '').trim() as CrmProductSource
    if (CAC_NGUON.includes(v)) value = v
  } catch {
    // Đọc cấu hình hỏng thì rơi về biến môi trường, không chặn cả module.
  }
  cacheNguon.set(orgId, { at: Date.now(), value })
  return value
}

/** Lưu chuỗi rỗng để bỏ lựa chọn, quay về cấu hình của máy chủ. */
/**
 * Mẫu link Mini App: ưu tiên giá trị quản trị đặt trong giao diện, rồi tới biến
 * môi trường.
 *
 * Để mỗi biến môi trường thì đổi link phải sửa tệp rồi khởi động lại máy chủ —
 * chỉ kỹ thuật làm được, trong khi địa chỉ Mini App là thứ bên vận hành nắm.
 * Đúng cái đã xảy ra: bản prod thiếu biến nên mọi nút gửi bị khoá.
 */
export async function mauLinkMiniApp(orgId: string): Promise<string> {
  try {
    const row = await prisma.appSetting.findFirst({
      where: { orgId, settingKey: KHOA_MAU_LINK },
      select: { valuePlain: true },
    })
    const v = (row?.valuePlain ?? '').trim()
    if (v) return v
  } catch { /* đọc hỏng thì rơi về biến môi trường */ }
  return process.env.ZALO_MINIAPP_PRODUCT_URL || MAU_LINK_MAC_DINH
}

/**
 * Bảng giá theo mã sản phẩm, lấy từ nguồn đang bật.
 *
 * AI cần giá THẬT chứ không phải giá trong bảng nội bộ cũ — báo sai giá cho
 * khách là mất đơn hoặc mất uy tín. Nhưng mỗi tin nhắn đến mà gọi hệ thống
 * nguồn một lần thì vừa chậm vừa dễ bị chặn, nên nhớ tạm trong thời gian ngắn:
 * đủ để đổi giá bên nguồn là vài phút sau đã thấy, mà không nện API.
 */
const GIA_TTL_MS = 120_000
const cacheGia = new Map<string, { at: number; bang: Map<string, GiaSanPham> }>()

export interface GiaSanPham {
  price: number | null
  priceMax: number | null
  unit: string | null
  vatNote: string | null
  status: string | null
  inventory: number | null
}

export async function bangGiaTheoMa(orgId: string): Promise<Map<string, GiaSanPham>> {
  const hit = cacheGia.get(orgId)
  if (hit && Date.now() - hit.at < GIA_TTL_MS) return hit.bang

  const bang = new Map<string, GiaSanPham>()
  try {
    const kq = await listCrmProducts({ orgId, pageSize: 200 })
    for (const p of kq.products) {
      if (!p.code) continue
      bang.set(p.code.trim().toUpperCase(), {
        price: p.price, priceMax: p.priceMax, unit: p.unit,
        vatNote: p.vatNote, status: p.status, inventory: p.inventory,
      })
    }
  } catch {
    // Nguồn lỗi thì trả bảng rỗng: AI mất phần giá nhưng vẫn tư vấn được, còn
    // hơn là hỏng cả lượt trả lời. Không cache lần lỗi để lần sau thử lại.
    return bang
  }
  cacheGia.set(orgId, { at: Date.now(), bang })
  return bang
}

export async function luuMauLinkMiniApp(orgId: string, mau: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey: KHOA_MAU_LINK } },
    update: { valuePlain: mau },
    create: { orgId, settingKey: KHOA_MAU_LINK, valuePlain: mau },
  })
}

export async function luuNguon(orgId: string, nguon: CrmProductSource | ''): Promise<void> {
  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey: KHOA_NGUON } },
    update: { valuePlain: nguon },
    create: { orgId, settingKey: KHOA_NGUON, valuePlain: nguon },
  })
  xoaCacheNguon(orgId)
}

/**
 * Nguồn đang thực sự dùng: ưu tiên lựa chọn của quản trị, rồi tới biến môi
 * trường. Nguồn nào thiếu cấu hình bắt buộc thì bỏ qua để không rơi vào cảnh
 * giao diện trống trơn mà không rõ lý do.
 */
export async function resolveSourceFor(orgId: string): Promise<CrmProductSource> {
  const chon = await nguonDaChon(orgId)
  if (chon) {
    if (chon === 'official' && (!process.env.FM_PRODUCT_API_URL || !process.env.FM_PRODUCT_API_KEY)) {
      return resolveSource()
    }
    if (chon === 'dashboard' && !process.env.CRM_DASHBOARD_TOKEN) return resolveSource()
    return chon
  }
  return resolveSource()
}

export function resolveSource(): CrmProductSource {
  const want = (process.env.CRM_PRODUCT_SOURCE || '').toLowerCase()
  // Nguồn chính thức chỉ bật khi có ĐỦ địa chỉ và khoá — thiếu một trong hai
  // thì rơi về nguồn khác còn hơn để giao diện trống trơn không rõ lý do.
  if (want === 'official' && process.env.FM_PRODUCT_API_URL && process.env.FM_PRODUCT_API_KEY) {
    return 'official'
  }
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
    id: (pick(row, ['id', 'id_product', 'product_id']) as string | number) ?? null,
    code: str(pick(row, ['code', 'code_product', 'sku', 'ma_sp', 'product_code'])),
    name: str(pick(row, ['name', 'name_product', 'product_name', 'ten_sp', 'title'])) ?? '(không tên)',
    price: num(pick(row, ['price', 'gia_ban', 'sale_price', 'unit_price', 'price_sale'])),
    priceMax: num(pick(row, ['price_max', 'gia_max', 'max_price'])),
    currency: str(pick(row, ['currency', 'don_vi_tien'])) ?? 'VND',
    unit: str(pick(row, ['unit', 'don_vi', 'unit_name', 'dvt'])),
    vatNote: str(pick(row, ['vat_note', 'ghi_chu_vat', 'vat'])),
    inventory: num(pick(row, ['inventory', 'ton_kho', 'stock', 'quantity', 'so_luong'])),
    weight: num(pick(row, ['weight', 'khoi_luong', 'trong_luong'])),
    warehouseId: num(pick(row, ['warehouse_id', 'id_kho', 'kho_id'])),
    warehouseName: str(pick(row, ['warehouse_name', 'ten_kho', 'kho'])),
    categoryId: (pick(row, [
      'category_id', 'id_product_type', 'id_product_group', 'id_danh_muc', 'nhom_id', 'group_id',
    ]) as string | number) ?? null,
    categoryName: str(pick(row, [
      'category_name', 'category', 'name_product_type', 'name_product_group',
      'danh_muc', 'nhom_sp', 'ten_nhom',
    ])),
    brand: str(pick(row, ['brand', 'name_brand', 'thuong_hieu', 'brand_name'])),
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
      miniAppId: null,
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

/**
 * Đọc từ FM backend — hệ thống sản phẩm chính thức của TDVN.
 *
 * Chưa biết chắc FM đặt tên trường thế nào, nhưng `normalizeProduct` vốn dò
 * theo danh sách khoá ứng viên nên phần lớn sẽ khớp ngay; lệch chỗ nào thì bổ
 * sung tên khoá vào đó chứ không phải sửa chỗ khác. Khoá thật của bản ghi vẫn
 * nằm nguyên trong `raw`.
 */
async function docTuFm(
  limit: number,
  opts: { q?: string; offset?: number } = {},
): Promise<{ rows: CrmProduct[]; total: number }> {
  const base = (process.env.FM_PRODUCT_API_URL || '').replace(/\/$/, '')
  const key = process.env.FM_PRODUCT_API_KEY || ''
  if (!base || !key) throw new Error('FM_PRODUCT_API_URL hoặc FM_PRODUCT_API_KEY chưa cấu hình')

  // FM tự tìm kiếm và phân trang, nên đẩy việc sang máy chủ thay vì kéo trọn
  // danh mục về rồi lọc — danh mục lớn thì cách kia vừa chậm vừa tốn băng thông.
  // FM chặn limit > 500 bằng lỗi 422, không phải tự cắt bớt.
  const qs = new URLSearchParams({ limit: String(Math.min(FM_LIMIT_MAX, Math.max(1, limit))) })
  if (opts.q?.trim()) qs.set('search', opts.q.trim())
  if (opts.offset) qs.set('offset', String(opts.offset))
  const url = `${base}/api/products/external/list?${qs.toString()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-api-key': key },
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403
        ? 'Khoá FM_PRODUCT_API_KEY sai hoặc đã đổi.'
        : text.slice(0, 200)
      throw new Error(`FM trả lỗi ${res.status}: ${hint}`)
    }
    const payload = text ? JSON.parse(text) : null
    const rows = extractRows(payload)
    if (!rows.length && text) {
      logger.warn({ sample: text.slice(0, 300) }, '[crm-products] không bóc được mảng sản phẩm từ FM')
    }
    // `total` của FM là tổng THẬT sau khi lọc, không phải số dòng trang này.
    const total = Number((payload as { total?: unknown } | null)?.total)
    return {
      rows: rows.map(normalizeProduct),
      total: Number.isFinite(total) ? total : rows.length,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`FM không phản hồi trong ${TIMEOUT_MS / 1000}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Danh sách danh mục của toàn bộ danh mục FM, KHÔNG phải của trang đang xem.
 *
 * Gom từ trang hiện tại thì bộ lọc chỉ hiện vài danh mục và đổi liên tục theo
 * trang — người dùng tưởng danh mục biến mất. Cache vì danh mục hiếm khi đổi.
 */
const DANH_MUC_TTL_MS = 5 * 60_000
let cacheDanhMuc: { at: number; value: string[] } | null = null

async function danhMucFm(): Promise<string[]> {
  if (cacheDanhMuc && Date.now() - cacheDanhMuc.at < DANH_MUC_TTL_MS) return cacheDanhMuc.value
  try {
    const { rows } = await docTuFm(FM_LIMIT_MAX)
    const value = [...new Set(rows.map((p) => p.categoryName).filter((c): c is string => !!c))].sort()
    cacheDanhMuc = { at: Date.now(), value }
    return value
  } catch {
    // Không lấy được danh mục thì bộ lọc trống, nhưng danh sách vẫn phải chạy.
    return cacheDanhMuc?.value ?? []
  }
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
  const source = orgId ? await resolveSourceFor(orgId) : resolveSource()
  const safeLimit = Math.min(100, Math.max(1, limit))
  let products: CrmProduct[]
  if (source === 'official') {
    products = (await docTuFm(safeLimit, { q })).rows
  } else if (source === 'dashboard') {
    products = await searchViaDashboard(q, safeLimit)
  } else if (source === 'local') {
    products = await searchViaLocal(requireOrg(orgId), q, safeLimit)
  } else {
    products = await searchViaBridge(q, safeLimit)
  }
  return { source, products: orgId ? await buMaMiniApp(orgId, products) : products }
}

/**
 * Bù mã Mini App từ tài liệu sản phẩm của ChatMQL.
 *
 * Ánh xạ này KHÔNG nằm ở hệ thống nguồn — nguồn không biết gì về Mini App, và
 * để nó ở bảng sản phẩm nội bộ thì đổi nguồn là mất sạch công ghép. Khoá theo
 * MÃ sản phẩm nên đổi nguồn vẫn giữ nguyên.
 *
 * Một truy vấn cho cả trang thay vì mỗi sản phẩm một lần.
 */
async function buMaMiniApp(orgId: string, rows: CrmProduct[]): Promise<CrmProduct[]> {
  const ma = [...new Set(rows.map((p) => p.code?.trim().toUpperCase()).filter((c): c is string => !!c))]
  if (!ma.length) return rows.map(donAnh)
  try {
    const docs = await prisma.productDoc.findMany({
      where: { orgId, productCode: { in: ma } },
      select: { productCode: true, miniAppId: true, images: true },
    })
    const bang = new Map(docs.map((d) => [d.productCode.toUpperCase(), d]))
    return rows.map((p) => {
      const d = p.code ? bang.get(p.code.trim().toUpperCase()) : undefined
      const goc = donAnh(p)
      if (!d) return goc
      return {
        ...goc,
        miniAppId: d.miniAppId ?? goc.miniAppId,
        // Ảnh trong tài liệu bán hàng là tệp thật đã lưu trên máy chủ, còn ảnh
        // của hệ thống nguồn có thể không có hoặc là chuỗi nhúng cả trăm KB.
        // Ưu tiên tệp: nhẹ hơn, và đúng tấm ảnh mà nút Gửi sẽ gửi đi.
        imageUrl: d.images[0] ?? goc.imageUrl,
      }
    })
  } catch {
    // Không đọc được ánh xạ thì danh sách vẫn phải hiện, chỉ là nút gửi bị khoá.
    return rows.map(donAnh)
  }
}

/**
 * Bỏ ảnh nhúng base64 khỏi thứ gửi ra trình duyệt.
 *
 * Hệ thống nguồn trả ảnh dạng `data:image/jpeg;base64,...` dài hơn 140 KB mỗi
 * tấm. Một trang 60 sản phẩm là gần 18 MB JSON — trình duyệt tải ì ạch mà cũng
 * chẳng đẹp hơn tệp ảnh thường. Đã có tệp trong tài liệu bán hàng thì dùng tệp;
 * chưa có thì thà để trống, giao diện vẽ ô trống là hiểu ngay.
 */
function donAnh(p: CrmProduct): CrmProduct {
  if (!p.imageUrl?.startsWith('data:')) return p
  const { image_url: _bo, images: _bo2, ...rawGon } = p.raw
  return { ...p, imageUrl: null, raw: rawGon }
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
  const source = params.orgId ? await resolveSourceFor(params.orgId) : resolveSource()
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50))

  if (source === 'official') {
    // FM lọc được theo từ khoá nhưng KHÔNG lọc theo tên danh mục hay tồn kho.
    // Lọc hai thứ đó sau khi đã phân trang sẽ ra kết quả sai: trang 1 lọc còn
    // 2 dòng thì người dùng tưởng cả kho chỉ có 2. Nên khi có hai bộ lọc này
    // thì lấy trọn danh mục rồi tự lọc và cắt trang.
    const locTaiCho = !!params.category

    if (!locTaiCho) {
      const { rows, total } = await docTuFm(pageSize, {
        q: params.q,
        offset: (page - 1) * pageSize,
      })
      return {
        source,
        products: await buMaMiniApp(params.orgId!, rows),
        categories: await danhMucFm(),
        meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      }
    }

    const { rows } = await docTuFm(FM_LIMIT_MAX, { q: params.q })
    const loc = rows.filter((p) => !params.category || (p.categoryName ?? '') === params.category)
    return {
      source,
      products: await buMaMiniApp(params.orgId!, loc.slice((page - 1) * pageSize, page * pageSize)),
      categories: await danhMucFm(),
      meta: {
        page, pageSize, total: loc.length,
        totalPages: Math.max(1, Math.ceil(loc.length / pageSize)),
      },
    }
  }

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
    return true
  })

  const categories = [...new Set(all.map((p) => p.categoryName).filter((c): c is string => !!c))].sort()
  const total = rows.length
  rows = rows.slice((page - 1) * pageSize, page * pageSize)

  return {
    source,
    products: params.orgId ? await buMaMiniApp(params.orgId, rows) : rows,
    categories,
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  }
}
