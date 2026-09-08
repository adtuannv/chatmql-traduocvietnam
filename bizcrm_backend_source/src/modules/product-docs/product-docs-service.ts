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
  /** Đường dẫn ảnh — công cụ gửi ảnh cần tệp thật, không chỉ cần số lượng. */
  images: string[]
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
 * Chấm điểm độ khớp, có tính ĐỘ HIẾM của từ.
 *
 * Bản trước cộng đều mọi từ, nên hỏi "trà móc câu" thì từ "trà" — khớp 71% tên
 * sản phẩm — cộng điểm cho gần hết danh mục, dìm chết từ "móc câu" chỉ khớp 2
 * sản phẩm. Kết quả là khách hỏi trà móc câu lại được tư vấn hộp quà.
 *
 * Nay từ càng khớp nhiều sản phẩm thì càng ít giá trị phân biệt, đúng như trực
 * giác: "trà" không nói lên gì, "móc câu" mới là thứ khách muốn.
 */
export function diemKhop(
  row: { name: string | null; keywords: string | null; productCode: string; description: string | null },
  terms: string[],
  trongSo: Map<string, number>,
): number {
  const ten = bo_dau(row.name ?? '')
  const khoa = bo_dau(row.keywords ?? '')
  const ma = bo_dau(row.productCode)
  const mo = bo_dau(row.description ?? '')
  let d = 0
  let moKhop = 0

  for (const t0 of terms) {
    const t = bo_dau(t0)
    const w = trongSo.get(t) ?? 1
    if (ma === t) d += 20 * w
    else if (ma.includes(t)) d += 6 * w
    if (ten === t) d += 15 * w
    else if (ten.includes(t)) d += 8 * w
    if (khoa.includes(t)) d += 5 * w
    if (mo.includes(t)) moKhop += w
  }

  // Mô tả chỉ được góp tối đa 2 điểm cho CẢ tin, không cộng dồn từng từ. Bản
  // trước cộng dồn, nên 30 sản phẩm có mô tả (toàn hộp quà) luôn thắng 54 sản
  // phẩm mô tả trống — mà 54 cái kia mới là trà bán chạy.
  d += Math.min(2, moKhop)

  // Trúng nguyên cụm trong tên là dấu hiệu chắc nhất.
  if (ten.includes(bo_dau(terms.join(' ')))) d += 12
  return d
}

/**
 * Trọng số từng từ theo độ hiếm: khớp càng nhiều sản phẩm thì càng vô nghĩa.
 * Tính trên TOÀN danh mục chứ không phải trên tập đã lọc, nếu không thì từ nào
 * cũng "hiếm" vì tập lọc chỉ còn thứ đã khớp.
 */
export function tinhTrongSo(terms: string[], toanBo: Array<{ name: string | null; keywords: string | null }>): Map<string, number> {
  const w = new Map<string, number>()
  const tong = Math.max(1, toanBo.length)
  for (const t0 of terms) {
    const t = bo_dau(t0)
    const n = toanBo.filter((r) => bo_dau(`${r.name ?? ''} ${r.keywords ?? ''}`).includes(t)).length
    const tyLe = n / tong
    // >50% danh mục: gần như vô giá trị. 20–50%: yếu. Dưới 20%: giữ nguyên.
    w.set(t, tyLe > 0.5 ? 0.1 : tyLe > 0.2 ? 0.4 : 1)
  }
  return w
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

  // Nạp trọn danh mục rồi xếp trong bộ nhớ. 84 sản phẩm là quá nhỏ để phải
  // lọc ở cơ sở dữ liệu, mà lọc trước thì không tính được độ hiếm của từ —
  // thứ quyết định xếp hạng đúng hay sai.
  const rows = await prisma.productDoc.findMany({ where: { orgId } })
  const trongSo = tinhTrongSo(needles, rows)


  // Dựng sẵn link ở đây thay vì để AI tự ghép: mã Mini App có dấu gạch chéo
  // nên phải mã hoá, mà mô hình ghép chuỗi thì sai lúc nào không biết — khách
  // bấm vào link hỏng còn tệ hơn không gửi link.
  // Chỉ giữ những dòng thật sự khớp tên/mã/từ khoá. Trúng mỗi mô tả (điểm ≤ số
  // từ) là nhiễu — thà trả ít còn hơn đưa AI sản phẩm sai.
  const cham = rows
    .map((r) => ({ r, d: diemKhop(r, needles, trongSo) }))
    // Ngưỡng theo tổng trọng số: câu chỉ toàn từ chung chung thì không sản phẩm
    // nào "khớp", và trả rỗng còn hơn trả bừa 5 món không liên quan.
    .filter((x) => x.d >= 4)
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
    images: r.images,
    imageCount: r.images.length,
    videoCount: r.videoUrls.length,
  }))
}

/**
 * Bản đồ danh mục: nhóm nào có bao nhiêu món, khoảng giá, vài cái tên tiêu biểu.
 *
 * Tìm theo từ khoá không trả lời được câu "bên mình có những loại trà nào?" —
 * câu đó không có từ khoá nào để tìm. Trước đây tìm trả rỗng, AI bèn tự bịa ra
 * "17 loại trà xanh, 6 loại trà dược, 15 mẫu hộp biếu", và tệ hơn: khi khách
 * hỏi lại thì AI khẳng định công ty KHÔNG có trà móc câu — mặt hàng chủ lực.
 *
 * Nên luôn đưa bản đồ này vào ngữ cảnh. Nó nhỏ (khoảng 20 dòng) mà chặn đứng
 * cả việc bịa lẫn việc chối nhầm hàng công ty đang bán.
 */
const CACHE_DANH_MUC_MS = 300_000
const cacheDanhMuc = new Map<string, { at: number; text: string }>()

export async function banDoDanhMuc(orgId: string): Promise<string> {
  const hit = cacheDanhMuc.get(orgId)
  if (hit && Date.now() - hit.at < CACHE_DANH_MUC_MS) return hit.text

  const [rows, gia] = await Promise.all([
    prisma.productDoc.findMany({
      where: { orgId },
      select: { name: true, productCode: true, folder: { select: { name: true, parent: { select: { name: true } } } } },
    }),
    bangGiaTheoMa(orgId),
  ])

  const nhom = new Map<string, { ten: string[]; gia: number[] }>()
  for (const r of rows) {
    if (!r.folder) continue
    const khoa = r.folder.parent ? `${r.folder.parent.name} › ${r.folder.name}` : r.folder.name
    if (!nhom.has(khoa)) nhom.set(khoa, { ten: [], gia: [] })
    const o = nhom.get(khoa)!
    if (r.name) o.ten.push(r.name)
    const g = gia.get(r.productCode.trim().toUpperCase())?.price
    if (g != null) o.gia.push(g)
  }

  const vnd = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`
  const dong = [...nhom.entries()]
    .filter(([, v]) => v.ten.length > 0)
    .sort((a, b) => b[1].ten.length - a[1].ten.length)
    .map(([khoa, v]) => {
      const min = v.gia.length ? Math.min(...v.gia) : null
      const max = v.gia.length ? Math.max(...v.gia) : null
      const khoangGia = min != null ? ` · ${min === max ? vnd(min) : `${vnd(min)}–${vnd(max!)}`}` : ''
      // Ba cái tên là đủ để AI gọi đúng tên hàng; nhiều hơn thì lời nhắc phình
      // ra mà không giúp thêm — cần chi tiết thì đã có khối tài liệu sản phẩm.
      const vd = v.ten.slice(0, 3).join(', ')
      return `- ${khoa}: ${v.ten.length} sản phẩm${khoangGia}. Ví dụ: ${vd}${v.ten.length > 3 ? '…' : ''}`
    })

  const text = dong.join('\n')
  cacheDanhMuc.set(orgId, { at: Date.now(), text })
  return text
}
