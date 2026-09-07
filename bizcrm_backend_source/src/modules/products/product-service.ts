/**
 * product-service.ts — Product catalog CRUD (org-scoped).
 * orgId is always the first arg → forces the company filter.
 * Embedding (pgvector) is auto-enqueued on create + on update of EMBED_FIELDS
 * (see enqueueProductEmbed); storage + semantic search live in product-embedding.ts.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../shared/prisma-client.js'
import { enqueueProductEmbed } from '../../shared/queue.js'
import { uniqueSlug } from './slug.js'
import { logger } from '../../shared/logger.js'

const EMBED_FIELDS = ['name', 'keywords', 'description'] as const

const SELECT = {
  id: true, categoryId: true, name: true, code: true, slug: true,
  description: true, notes: true, keywords: true, tags: true,
  priceType: true, price: true, priceMax: true, currency: true, specs: true,
  images: true, videoUrls: true, status: true, sortOrder: true, source: true,
  createdAt: true, updatedAt: true,
  category: { select: { id: true, name: true } },
} as const

type Row = Record<string, unknown> & { price?: Prisma.Decimal | null; priceMax?: Prisma.Decimal | null }

function serialize<T extends Row>(p: T) {
  return {
    ...p,
    price: p.price != null ? Number(p.price) : null,
    priceMax: p.priceMax != null ? Number(p.priceMax) : null,
  }
}

export type ProductListQuery = {
  search?: string
  categoryId?: string
  status?: string
  page?: number
  pageSize?: number
}

export async function listProducts(orgId: string, q: ProductListQuery = {}) {
  const page = Math.max(1, q.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20))
  const where: Prisma.ProductWhereInput = { orgId }
  if (q.status) where.status = q.status
  if (q.categoryId) where.categoryId = q.categoryId
  if (q.search?.trim()) {
    const s = q.search.trim()
    where.OR = [
      { name: { contains: s, mode: 'insensitive' } },
      { code: { contains: s, mode: 'insensitive' } },
      { keywords: { contains: s, mode: 'insensitive' } },
    ]
  }
  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize, take: pageSize, select: SELECT,
    }),
  ])
  return { items: items.map(serialize), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } }
}

export async function getProduct(orgId: string, id: string) {
  const p = await prisma.product.findFirst({ where: { id, orgId }, select: SELECT })
  return p ? serialize(p) : null
}

export type ProductInput = {
  name: string
  categoryId?: string | null
  code?: string | null
  description?: string | null
  notes?: string | null
  keywords?: string | null
  tags?: string[]
  priceType?: string
  price?: number | null
  priceMax?: number | null
  currency?: string
  specs?: unknown
  images?: string[]
  videoUrls?: string[]
  status?: string
  sortOrder?: number
  source?: string
}

export async function createProduct(orgId: string, data: ProductInput, createdById?: string, opts: { skipEmbed?: boolean } = {}) {
  if (data.categoryId) await assertSameOrgCategory(orgId, data.categoryId)
  const slug = await uniqueSlug(orgId, data.name, 'product')
  try {
    const p = await prisma.product.create({
      data: {
        orgId,
        name: data.name,
        slug,
        categoryId: data.categoryId ?? null,
        code: data.code?.trim() || null,
        description: data.description ?? null,
        notes: data.notes ?? null,
        keywords: data.keywords ?? null,
        tags: data.tags ?? [],
        priceType: data.priceType ?? 'fixed',
        price: data.price != null ? new Prisma.Decimal(data.price) : null,
        priceMax: data.priceMax != null ? new Prisma.Decimal(data.priceMax) : null,
        currency: data.currency ?? 'VND',
        specs: (data.specs ?? {}) as object,
        images: data.images ?? [],
        videoUrls: data.videoUrls ?? [],
        status: data.status ?? 'active',
        sortOrder: data.sortOrder ?? 0,
        source: data.source ?? 'manual',
        createdById: createdById ?? null,
      },
      select: SELECT,
    })
    // Single add → embed now (one product = one call). Bulk import passes
    // skipEmbed and batches all rows in one pass (see importProducts).
    if (!opts.skipEmbed) {
      enqueueProductEmbed(orgId, p.id).catch((err) => {
        logger.warn({ err: err?.message, orgId, productId: p.id }, '[product] enqueue embed failed')
      })
    }
    return serialize(p)
  } catch (err) {
    throw mapDup(err)
  }
}

export async function updateProduct(orgId: string, id: string, data: Partial<ProductInput>, opts: { skipEmbed?: boolean } = {}) {
  const existing = await prisma.product.findFirst({ where: { id, orgId }, select: { id: true } })
  if (!existing) return null
  if (data.categoryId) await assertSameOrgCategory(orgId, data.categoryId)
  const patch: Prisma.ProductUpdateInput = {}
  const d = data
  if (d.name !== undefined) patch.name = d.name
  if (d.categoryId !== undefined) patch.category = d.categoryId ? { connect: { id: d.categoryId } } : { disconnect: true }
  if (d.code !== undefined) patch.code = d.code?.trim() || null
  if (d.description !== undefined) patch.description = d.description
  if (d.notes !== undefined) patch.notes = d.notes
  if (d.keywords !== undefined) patch.keywords = d.keywords
  if (d.tags !== undefined) patch.tags = d.tags
  if (d.priceType !== undefined) patch.priceType = d.priceType
  if (d.price !== undefined) patch.price = d.price != null ? new Prisma.Decimal(d.price) : null
  if (d.priceMax !== undefined) patch.priceMax = d.priceMax != null ? new Prisma.Decimal(d.priceMax) : null
  if (d.currency !== undefined) patch.currency = d.currency
  if (d.specs !== undefined) patch.specs = d.specs as object
  if (d.images !== undefined) patch.images = d.images
  if (d.videoUrls !== undefined) patch.videoUrls = d.videoUrls
  if (d.status !== undefined) patch.status = d.status
  if (d.sortOrder !== undefined) patch.sortOrder = d.sortOrder
  try {
    const p = await prisma.product.update({ where: { id }, data: patch, select: SELECT })
    if (!opts.skipEmbed && EMBED_FIELDS.some((f) => (d as Record<string, unknown>)[f] !== undefined)) {
      enqueueProductEmbed(orgId, id).catch((err) => {
        logger.warn({ err: err?.message, orgId, productId: id }, '[product] enqueue embed failed')
      })
    }
    return serialize(p)
  } catch (err) {
    throw mapDup(err)
  }
}

export async function deleteProduct(orgId: string, id: string): Promise<boolean> {
  const existing = await prisma.product.findFirst({ where: { id, orgId }, select: { id: true } })
  if (!existing) return false
  // Detach linked knowledge entries (keep them as general knowledge), then delete.
  await prisma.$transaction([
    prisma.knowledgeEntry.updateMany({ where: { productId: id, orgId }, data: { productId: null } }),
    prisma.product.delete({ where: { id } }),
  ])
  return true
}

async function assertSameOrgCategory(orgId: string, categoryId: string) {
  const cat = await prisma.productCategory.findFirst({ where: { id: categoryId, orgId }, select: { id: true } })
  if (!cat) throw httpError('Danh mục không hợp lệ', 400)
}

function mapDup(err: unknown): Error {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return httpError('Mã sản phẩm (SKU) đã tồn tại trong công ty', 409, 'CODE_TAKEN')
  }
  return err as Error
}

function httpError(message: string, statusCode: number, code?: string) {
  const err = new Error(message) as Error & { statusCode: number; code?: string }
  err.statusCode = statusCode
  if (code) err.code = code
  return err
}
