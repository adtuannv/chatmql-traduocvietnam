/**
 * product-docs-service.ts — Tài liệu bán hàng của sản phẩm (ảnh · mô tả · video).
 *
 * Tri thức này do ChatMQL sở hữu, gắn vào sản phẩm theo MÃ (`productCode`) —
 * không phụ thuộc bảng `products` nội bộ. Xem docs/cau-truc-du-lieu-san-pham.md.
 *
 * Hai chỗ tiêu thụ:
 *   • Nhân viên: module "Tài liệu bán hàng" ở giao diện.
 *   • AI: nạp vào ngữ cảnh khi tư vấn (harness + AI Trợ lý nội bộ).
 */
import { mauLinkMiniApp, bangGiaTheoMa } from '../crm-products/crm-products-client.js'
import { prisma } from '../../shared/prisma-client.js'

export interface ProductDocInput {
  /** Danh mục trong cây tài liệu bán hàng. */
  folderId?: string | null
  name?: string | null
  description?: string | null
  images?: string[]
  videoUrls?: string[]
  keywords?: string | null
}

/** Chuẩn hoá mã: hệ thống nguồn hay trả kèm khoảng trắng / khác hoa-thường. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

export async function getProductDoc(orgId: string, code: string) {
  return prisma.productDoc.findUnique({
    where: { orgId_productCode: { orgId, productCode: normalizeCode(code) } },
  })
}

/** Lấy tài liệu của nhiều mã cùng lúc — dùng cho danh sách, tránh N+1. */
export async function getProductDocsByCodes(orgId: string, codes: string[]) {
  const list = [...new Set(codes.map(normalizeCode).filter(Boolean))]
  if (!list.length) return []
  return prisma.productDoc.findMany({ where: { orgId, productCode: { in: list } } })
}

export async function listProductDocs(orgId: string, limit = 200) {
  return prisma.productDoc.findMany({
    where: { orgId },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(500, Math.max(1, limit)),
  })
}

export async function upsertProductDoc(
  orgId: string,
  code: string,
  data: ProductDocInput,
  updatedById?: string,
) {
  const productCode = normalizeCode(code)
  if (!productCode) throw new Error('Thiếu mã sản phẩm')

  // `undefined` = không đụng tới, `null` = xoá trắng. Gộp hai thứ này lại thì
  // người dùng xoá hết mô tả rồi bấm Lưu mà nội dung cũ vẫn còn nguyên — và họ
  // sẽ tưởng hệ thống không lưu được.
  const patch = {
    folderId: data.folderId,
    name: data.name,
    description: data.description,
    images: data.images,
    videoUrls: data.videoUrls,
    keywords: data.keywords,
    updatedById: updatedById ?? undefined,
  }
  return prisma.productDoc.upsert({
    where: { orgId_productCode: { orgId, productCode } },
    create: {
      orgId,
      productCode,
      folderId: data.folderId ?? null,
      name: data.name ?? null,
      description: data.description ?? null,
      images: data.images ?? [],
      videoUrls: data.videoUrls ?? [],
      keywords: data.keywords ?? null,
      updatedById: updatedById ?? null,
    },
    update: patch,
  })
}

export async function deleteProductDoc(orgId: string, code: string): Promise<boolean> {
  const res = await prisma.productDoc.deleteMany({
    where: { orgId, productCode: normalizeCode(code) },
  })
  return res.count > 0
}

// ── Truy hồi cho AI ───────────────────────────────────────────────────

export interface ProductDocSnippet {
  productCode: string
  name: string | null
  description: string | null
  imageCount: number
  videoCount: number
  /** Link Mini App gửi được cho khách. Rỗng = sản phẩm chưa ghép mã. */
  miniAppUrl: string | null
  /** Giá và đơn vị lấy THẲNG từ hệ thống nguồn tại thời điểm trả lời. */
  price: number | null
  priceMax: number | null
  unit: string | null
  vatNote: string | null
}

/**
 * Tìm tài liệu liên quan tới câu khách hỏi.
 *
 * Dùng khớp chuỗi (ILIKE) chứ chưa dùng vector: catalog cỡ vài trăm sản phẩm
 * nên khớp tên/mã/từ khoá đã đủ chính xác, lại không phải chạy embedding mỗi
 * lần sửa tài liệu. Khi danh mục phình to thì thêm cột embedding như KB.
 */
/** Từ để hỏi và từ nối — khớp vào chúng chỉ tạo nhiễu. */
export const TU_BO_QUA = new Set([
  'bao', 'nhieu', 'tien', 'gia', 'the', 'nao', 'khong', 'con', 'hang', 'cho',
  'minh', 'shop', 'ban', 'mua', 'muon', 'duoc', 'voi', 'lam', 'sao', 'nay',
  'oi', 'nhe', 'aj', 'vay', 'nhi', 'xin', 'hoi', 'cai', 'loai', 'mau',
])

/** Bỏ dấu để so khớp không phụ thuộc cách gõ. */
function bo_dau(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
}

/**
 * Chấm điểm độ khớp. Tên sản phẩm nặng hơn mô tả rất nhiều: khách gõ tên hàng
 * chứ không gõ đoạn mô tả, nên một từ trúng tên đáng giá hơn ba từ trúng mô tả.
 */
export function diemKhop(
  row: { name: string | null; keywords: string | null; productCode: string; description: string | null },
  terms: string[],
): number {
  const ten = bo_dau(row.name ?? '')
  const khoa = bo_dau(row.keywords ?? '')
  const ma = bo_dau(row.productCode)
  const mo = bo_dau(row.description ?? '')
  let d = 0
  for (const t0 of terms) {
    const t = bo_dau(t0)
    if (ma === t) d += 20
    else if (ma.includes(t)) d += 6
    if (ten === t) d += 15
    else if (ten.includes(t)) d += 8
    if (khoa.includes(t)) d += 5
    if (mo.includes(t)) d += 1
  }
  // Trúng nhiều từ liền nhau trong tên là dấu hiệu chắc nhất.
  if (ten.includes(bo_dau(terms.join(' ')))) d += 12
  return d
}

export async function retrieveProductDocs(
  orgId: string,
  query: string,
  limit = 5,
): Promise<ProductDocSnippet[]> {
  const q = query.trim()
  if (!q) return []

  // Tách từ khoá để câu dài của khách vẫn khớp được tên sản phẩm ngắn.
  // Bỏ từ để hỏi và từ nối: "trà đinh ngọc bao nhiêu tiền" mà đi tìm cả "bao"
  // với "tiền" thì khớp trúng mô tả của sản phẩm bất kỳ có chữ "bao bì".
  const terms = [...new Set(
    q.split(/[\s,.;:!?()\[\]"']+/)
      .filter((t) => t.length >= 3 && !TU_BO_QUA.has(bo_dau(t))),
  )].slice(0, 8)
  const needles = terms.length ? terms : [q]

  const rows = await prisma.productDoc.findMany({
    where: {
      orgId,
      OR: needles.flatMap((t) => [
        { name: { contains: t, mode: 'insensitive' as const } },
        { keywords: { contains: t, mode: 'insensitive' as const } },
        { productCode: { contains: t, mode: 'insensitive' as const } },
        { description: { contains: t, mode: 'insensitive' as const } },
      ]),
    },
    // Lấy rộng rồi tự xếp hạng: sắp theo updatedAt là trả về sản phẩm sửa gần
    // nhất chứ không phải sản phẩm khách đang hỏi — hỏi "trà đinh ngọc" mà ra
    // "bộ ấm chén" thì AI tư vấn nhầm hàng, tệ hơn là không trả lời.
    orderBy: { updatedAt: 'desc' },
    take: 40,
  })

  // Dựng sẵn link ở đây thay vì để AI tự ghép: mã Mini App có dấu gạch chéo
  // nên phải mã hoá, mà mô hình ghép chuỗi thì sai lúc nào không biết — khách
  // bấm vào link hỏng còn tệ hơn không gửi link.
  // Chỉ giữ những dòng thật sự khớp tên/mã/từ khoá. Trúng mỗi mô tả (điểm ≤ số
  // từ) là nhiễu — thà trả ít còn hơn đưa AI sản phẩm sai.
  const cham = rows
    .map((r) => ({ r, d: diemKhop(r, needles) }))
    .filter((x) => x.d > needles.length)
    .sort((a, b) => b.d - a.d)

  // Khi đã có một kết quả khớp mạnh thì cắt bỏ phần đuôi khớp yếu hẳn. Đưa
  // thêm sản phẩm chỉ dính một từ chung chỉ khiến AI tư vấn lan man sang hàng
  // khách không hỏi.
  const nguong = (cham[0]?.d ?? 0) * 0.4
  const xep = cham
    .filter((x) => x.d >= nguong)
    .slice(0, Math.min(20, Math.max(1, limit)))
    .map((x) => x.r)

  if (!xep.length) return []

  // Giá lấy thẳng từ hệ thống nguồn chứ không cất sẵn trong tài liệu: giá đổi
  // thường xuyên, mà AI báo giá cũ cho khách là mất uy tín hoặc lỗ đơn.
  const [mau, gia] = await Promise.all([mauLinkMiniApp(orgId), bangGiaTheoMa(orgId)])

  return xep.map((r) => ({
    productCode: r.productCode,
    name: r.name,
    description: r.description,
    miniAppUrl: r.miniAppId && mau
      ? mau.replaceAll('{miniapp}', encodeURIComponent(r.miniAppId))
      : null,
    price: gia.get(r.productCode.trim().toUpperCase())?.price ?? null,
    priceMax: gia.get(r.productCode.trim().toUpperCase())?.priceMax ?? null,
    unit: gia.get(r.productCode.trim().toUpperCase())?.unit ?? null,
    vatNote: gia.get(r.productCode.trim().toUpperCase())?.vatNote ?? null,
    imageCount: r.images.length,
    videoCount: r.videoUrls.length,
  }))
}
