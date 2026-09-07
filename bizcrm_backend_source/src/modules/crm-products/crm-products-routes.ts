/**
 * crm-products-routes.ts — HTTP cho module "Sản phẩm (CRM)".
 * Chỉ đọc: không tạo/sửa/xoá, vì CRM mới là nơi quản lý sản phẩm.
 */
import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/prisma-client.js'
import {
  searchCrmProducts, listCrmProducts, resolveSource, resolveSourceFor,
  nguonDaChon, luuNguon, CAC_NGUON, type CrmProductSource,
} from './crm-products-client.js'

type NguoiDung = { orgId: string; role: string; id: string }

/** Chỉ người quản lý mới được sửa ánh xạ — gửi nhầm link là gửi nhầm cho khách. */
function duocSua(role: string): boolean {
  return ['owner', 'admin', 'manager'].includes(role)
}

/** Đổi nguồn ảnh hưởng toàn tổ chức nên hẹp hơn: chỉ chủ và quản trị. */
function canEditSource(role: string): boolean {
  return ['owner', 'admin'].includes(role)
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
  app.get('/api/v1/crm-products/source', async (request) => {
    const u = request.user as NguoiDung
    return {
      source: await resolveSourceFor(u.orgId),
      /** Nguồn quản trị đã chọn; null = đang theo cấu hình máy chủ. */
      chosenSource: await nguonDaChon(u.orgId),
      envSource: resolveSource(),
      sources: CAC_NGUON,
      dashboardConfigured: !!process.env.CRM_DASHBOARD_TOKEN,
      officialConfigured: !!(process.env.FM_PRODUCT_API_URL && process.env.FM_PRODUCT_API_KEY),
      miniAppUrlTemplate: process.env.ZALO_MINIAPP_PRODUCT_URL || '',
      canEdit: canEditSource(u.role),
    }
  })

  /**
   * Đổi nguồn sản phẩm ngay trong giao diện.
   *
   * Trước đây phải sửa tệp cấu hình rồi khởi động lại máy chủ — chỉ kỹ thuật
   * làm được, trong khi đây là quyết định vận hành. Từ chối nguồn chưa đủ cấu
   * hình thay vì nhận rồi để danh sách trống mà không rõ lý do.
   */
  app.put<{ Body: { source: string | null } }>('/api/v1/crm-products/source', async (request, reply) => {
    const u = request.user as NguoiDung
    if (!canEditSource(u.role)) return reply.status(403).send({ error: 'Không có quyền đổi nguồn sản phẩm' })

    const nguon = request.body?.source
    if (nguon === null || nguon === '') {
      await luuNguon(u.orgId, '' as CrmProductSource).catch(() => {})
      return { source: await resolveSourceFor(u.orgId), chosenSource: null }
    }
    if (!CAC_NGUON.includes(nguon as CrmProductSource)) {
      return reply.status(400).send({ error: `Nguồn không hợp lệ. Chọn một trong: ${CAC_NGUON.join(', ')}` })
    }
    if (nguon === 'official' && !(process.env.FM_PRODUCT_API_URL && process.env.FM_PRODUCT_API_KEY)) {
      return reply.status(400).send({ error: 'Chưa cấu hình địa chỉ và khoá của hệ thống sản phẩm chính thức trên máy chủ' })
    }
    if (nguon === 'dashboard' && !process.env.CRM_DASHBOARD_TOKEN) {
      return reply.status(400).send({ error: 'Chưa cấu hình token dashboard CRM trên máy chủ' })
    }

    await luuNguon(u.orgId, nguon as CrmProductSource)
    return { source: await resolveSourceFor(u.orgId), chosenSource: nguon }
  })

  /** Danh sách để duyệt — không cần gõ từ khoá. */
  app.get<{
    Querystring: { q?: string; warehouseId?: string; category?: string; page?: string; pageSize?: string }
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
   * Ghép hoặc gỡ mã Mini App cho một sản phẩm, khoá theo MÃ sản phẩm.
   *
   * Trước đây ghi vào bảng sản phẩm nội bộ nên đổi sang nguồn chính thức là
   * không lưu được, và công ghép cũng mất theo nguồn. Nay lưu vào tài liệu sản
   * phẩm của ChatMQL — ánh xạ này là tri thức của mình, phải sống độc lập với
   * nguồn đang bật.
   */
  app.patch<{ Params: { code: string }; Body: { miniAppId?: string | null } }>(
    '/api/v1/crm-products/:code/miniapp',
    async (request, reply) => {
      const u = request.user as NguoiDung
      if (!duocSua(u.role)) return reply.status(403).send({ error: 'Không có quyền sửa ánh xạ Mini App' })

      const ma = decodeURIComponent(request.params.code || '').trim().toUpperCase()
      if (!ma) return reply.status(400).send({ error: 'Sản phẩm chưa có mã nên chưa ghép được link' })

      const giaTri = (request.body?.miniAppId ?? '').trim() || null
      const doc = await prisma.productDoc.upsert({
        where: { orgId_productCode: { orgId: u.orgId, productCode: ma } },
        update: { miniAppId: giaTri, updatedById: u.id },
        create: { orgId: u.orgId, productCode: ma, miniAppId: giaTri, updatedById: u.id },
        select: { productCode: true, miniAppId: true },
      })
      return { code: doc.productCode, miniAppId: doc.miniAppId }
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
