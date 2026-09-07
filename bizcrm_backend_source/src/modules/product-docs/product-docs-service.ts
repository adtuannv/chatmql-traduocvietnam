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
}

/**
 * Tìm tài liệu liên quan tới câu khách hỏi.
 *
 * Dùng khớp chuỗi (ILIKE) chứ chưa dùng vector: catalog cỡ vài trăm sản phẩm
 * nên khớp tên/mã/từ khoá đã đủ chính xác, lại không phải chạy embedding mỗi
 * lần sửa tài liệu. Khi danh mục phình to thì thêm cột embedding như KB.
 */
export async function retrieveProductDocs(
  orgId: string,
  query: string,
  limit = 5,
): Promise<ProductDocSnippet[]> {
  const q = query.trim()
  if (!q) return []

  // Tách từ khoá để câu dài của khách vẫn khớp được tên sản phẩm ngắn.
  const terms = [...new Set(q.split(/[\s,.;:!?()\[\]"']+/).filter((t) => t.length >= 3))].slice(0, 8)
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
    orderBy: { updatedAt: 'desc' },
    take: Math.min(20, Math.max(1, limit)),
  })

  return rows.map((r) => ({
    productCode: r.productCode,
    name: r.name,
    description: r.description,
    imageCount: r.images.length,
    videoCount: r.videoUrls.length,
  }))
}
