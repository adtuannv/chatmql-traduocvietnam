/**
 * doc-library-service.ts — Thư viện tài liệu bán hàng: thư mục + tài nguyên.
 *
 * Kho tài nguyên chung do admin dựng: biểu giá, ảnh sản phẩm, ảnh xưởng, video,
 * pdf, văn bản… Một tài nguyên có thể gắn nhiều mã sản phẩm hoặc không gắn mã
 * nào. Khác `product_docs` — bảng đó là tài liệu CHÍNH của đúng một mã.
 *
 * `visibility` quyết định tài nguyên có được gửi ra khách hay không, và được
 * CHẶN trong code chứ không chỉ nhắc trong prompt AI.
 */
import { prisma } from '../../shared/prisma-client.js'

export const ASSET_KINDS = ['product', 'image', 'video', 'pdf', 'doc', 'text', 'link'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const VISIBILITIES = ['sales', 'internal', 'ai_only'] as const
export type Visibility = (typeof VISIBILITIES)[number]

export function isAssetKind(v: string): v is AssetKind {
  return (ASSET_KINDS as readonly string[]).includes(v)
}
export function isVisibility(v: string): v is Visibility {
  return (VISIBILITIES as readonly string[]).includes(v)
}

/** Chuẩn hoá mã sản phẩm giống product-docs, để hai bảng khớp nhau. */
function normCode(code: string): string {
  return code.trim().toUpperCase()
}

// ── Thư mục ───────────────────────────────────────────────────────────

export interface FolderInput {
  name: string
  parentId?: string | null
  description?: string | null
  icon?: string | null
  visibility?: string
  sortOrder?: number
}

export async function listFolders(orgId: string) {
  const [folders, counts] = await Promise.all([
    prisma.docFolder.findMany({ where: { orgId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.docAsset.groupBy({ by: ['folderId'], where: { orgId }, _count: { _all: true } }),
  ])
  const countByFolder = new Map(counts.map((c) => [c.folderId, c._count._all]))
  return folders.map((f) => ({ ...f, assetCount: countByFolder.get(f.id) ?? 0 }))
}

export async function createFolder(orgId: string, input: FolderInput) {
  const name = input.name?.trim()
  if (!name) throw new Error('Tên thư mục không được để trống')
  if (input.parentId) await assertSameOrgFolder(orgId, input.parentId)
  return prisma.docFolder.create({
    data: {
      orgId,
      name,
      parentId: input.parentId ?? null,
      description: input.description ?? null,
      icon: input.icon ?? null,
      visibility: input.visibility && isVisibility(input.visibility) ? input.visibility : 'sales',
      sortOrder: input.sortOrder ?? 0,
    },
  })
}

export async function updateFolder(orgId: string, id: string, input: Partial<FolderInput>) {
  const existing = await prisma.docFolder.findFirst({ where: { id, orgId }, select: { id: true } })
  if (!existing) return null
  // Không cho đặt thư mục làm cha của chính nó (vòng lặp cây).
  if (input.parentId) {
    if (input.parentId === id) throw new Error('Không thể đặt thư mục làm cha của chính nó')
    await assertSameOrgFolder(orgId, input.parentId)
    if (await isDescendant(orgId, id, input.parentId)) {
      throw new Error('Không thể chuyển thư mục vào thư mục con của nó')
    }
  }
  return prisma.docFolder.update({
    where: { id },
    data: {
      name: input.name?.trim() || undefined,
      parentId: input.parentId === undefined ? undefined : input.parentId,
      description: input.description === undefined ? undefined : input.description,
      icon: input.icon === undefined ? undefined : input.icon,
      visibility: input.visibility && isVisibility(input.visibility) ? input.visibility : undefined,
      sortOrder: input.sortOrder ?? undefined,
    },
  })
}

/** Xoá thư mục: tài nguyên bên trong KHÔNG mất, chỉ rơi về "chưa xếp thư mục". */
export async function deleteFolder(orgId: string, id: string): Promise<boolean> {
  const res = await prisma.docFolder.deleteMany({ where: { id, orgId } })
  return res.count > 0
}

async function assertSameOrgFolder(orgId: string, folderId: string) {
  const f = await prisma.docFolder.findFirst({ where: { id: folderId, orgId }, select: { id: true } })
  if (!f) throw new Error('Thư mục cha không tồn tại')
}

/** `maybeChild` có nằm trong cây con của `rootId` không. */
async function isDescendant(orgId: string, rootId: string, maybeChild: string): Promise<boolean> {
  const all = await prisma.docFolder.findMany({ where: { orgId }, select: { id: true, parentId: true } })
  const byId = new Map(all.map((f) => [f.id, f.parentId]))
  let cur: string | null | undefined = maybeChild
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    if (cur === rootId) return true
    seen.add(cur)
    cur = byId.get(cur) ?? null
  }
  return false
}

// ── Tài nguyên ────────────────────────────────────────────────────────

export interface AssetInput {
  folderId?: string | null
  kind?: string
  title?: string
  description?: string | null
  textContent?: string | null
  fileUrl?: string | null
  thumbUrl?: string | null
  images?: string[]
  videoUrls?: string[]
  fileSize?: number | null
  mimeType?: string | null
  sourceUrl?: string | null
  sourceId?: string | null
  productCodes?: string[]
  tags?: string[]
  visibility?: string
}

export interface AssetQuery {
  folderId?: string
  /** 'none' = tài nguyên chưa xếp thư mục. */
  unfiled?: boolean
  kind?: string
  productCode?: string
  q?: string
  visibility?: string
  page?: number
  pageSize?: number
}

export async function listAssets(orgId: string, q: AssetQuery = {}) {
  const page = Math.max(1, q.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50))

  const where: Record<string, unknown> = { orgId }
  if (q.unfiled) where.folderId = null
  else if (q.folderId) where.folderId = q.folderId
  if (q.kind && isAssetKind(q.kind)) where.kind = q.kind
  if (q.visibility && isVisibility(q.visibility)) where.visibility = q.visibility
  if (q.productCode) where.productCodes = { has: normCode(q.productCode) }
  if (q.q?.trim()) {
    const s = q.q.trim()
    where.OR = [
      { title: { contains: s, mode: 'insensitive' } },
      { description: { contains: s, mode: 'insensitive' } },
      { textContent: { contains: s, mode: 'insensitive' } },
      { tags: { has: s } },
    ]
  }

  const [total, items] = await Promise.all([
    prisma.docAsset.count({ where }),
    prisma.docAsset.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return { items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } }
}

export async function createAsset(orgId: string, input: AssetInput, createdById?: string) {
  const title = input.title?.trim()
  if (!title) throw new Error('Tiêu đề không được để trống')
  const kind = input.kind && isAssetKind(input.kind) ? input.kind : 'image'
  // Phải có ít nhất một "nội dung". Loại `product` là tài liệu mô tả mặt hàng
  // nên bộ ảnh / video / mô tả đã đủ, không bắt buộc tệp đính kèm.
  const hasBody = !!(
    input.fileUrl || input.sourceUrl || input.textContent?.trim() ||
    input.images?.length || input.videoUrls?.length || input.description?.trim()
  )
  if (!hasBody) {
    throw new Error('Cần tải tệp, dán link, thêm ảnh/video, hoặc nhập nội dung')
  }
  if (input.folderId) await assertSameOrgFolder(orgId, input.folderId)

  return prisma.docAsset.create({
    data: {
      orgId,
      folderId: input.folderId ?? null,
      kind,
      title,
      description: input.description ?? null,
      textContent: input.textContent ?? null,
      fileUrl: input.fileUrl ?? null,
      thumbUrl: input.thumbUrl ?? null,
      images: input.images ?? [],
      videoUrls: input.videoUrls ?? [],
      fileSize: input.fileSize ?? null,
      mimeType: input.mimeType ?? null,
      sourceUrl: input.sourceUrl ?? null,
      sourceId: input.sourceId ?? null,
      productCodes: (input.productCodes ?? []).map(normCode).filter(Boolean),
      tags: input.tags ?? [],
      visibility: input.visibility && isVisibility(input.visibility) ? input.visibility : 'sales',
      createdById: createdById ?? null,
    },
  })
}

export async function updateAsset(orgId: string, id: string, input: AssetInput) {
  const existing = await prisma.docAsset.findFirst({ where: { id, orgId }, select: { id: true } })
  if (!existing) return null
  if (input.folderId) await assertSameOrgFolder(orgId, input.folderId)

  return prisma.docAsset.update({
    where: { id },
    data: {
      folderId: input.folderId === undefined ? undefined : input.folderId,
      kind: input.kind && isAssetKind(input.kind) ? input.kind : undefined,
      title: input.title?.trim() || undefined,
      description: input.description === undefined ? undefined : input.description,
      textContent: input.textContent === undefined ? undefined : input.textContent,
      fileUrl: input.fileUrl === undefined ? undefined : input.fileUrl,
      thumbUrl: input.thumbUrl === undefined ? undefined : input.thumbUrl,
      images: input.images ?? undefined,
      videoUrls: input.videoUrls ?? undefined,
      sourceUrl: input.sourceUrl === undefined ? undefined : input.sourceUrl,
      productCodes: input.productCodes ? input.productCodes.map(normCode).filter(Boolean) : undefined,
      tags: input.tags ?? undefined,
      visibility: input.visibility && isVisibility(input.visibility) ? input.visibility : undefined,
    },
  })
}

export async function deleteAsset(orgId: string, id: string): Promise<boolean> {
  const res = await prisma.docAsset.deleteMany({ where: { id, orgId } })
  return res.count > 0
}

// ── Truy hồi cho AI ───────────────────────────────────────────────────

export interface DocAssetSnippet {
  id: string
  kind: string
  title: string
  description: string | null
  textContent: string | null
  productCodes: string[]
  /** Có nội dung gửi được cho khách không (ảnh/video/pdf đã có file hoặc link). */
  sendable: boolean
}

/**
 * Tài nguyên liên quan tới câu khách hỏi, dùng cho ngữ cảnh AI.
 * Bỏ hẳn `visibility = internal`: tài nguyên nội bộ không được lọt vào lời tư vấn.
 */
export async function retrieveDocAssets(
  orgId: string,
  query: string,
  limit = 5,
): Promise<DocAssetSnippet[]> {
  const q = query.trim()
  if (!q) return []
  const terms = [...new Set(q.split(/[\s,.;:!?()[\]"']+/).filter((t) => t.length >= 3))].slice(0, 8)
  const needles = terms.length ? terms : [q]

  const rows = await prisma.docAsset.findMany({
    where: {
      orgId,
      visibility: { not: 'internal' },
      OR: needles.flatMap((t) => [
        { title: { contains: t, mode: 'insensitive' as const } },
        { description: { contains: t, mode: 'insensitive' as const } },
        { textContent: { contains: t, mode: 'insensitive' as const } },
        { productCodes: { has: normCode(t) } },
      ]),
    },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(20, Math.max(1, limit)),
  })

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    description: r.description,
    // Chỉ đưa chữ vào prompt; ảnh/video chỉ cần biết là CÓ để đề nghị gửi.
    textContent: r.textContent ? r.textContent.slice(0, 1500) : null,
    productCodes: r.productCodes,
    sendable: r.visibility === 'sales' && !!(r.fileUrl || r.sourceUrl || r.images.length || r.videoUrls.length),
  }))
}
