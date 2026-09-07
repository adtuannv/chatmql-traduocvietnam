/**
 * product-docs-routes.ts — HTTP cho tài liệu bán hàng theo mã sản phẩm.
 * Đọc: mọi nhân viên. Ghi: owner/admin/manager (giống quyền quản lý sản phẩm).
 */
import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import {
  getProductDoc, getProductDocsByCodes, listProductDocs, upsertProductDoc, deleteProductDoc,
} from './product-docs-service.js'

function canManage(role: string): boolean {
  return ['owner', 'admin', 'manager'].includes(role)
}

export async function productDocRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  /** Tài liệu của nhiều mã cùng lúc: ?codes=A,B,C — dùng cho danh sách. */
  app.get<{ Querystring: { codes?: string; limit?: string } }>(
    '/api/v1/product-docs',
    async (request) => {
      const user = request.user as { orgId: string }
      const codes = (request.query.codes ?? '').split(',').map((c) => c.trim()).filter(Boolean)
      const docs = codes.length
        ? await getProductDocsByCodes(user.orgId, codes)
        : await listProductDocs(user.orgId, Number.parseInt(request.query.limit ?? '200', 10))
      return { docs }
    },
  )

  app.get<{ Params: { code: string } }>('/api/v1/product-docs/:code', async (request) => {
    const user = request.user as { orgId: string }
    const doc = await getProductDoc(user.orgId, request.params.code)
    // Chưa soạn tài liệu không phải là lỗi — trả rỗng để giao diện hiện form trắng.
    return { doc: doc ?? null }
  })

  app.put<{
    Params: { code: string }
    Body: { folderId?: string | null; name?: string | null; description?: string | null; images?: string[]; videoUrls?: string[]; keywords?: string | null }
  }>('/api/v1/product-docs/:code', async (request, reply) => {
    const user = request.user as { orgId: string; id: string; role: string }
    if (!canManage(user.role)) {
      return reply.status(403).send({ error: 'Không có quyền sửa tài liệu bán hàng' })
    }
    try {
      const doc = await upsertProductDoc(user.orgId, request.params.code, request.body ?? {}, user.id)
      return { doc }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không rõ lỗi'
      app.log.error({ err }, '[product-docs] lưu thất bại')
      return reply.status(400).send({ error: msg })
    }
  })

  app.delete<{ Params: { code: string } }>('/api/v1/product-docs/:code', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (!canManage(user.role)) {
      return reply.status(403).send({ error: 'Không có quyền xoá tài liệu bán hàng' })
    }
    const ok = await deleteProductDoc(user.orgId, request.params.code)
    return { deleted: ok }
  })
}
