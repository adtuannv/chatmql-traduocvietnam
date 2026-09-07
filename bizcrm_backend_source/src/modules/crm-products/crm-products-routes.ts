/**
 * crm-products-routes.ts — HTTP cho module "Sản phẩm (CRM)".
 * Chỉ đọc: không tạo/sửa/xoá, vì CRM mới là nơi quản lý sản phẩm.
 */
import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/prisma-client.js'
import { searchCrmProducts, listCrmProducts, resolveSource } from './crm-products-client.js'

type NguoiDung = { orgId: string; role: string }

/** Chỉ người quản lý mới được sửa ánh xạ — gửi nhầm link là gửi nhầm cho khách. */
function duocSua(role: string): boolean {
  return ['owner', 'admin', 'manager'].includes(role)
}

export async function crmProductRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  /**
   * Nguồn đang dùng + đã cấu hình chưa — để FE báo đúng nguyên nhân khi lỗi.
   *
   * `miniAppUrlTemplate` là mẫu link Mini App gửi khách, chứa chỗ thay `{code}`
   * (và `{id}` cho hệ thống đánh số thay vì mã). Chưa cấu hình thì trả rỗng để
   * giao diện khoá nút gửi — thà không gửi còn hơn gửi khách một link hỏng.
   */
  app.get('/api/v1/crm-products/source', async () => ({
    source: resolveSource(),
    dashboardConfigured: !!process.env.CRM_DASHBOARD_TOKEN,
    miniAppUrlTemplate: process.env.ZALO_MINIAPP_PRODUCT_URL || '',
  }))

  /** Danh sách để duyệt — không cần gõ từ khoá. */
  app.get<{
    Querystring: { q?: string; warehouseId?: string; category?: string; inStock?: string; page?: string; pageSize?: string }
  }>('/api/v1/crm-products', async (request, reply) => {
    const qy = request.query
    const int = (v?: string) => {
      const n = Number.parseInt(v ?? '', 10)
      return Number.isFinite(n) ? n : undefined
    }
    try {
      return await listCrmProducts({
        orgId: (request.user as { orgId: string }).orgId,
        q: qy.q,
        warehouseId: int(qy.warehouseId),
        category: qy.category || undefined,
        inStockOnly: qy.inStock === 'true',
        page: int(qy.page),
        pageSize: int(qy.pageSize),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không rõ lỗi'
      app.log.error({ err }, '[crm-products] lấy danh sách thất bại')
      const status = /hết hạn|không hợp lệ|401|403/.test(msg) ? 401 : /chưa cấu hình/.test(msg) ? 400 : 502
      return reply.status(status).send({ error: `Không lấy được sản phẩm từ CRM: ${msg}` })
    }
  })

  /**
   * Danh mục sản phẩm bên Zalo Mini App, để giao diện cho chọn thay vì gõ tay
   * một chuỗi như `FX/TP-CC03-100/KR-ZL` — gõ tay là sai chính tả rồi khách
   * bấm vào link hỏng.
   *
   * Danh mục lấy từ hệ quản trị Mini App và cất ở app_settings, cập nhật lại
   * khi bên đó thêm sản phẩm.
   */
  app.get('/api/v1/crm-products/miniapp-catalog', async (request) => {
    const u = request.user as NguoiDung
    const row = await prisma.appSetting.findFirst({
      where: { orgId: u.orgId, settingKey: 'miniapp.catalog' },
      select: { valuePlain: true, updatedAt: true },
    })
    if (!row?.valuePlain) return { items: [], updatedAt: null }
    try {
      return { items: JSON.parse(row.valuePlain), updatedAt: row.updatedAt }
    } catch {
      // Dữ liệu hỏng thì trả rỗng, giao diện vẫn cho gõ tay.
      return { items: [], updatedAt: row.updatedAt }
    }
  })

  /**
   * Ghép hoặc gỡ mã Mini App cho một sản phẩm.
   *
   * Ghi vào `specs` của bảng sản phẩm nội bộ. Khi đổi sang API nguồn chính
   * thức thì ánh xạ này phải chuyển sang bảng riêng của ChatMQL — ghi ngược
   * vào hệ thống nguồn là việc không nên làm.
   */
  app.patch<{ Params: { id: string }; Body: { miniAppId?: string | null } }>(
    '/api/v1/crm-products/:id/miniapp',
    async (request, reply) => {
      const u = request.user as NguoiDung
      if (!duocSua(u.role)) return reply.status(403).send({ error: 'Không có quyền sửa ánh xạ Mini App' })
      if (resolveSource() !== 'local') {
        return reply.status(400).send({
          error: 'Nguồn sản phẩm hiện không phải bảng nội bộ nên chưa lưu được ánh xạ ở đây',
        })
      }

      const sp = await prisma.product.findFirst({
        where: { id: request.params.id, orgId: u.orgId },
        select: { id: true, specs: true },
      })
      if (!sp) return reply.status(404).send({ error: 'Không tìm thấy sản phẩm' })

      const ma = (request.body?.miniAppId ?? '').trim()
      const specs = { ...((sp.specs as Record<string, unknown>) ?? {}) }
      if (ma) specs.miniapp_id = ma
      else delete specs.miniapp_id

      await prisma.product.update({
        where: { id: sp.id },
        data: { specs: specs as Prisma.InputJsonValue },
      })
      return { id: sp.id, miniAppId: ma || null }
    },
  )

  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/v1/crm-products/search',
    async (request, reply) => {
      const q = (request.query.q ?? '').trim()
      const limit = Number.parseInt(request.query.limit ?? '20', 10)
      try {
        return await searchCrmProducts(
          q,
          Number.isFinite(limit) ? limit : 20,
          (request.user as { orgId: string }).orgId,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Không rõ lỗi'
        app.log.error({ err }, '[crm-products] tìm sản phẩm thất bại')
        const status = /hết hạn|không hợp lệ|401|403/.test(msg) ? 401
          : /chưa cấu hình/.test(msg) ? 400
            : 502
        return reply.status(status).send({ error: `Không lấy được sản phẩm từ CRM: ${msg}` })
      }
    },
  )
}
