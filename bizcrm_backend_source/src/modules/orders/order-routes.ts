/**
 * order-routes.ts — API lên đơn cho giao diện chat.
 *
 * Đây là lớp proxy: trình duyệt chỉ nói chuyện với ChatMQL backend bằng JWT
 * nhân viên; backend mới cầm service key gọi sang CRM. Trình duyệt không bao
 * giờ chạm trực tiếp vào CRM nữa — nhờ vậy service key không lộ, không phải
 * mở CORS cho từng domain, và ChatMQL kiểm soát được ai có quyền lên đơn.
 */
import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import { prisma } from '../../shared/prisma-client.js'
import { createOrderAndSync, type CreateOrderInput } from './order-service.js'
import {
  CrmApiError,
  fetchProducts,
  fetchCustomer,
  fetchCustomerOrders,
  getOrderSyncStatus,
  reconcilePendingFm,
  fetchOrderStatuses,
  fetchWarehouses,
  fetchProvinces,
  fetchWards,
  fetchProductCatalog,
  updateCustomerSchedule,
  fetchCustomerPoints,
  fetchPromotions,
  applyPromotion,
  fetchCustomerProducts,
} from './crm-order-client.js'
import { logger } from '../../shared/logger.js'

type AuthUser = { orgId: string; id: string; fullName?: string; email?: string; role?: string }

/** Map lỗi từ CRM sang mã HTTP trả cho trình duyệt, kèm thông điệp tiếng Việt. */
function replyCrmError(reply: any, err: unknown, context: string) {
  if (err instanceof CrmApiError) {
    // 5xx từ CRM là lỗi hạ tầng phía ta, không phải lỗi người dùng nhập sai.
    const status = err.status >= 500 || err.status === 401 || err.status === 503 ? 502 : err.status
    logger.error({ err, status: err.status }, `[orders] ${context}`)
    return reply.status(status).send({ error: err.message, detail: err.detail })
  }
  const msg = err instanceof Error ? err.message : String(err)
  logger.error({ err }, `[orders] ${context}`)
  return reply.status(500).send({ error: `Lỗi hệ thống khi ${context}: ${msg}` })
}

function calculateVipLevel(gmv: number, aov?: number): string {
  const gmvInMillions = (Number(gmv) || 0) / 1_000_000
  let vip = 'VIP 0'
  if (gmvInMillions < 1) {
    vip = 'VIP 0'
  } else if (gmvInMillions < 10) {
    vip = `VIP ${Math.floor(gmvInMillions)}`
  } else if (gmvInMillions < 60) {
    vip = `VIP ${Math.min(Math.floor((gmvInMillions - 10) / 5) + 10, 19)}`
  } else if (gmvInMillions < 160) {
    vip = `VIP ${Math.min(Math.floor((gmvInMillions - 60) / 10) + 20, 29)}`
  } else {
    vip = `VIP ${Math.min(Math.floor((gmvInMillions - 160) / 50) + 30, 39)}`
  }

  const aovVal = Number(aov) || (Number(gmv) || 0)
  let aovClass = 'A'
  if (aovVal < 500_000) aovClass = 'A'
  else if (aovVal < 1_000_000) aovClass = 'B'
  else if (aovVal < 2_000_000) aovClass = 'C'
  else if (aovVal <= 3_000_000) aovClass = 'D'
  else aovClass = 'E'

  return `${vip}${aovClass}`
}


export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  // Mặc định Fastify ném 400 khi POST có Content-Type: application/json mà body
  // rỗng. Nhiều client (axios, fetch dùng header dùng chung) luôn đính header đó
  // kể cả khi không có body — ví dụ /reconcile-fm chỉ nhận tham số qua query.
  // Coi body rỗng là {} thay vì lỗi. Chỉ áp dụng trong phạm vi plugin này.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (!body) return done(null, {})
      try {
        done(null, JSON.parse(body))
      } catch (err: any) {
        err.statusCode = 400
        done(err, undefined)
      }
    },
  )

  // ── Danh mục sản phẩm (proxy sang CRM) ────────────────────────────
  app.get('/api/v1/orders/products', async (_request, reply) => {
    try {
      return await fetchProducts()
    } catch (err) {
      return replyCrmError(reply, err, 'lấy danh mục sản phẩm')
    }
  })

  // ── Hồ sơ khách hàng trong CRM (proxy) ────────────────────────────
  app.get<{ Querystring: { phone?: string } }>(
    '/api/v1/orders/customer',
    async (request, reply) => {
      const phone = request.query.phone?.trim()
      if (!phone) return reply.status(400).send({ error: 'Thiếu tham số phone' })
      try {
        return await fetchCustomer(phone)
      } catch (err) {
        return replyCrmError(reply, err, 'tra cứu khách hàng CRM')
      }
    },
  )

  // ── Lịch sử đơn hàng của khách (proxy) ────────────────────────────
  app.get<{ Querystring: { phone?: string } }>(
    '/api/v1/orders/customer-orders',
    async (request, reply) => {
      const phone = request.query.phone?.trim()
      if (!phone) return reply.status(400).send({ error: 'Thiếu tham số phone' })
      try {
        return await fetchCustomerOrders(phone)
      } catch (err) {
        return replyCrmError(reply, err, 'lấy lịch sử đơn hàng')
      }
    },
  )

  // ── Ngữ cảnh khách hàng của hội thoại đang mở ─────────────────────
  //
  // Giao diện KHÔNG được tự đoán khách là ai bằng cách đọc chữ trên màn hình:
  // cách đó vớ nhầm số điện thoại của khách khác và rơi về tên mặc định, khiến
  // mọi đơn mang chung một thông tin. Ở đây trả về đúng contact gắn với hội
  // thoại, kèm hồ sơ CRM khớp theo số điện thoại nếu có.
  /**
   * Rút số điện thoại từ TÊN hội thoại.
   *
   * Rất nhiều contact Zalo được nhân viên đặt tên kèm số — "Anh Thông Bình Phước
   * 0918587052" — nhưng ô phone của contact vẫn trống, nên hồ sơ CRM không tra
   * được dù khách đã có đầy đủ dữ liệu bên CRM.
   *
   * Cố ý làm CHẶT chứ không vơ vét: chỉ nhận chuỗi số đứng riêng và đúng dạng số
   * di động Việt Nam. Những tên như "Anh Thịnh Hà Nội 084389777117" hay
   * "Mạnh Xít. 10839087874" bị bỏ qua — đoán bừa ở đây nghĩa là mở nhầm hồ sơ
   * của khách khác, tệ hơn nhiều so với việc báo "chưa có số".
   */
  function extractPhoneFromName(name?: string | null): string {
    if (!name) return ''
    const runs = name.match(/\d+/g)
    if (!runs) return ''
    for (const run of runs) {
      // 0xxxxxxxxx — 10 số, đầu số di động hợp lệ
      if (/^0[35789]\d{8}$/.test(run)) return run
      // 84xxxxxxxxx — 11 số
      if (/^84[35789]\d{8}$/.test(run)) return '0' + run.slice(2)
      // xxxxxxxxx — 9 số, thiếu số 0 đầu
      if (/^[35789]\d{8}$/.test(run)) return '0' + run
    }
    return ''
  }

  app.get<{ Querystring: { conversationId?: string } }>(
    '/api/v1/orders/conversation-context',
    async (request, reply) => {
      const user = request.user as AuthUser
      const conversationId = request.query.conversationId?.trim()
      if (!conversationId) {
        return reply.status(400).send({ error: 'Thiếu conversationId' })
      }

      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, orgId: user.orgId },
        select: {
          id: true,
          displayName: true,
          contact: {
            select: {
              id: true, fullName: true, crmName: true, phone: true,
              metadata: true, zaloUid: true,
            },
          },
        },
      })
      if (!conv) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' })

      const c = conv.contact
      const meta = (c?.metadata && typeof c.metadata === 'object')
        ? (c.metadata as Record<string, any>)
        : {}

      // Tên ưu tiên: tên nhân viên đặt > tên gốc > tên hiển thị hội thoại.
      const name = c?.crmName?.trim() || c?.fullName?.trim() || conv.displayName?.trim() || ''
      const storedPhone = c?.phone?.trim() || ''
      const phoneFromName = storedPhone ? '' : extractPhoneFromName(name)
      const phone = storedPhone || phoneFromName

      // Có số điện thoại thì lấy luôn hồ sơ CRM để modal hiện GMV, nhóm KH,
      // gu trà và địa chỉ đã lưu — gộp một lượt để giao diện chỉ gọi 1 lần.
      let crm: any = null
      if (phone) {
        try {
          const res = await fetchCustomer(phone)
          if (res?.found) crm = res.customer
        } catch (err) {
          logger.warn({ err, phone }, '[orders] Không lấy được hồ sơ CRM cho hội thoại')
        }
      }

      return {
        conversationId: conv.id,
        contact: {
          id: c?.id ?? null,
          name,
          phone,
          // Báo cho giao diện biết số này suy ra từ tên chứ không phải nhân viên
          // đã lưu — để còn nhắc người dùng kiểm lại trước khi lên đơn.
          phoneSource: phoneFromName ? 'name' : (storedPhone ? 'contact' : 'none'),
          address: crm?.address || meta.address || '',
          city: crm?.city || meta.city || '',
        },
        crm,
      }
    },
  )

  // ── Đợt 1: dữ liệu tra cứu cho form tạo đơn ───────────────────────
  //
  // Gom về một chỗ để giao diện chỉ gọi một lần khi mở modal, thay vì bốn
  // lượt round-trip riêng lẻ.
  app.get('/api/v1/orders/form-lookups', async (_request, reply) => {
    try {
      const [statuses, warehouses, provinces] = await Promise.all([
        fetchOrderStatuses(),
        fetchWarehouses(),
        fetchProvinces(),
      ])
      return {
        statuses: statuses.statuses,
        warehouses: warehouses.warehouses,
        provinces: provinces.provinces,
      }
    } catch (err) {
      return replyCrmError(reply, err, 'lấy dữ liệu tra cứu cho form đơn')
    }
  })

  // Phường/xã tách riêng vì phụ thuộc tỉnh vừa chọn.
  app.get<{ Querystring: { provinceId?: string } }>(
    '/api/v1/orders/wards',
    async (request, reply) => {
      const id = parseInt(request.query.provinceId || '', 10)
      if (!Number.isFinite(id)) {
        return reply.status(400).send({ error: 'Thiếu hoặc sai provinceId' })
      }
      try {
        return await fetchWards(id)
      } catch (err) {
        return replyCrmError(reply, err, 'lấy danh sách phường/xã')
      }
    },
  )

  // Danh mục sản phẩm đầy đủ: tồn kho, đơn vị, khối lượng, ghi chú VAT.
  app.get<{ Querystring: { warehouseId?: string; q?: string } }>(
    '/api/v1/orders/catalog',
    async (request, reply) => {
      const wid = parseInt(request.query.warehouseId || '', 10)
      try {
        return await fetchProductCatalog({
          warehouseId: Number.isFinite(wid) ? wid : undefined,
          q: request.query.q,
        })
      } catch (err) {
        return replyCrmError(reply, err, 'lấy danh mục sản phẩm')
      }
    },
  )

  // ── Đợt 2: hồ sơ khách hàng ───────────────────────────────────────
  //
  // Gộp dữ liệu hai hệ: contact bên ChatMQL (email, tên hiển thị Zalo, nguồn)
  // và hồ sơ bên CRM (mã KH, nghề nghiệp, GMV, lịch hẹn). Giao diện chỉ gọi
  // một lần khi mở drawer.
  app.get<{ Querystring: { conversationId?: string; phone?: string } }>(
    '/api/v1/orders/customer-profile',
    async (request, reply) => {
      const user = request.user as AuthUser
      const { conversationId, phone: phoneQuery } = request.query

      let contact: any = null
      let phone = phoneQuery?.trim() || ''

      if (conversationId?.trim()) {
        const conv = await prisma.conversation.findFirst({
          where: { id: conversationId.trim(), orgId: user.orgId },
          select: {
            id: true, displayName: true,
            contact: {
              select: {
                id: true, fullName: true, crmName: true, phone: true, email: true,
                source: true, zaloUid: true, metadata: true, leadScore: true,
                lifecycleStage: true, createdAt: true,
              },
            },
          },
        })
        if (!conv) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' })
        contact = conv.contact
        if (!phone) phone = contact?.phone?.trim() || ''
        // Contact chưa lưu số nhưng tên có chôn số — thử rút ra. Nhiều khách đã
        // có đủ hồ sơ bên CRM, chỉ vì ô phone trống mà màn hình báo "chưa có số".
        if (!phone) {
          phone = extractPhoneFromName(
            contact?.crmName || contact?.fullName || conv.displayName,
          )
          if (phone) {
            logger.info(
              { conversationId: conv.id, phone },
              '[orders] Rút số điện thoại từ tên hội thoại để tra hồ sơ CRM',
            )
          }
        }
      }

      if (!phone) {
        return reply.status(400).send({
          error: 'Khách chưa có số điện thoại — chưa tra được hồ sơ CRM',
          contact: contact ? { id: contact.id, name: contact.crmName || contact.fullName } : null,
        })
      }

      // Hồ sơ CRM và lịch sử đơn lấy song song cho nhanh.
      const [crmRes, ordersRes] = await Promise.allSettled([
        fetchCustomer(phone),
        fetchCustomerOrders(phone),
      ])

      if (crmRes.status === 'rejected') {
        return replyCrmError(reply, crmRes.reason, 'lấy hồ sơ khách hàng')
      }
      if (ordersRes.status === 'rejected') {
        logger.warn({ err: ordersRes.reason, phone }, '[orders] Không lấy được lịch sử đơn')
      }

      const orders = ordersRes.status === 'fulfilled' ? ordersRes.value.orders || [] : []
      const meta = (contact?.metadata && typeof contact.metadata === 'object')
        ? (contact.metadata as Record<string, any>)
        : {}

      // Chuẩn hoá dữ liệu CRM về đúng tên trường frontend đọc.
      // CRM bridge trả `appointment: { date, type, note }` thay vì
      // `next_sales_at` / `next_care_at` riêng — cần map lại.
      const rawCrm = crmRes.value?.found ? crmRes.value.customer : null
      let crm: Record<string, any> | null = null
      if (rawCrm) {
        const appt = rawCrm.appointment || {}
        const apptType = (appt.type || '').toLowerCase()
        crm = {
          ...rawCrm,
          // Map appointment → next_sales_at / next_care_at
          next_sales_at: apptType.includes('bán') ? appt.date : rawCrm.next_sales_at || null,
          next_care_at: apptType.includes('chăm') || apptType.includes('cskh') ? appt.date : rawCrm.next_care_at || null,
          // Trường frontend cần nhưng CRM bridge chưa trả
          customer_code: rawCrm.customer_code || (rawCrm.id_kh ? `KH${rawCrm.id_kh}` : null),
          phone2: rawCrm.phone2 || rawCrm.sdt2 || null,
          purchase_frequency: rawCrm.purchase_frequency || rawCrm.tan_suat_mua || null,
          profile_note: rawCrm.profile_note || rawCrm.ghi_chu || '',
          nhom_kh: rawCrm.nhom_kh || rawCrm.priority_level || null,
          cap_vip: (rawCrm.cap_vip && !/^(FT|KT|NC|PL|KD|KL)\d/i.test(rawCrm.cap_vip))
            ? rawCrm.cap_vip
            : calculateVipLevel(rawCrm.gmv_total || rawCrm.gmv || 0, rawCrm.aov || 0),
        }
      }

      return {
        phone,
        // Phần ChatMQL nắm giữ — CRM không có email hay tên hiển thị Zalo.
        chatmql: contact ? {
          id: contact.id,
          crmName: contact.crmName || null,
          zaloName: contact.fullName || null,
          email: contact.email || null,
          source: contact.source || null,
          leadScore: contact.leadScore ?? 0,
          lifecycleStage: contact.lifecycleStage || null,
          firstSeenAt: contact.createdAt,
          address: meta.address || null,
        } : null,
        crm,
        orders,
      }
    },
  )

  // Đặt lịch tiếp cận bán hàng / chăm sóc kế tiếp.
  app.post<{
    Body: { phone?: string; nextSalesAt?: string; nextCareAt?: string; appointmentType?: string; careNote?: string }
  }>('/api/v1/orders/customer-schedule', async (request, reply) => {
    const b = request.body || {}
    const phone = b.phone?.trim()
    if (!phone) return reply.status(400).send({ error: 'Thiếu số điện thoại khách hàng' })

    try {
      const result = await updateCustomerSchedule({
        phone,
        next_sales_at: b.nextSalesAt,
        next_care_at: b.nextCareAt,
        appointment_type: b.appointmentType,
        care_note: b.careNote,
      })
      logger.info({ phone, userId: (request.user as AuthUser).id }, '[orders] Cập nhật lịch khách hàng')
      return result
    } catch (err) {
      return replyCrmError(reply, err, 'cập nhật lịch khách hàng')
    }
  })

  // ── Đợt 4: dòng thời gian hoạt động của khách ─────────────────────
  //
  // ActivityLog của hệ thống KHÔNG dùng được cho việc này: 1.745/1.754 bản ghi
  // là log chạy automation, không có bản ghi nào gắn với khách hàng. Nên dòng
  // thời gian được gom từ những nguồn thật sự phản ánh tương tác với khách:
  // tin nhắn, ghi chú, lịch hẹn, sự kiện CDP, đổi vòng đời, và đơn hàng CRM.
  app.get<{
    Querystring: { conversationId?: string; q?: string; types?: string; limit?: string }
  }>('/api/v1/orders/customer-activity', async (request, reply) => {
    const user = request.user as AuthUser
    const conversationId = request.query.conversationId?.trim()
    if (!conversationId) return reply.status(400).send({ error: 'Thiếu conversationId' })

    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, orgId: user.orgId },
      select: { id: true, contactId: true, contact: { select: { phone: true } } },
    })
    if (!conv) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' })

    const contactId = conv.contactId
    const phone = conv.contact?.phone?.trim()
    const limit = Math.min(200, Math.max(10, parseInt(request.query.limit || '80', 10)))
    const wanted = request.query.types?.split(',').map(t => t.trim()).filter(Boolean)
    const want = (t: string) => !wanted?.length || wanted.includes(t)

    type Item = {
      id: string
      type: 'message' | 'note' | 'appointment' | 'event' | 'lifecycle' | 'order'
      at: Date
      title: string
      detail: string | null
      meta?: Record<string, unknown>
    }
    const items: Item[] = []

    // Chạy song song — các nguồn độc lập nhau.
    const [messages, notes, appts, events, lifecycles] = await Promise.all([
      want('message')
        ? prisma.message.findMany({
            where: { conversationId: conv.id, isDeleted: false },
            orderBy: { sentAt: 'desc' }, take: limit,
            select: {
              id: true, senderType: true, senderName: true, content: true,
              contentType: true, sentAt: true, aiGenerated: true,
            },
          })
        : [],
      want('note') && contactId
        ? prisma.note.findMany({
            where: { orgId: user.orgId, OR: [{ contactId }, { conversationId: conv.id }] },
            orderBy: { createdAt: 'desc' }, take: limit,
            select: {
              id: true, content: true, status: true, createdAt: true,
              createdBy: { select: { fullName: true } },
            },
          })
        : [],
      want('appointment') && contactId
        ? prisma.appointment.findMany({
            where: { orgId: user.orgId, contactId },
            orderBy: { appointmentDate: 'desc' }, take: 50,
            select: { id: true, appointmentDate: true, type: true, status: true, notes: true },
          })
        : [],
      want('event') && contactId
        ? prisma.cdpEvent.findMany({
            where: { orgId: user.orgId, contactId },
            orderBy: { timestamp: 'desc' }, take: 50,
            select: { id: true, eventName: true, properties: true, timestamp: true, source: true },
          })
        : [],
      want('lifecycle') && contactId
        ? prisma.lifecycleLog.findMany({
            where: { orgId: user.orgId, contactId },
            orderBy: { createdAt: 'desc' }, take: 50,
            select: { id: true, fromStage: true, toStage: true, reason: true, createdAt: true },
          })
        : [],
    ])

    for (const m of messages as any[]) {
      const who = m.senderType === 'contact' ? 'Khách' : (m.aiGenerated ? 'AI' : (m.senderName || 'Nhân viên'))
      // Ảnh/file lưu content dạng JSON — hiện nhãn thay vì đổ JSON thô ra màn hình.
      let body = m.content || ''
      if (m.contentType !== 'text' && body.trim().startsWith('{')) {
        try { body = JSON.parse(body).caption || JSON.parse(body).title || `[${m.contentType}]` }
        catch { body = `[${m.contentType}]` }
      }
      items.push({
        id: `msg:${m.id}`, type: 'message', at: m.sentAt,
        title: `${who} ${m.senderType === 'contact' ? 'nhắn' : 'gửi'}`,
        detail: body.slice(0, 300),
        meta: { contentType: m.contentType, aiGenerated: m.aiGenerated },
      })
    }

    for (const n of notes as any[]) {
      items.push({
        id: `note:${n.id}`, type: 'note', at: n.createdAt,
        title: `Ghi chú${n.createdBy?.fullName ? ` — ${n.createdBy.fullName}` : ''}`,
        detail: (n.content || '').slice(0, 300),
        meta: { status: n.status },
      })
    }

    for (const a of appts as any[]) {
      items.push({
        id: `appt:${a.id}`, type: 'appointment', at: a.appointmentDate,
        title: `Lịch hẹn ${a.type || ''}`.trim(),
        detail: a.notes || null,
        meta: { status: a.status },
      })
    }

    for (const e of events as any[]) {
      items.push({
        id: `evt:${e.id}`, type: 'event', at: e.timestamp,
        title: e.eventName,
        detail: e.properties && typeof e.properties === 'object'
          ? Object.entries(e.properties as Record<string, unknown>)
              .slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')
          : null,
        meta: { source: e.source },
      })
    }

    for (const l of lifecycles as any[]) {
      items.push({
        id: `lc:${l.id}`, type: 'lifecycle', at: l.createdAt,
        title: `Vòng đời: ${l.fromStage || '—'} → ${l.toStage}`,
        detail: l.reason || null,
      })
    }

    // Đơn hàng nằm bên CRM, lấy qua proxy. Hỏng ở đây không làm hỏng cả dòng
    // thời gian — các nguồn còn lại vẫn hiện.
    if (want('order') && phone) {
      try {
        const res = await fetchCustomerOrders(phone)
        for (const o of res.orders || []) {
          items.push({
            id: `ord:${o.order_code}`, type: 'order',
            at: new Date(o.created_at),
            title: `Đơn hàng ${o.order_code}`,
            detail: `${Math.round(o.total_amount || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ · ${o.status || ''}`.trim(),
            meta: { orderCode: o.order_code, status: o.status, amount: o.total_amount },
          })
        }
      } catch (err) {
        logger.warn({ err, phone }, '[orders] Không lấy được đơn hàng cho dòng thời gian')
      }
    }

    // Lọc theo từ khoá sau khi gom, để tìm được trên cả 6 nguồn cùng lúc.
    const q = request.query.q?.trim().toLowerCase()
    const filtered = q
      ? items.filter(i =>
          i.title.toLowerCase().includes(q) || (i.detail || '').toLowerCase().includes(q))
      : items

    filtered.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

    const counts: Record<string, number> = {}
    for (const i of items) counts[i.type] = (counts[i.type] || 0) + 1

    return { items: filtered.slice(0, limit), total: filtered.length, counts }
  })

  // ── Đợt 5: điểm thưởng & ưu đãi ───────────────────────────────────
  app.get<{ Querystring: { phone?: string } }>(
    '/api/v1/orders/customer-products',
    async (request, reply) => {
      const phone = request.query.phone?.trim()
      if (!phone) return reply.status(400).send({ error: 'Thiếu số điện thoại' })
      try { return await fetchCustomerProducts(phone) }
      catch (err) { return replyCrmError(reply, err, 'lấy sản phẩm đã mua') }
    },
  )

  app.get<{ Querystring: { phone?: string } }>(
    '/api/v1/orders/customer-points',
    async (request, reply) => {
      const phone = request.query.phone?.trim()
      if (!phone) return reply.status(400).send({ error: 'Thiếu số điện thoại' })
      try {
        return await fetchCustomerPoints(phone)
      } catch (err) {
        return replyCrmError(reply, err, 'lấy sổ cái tích điểm')
      }
    },
  )

  app.get<{ Querystring: { phone?: string } }>(
    '/api/v1/orders/promotions',
    async (request, reply) => {
      try {
        return await fetchPromotions(request.query.phone?.trim() || undefined)
      } catch (err) {
        return replyCrmError(reply, err, 'lấy danh sách ưu đãi')
      }
    },
  )

  app.post<{ Body: { code?: string; phone?: string; orderSubtotal?: number } }>(
    '/api/v1/orders/promotions/apply',
    async (request, reply) => {
      const b = request.body || {}
      if (!b.code?.trim()) return reply.status(400).send({ error: 'Chưa nhập mã ưu đãi' })
      try {
        return await applyPromotion({
          code: b.code.trim(),
          phone: b.phone?.trim() || undefined,
          order_subtotal: Number(b.orderSubtotal) || 0,
        })
      } catch (err) {
        return replyCrmError(reply, err, 'áp mã ưu đãi')
      }
    },
  )

  // ── Thư viện hội thoại: ảnh/video, file, link đã trao đổi ─────────
  //
  // Khác với thư viện tài liệu (/api/v1/library) — cái đó là kho nội dung đã
  // duyệt để GỬI cho khách. Cái này là những gì ĐÃ trao đổi trong chính cuộc
  // hội thoại, để tìm lại nhanh mà không phải cuộn ngược hàng trăm tin.
  app.get<{
    Querystring: { conversationId?: string; kind?: string; limit?: string }
  }>('/api/v1/orders/conversation-library', async (request, reply) => {
    const user = request.user as AuthUser
    const conversationId = request.query.conversationId?.trim()
    if (!conversationId) return reply.status(400).send({ error: 'Thiếu conversationId' })

    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, orgId: user.orgId },
      select: { id: true },
    })
    if (!conv) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' })

    const kind = request.query.kind?.trim() || 'media'   // media | file | link
    const limit = Math.min(300, Math.max(10, parseInt(request.query.limit || '120', 10)))

    const TYPES: Record<string, string[]> = {
      media: ['image', 'video', 'gif'],
      file: ['file', 'voice'],
    }

    const rows = await prisma.message.findMany({
      where: {
        conversationId: conv.id,
        isDeleted: false,
        ...(kind === 'link'
          // Link nằm trong nội dung text, không có contentType riêng.
          ? { content: { contains: 'http' } }
          : { contentType: { in: TYPES[kind] || TYPES.media } }),
      },
      orderBy: { sentAt: 'desc' },
      take: kind === 'link' ? limit * 2 : limit,
      select: {
        id: true, contentType: true, content: true, sentAt: true,
        senderType: true, senderName: true,
      },
    })

    type Item = {
      id: string; kind: string; at: Date; sender: string
      url: string | null; title: string | null; size: string | null; host?: string
    }
    const items: Item[] = []
    const LINK_RE = /https?:\/\/[^\s<>"')]+/gi

    for (const m of rows) {
      const sender = m.senderType === 'contact' ? 'Khách' : (m.senderName || 'Nhân viên')

      if (kind === 'link') {
        const found = (m.content || '').match(LINK_RE) || []
        for (const url of found) {
          let host = url
          try { host = new URL(url).host } catch { /* URL méo — giữ nguyên chuỗi */ }
          items.push({
            id: `${m.id}:${items.length}`, kind: 'link', at: m.sentAt, sender,
            url, title: url.length > 90 ? url.slice(0, 90) + '…' : url, size: null, host,
          })
          if (items.length >= limit) break
        }
        if (items.length >= limit) break
        continue
      }

      // Ảnh/video/file lưu content dạng JSON — bóc ra thay vì đổ JSON thô.
      let url: string | null = null
      let title: string | null = null
      let size: string | null = null
      const raw = (m.content || '').trim()
      if (raw.startsWith('{')) {
        try {
          const j = JSON.parse(raw)
          url = j.href || j.url || j.thumb || null
          title = j.title || j.caption || j.fileName || null
          if (j.fileSize) {
            const n = Number(j.fileSize)
            size = Number.isFinite(n) && n > 0
              ? (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)
              : String(j.fileSize)
          }
        } catch { title = raw.slice(0, 80) }
      } else {
        title = raw.slice(0, 80) || null
      }

      items.push({ id: m.id, kind: m.contentType, at: m.sentAt, sender, url, title, size })
    }

    // Gom theo ngày, đúng như thiết kế hiển thị "Ngày 18 Tháng 8".
    const groups = new Map<string, Item[]>()
    for (const i of items) {
      const d = new Date(i.at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(i)
    }

    // Đếm cho từng tab để hiện số ngay trên nhãn.
    const [mediaCount, fileCount, linkCount] = await Promise.all([
      prisma.message.count({ where: { conversationId: conv.id, isDeleted: false, contentType: { in: TYPES.media } } }),
      prisma.message.count({ where: { conversationId: conv.id, isDeleted: false, contentType: { in: TYPES.file } } }),
      prisma.message.count({ where: { conversationId: conv.id, isDeleted: false, content: { contains: 'http' } } }),
    ])

    return {
      groups: [...groups.entries()].map(([date, list]) => ({ date, items: list })),
      total: items.length,
      counts: { media: mediaCount, file: fileCount, link: linkCount },
    }
  })

  // ── Tạo đơn ───────────────────────────────────────────────────────
  app.post<{
    Body: Omit<CreateOrderInput, 'orgId' | 'createdUserId' | 'source'> & { aiPendingActionId?: string }
  }>('/api/v1/orders/create', async (request, reply) => {
    const user = request.user as AuthUser
    const body = request.body

    if (!body?.customerName?.trim() || !body?.customerPhone?.trim()) {
      return reply.status(400).send({
        success: false,
        error: 'Thiếu tên hoặc số điện thoại khách hàng',
      })
    }
    if (!body?.shippingAddress?.trim()) {
      return reply.status(400).send({ success: false, error: 'Thiếu địa chỉ giao hàng' })
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return reply.status(400).send({ success: false, error: 'Đơn hàng phải có ít nhất 1 sản phẩm' })
    }

    // Hội thoại và contact phải thuộc đúng org của người đang đăng nhập.
    // Không tin dữ liệu client gửi lên: nếu không khớp thì bỏ qua, đơn vẫn
    // được tạo trên CRM nhưng không đính vào hội thoại của tổ chức khác.
    let conversationId: string | undefined
    let contactId: string | undefined

    if (body.conversationId) {
      const conv = await prisma.conversation.findFirst({
        where: { id: body.conversationId, orgId: user.orgId },
        select: { id: true, contactId: true },
      })
      if (conv) {
        conversationId = conv.id
        contactId = conv.contactId ?? undefined
      } else {
        logger.warn(
          { conversationId: body.conversationId, orgId: user.orgId },
          '[orders] conversationId không thuộc org — bỏ qua',
        )
      }
    }

    // contactId client gửi lên chỉ được dùng khi thực sự thuộc org.
    if (body.contactId) {
      const contact = await prisma.contact.findFirst({
        where: { id: body.contactId, orgId: user.orgId },
        select: { id: true },
      })
      if (contact) contactId = contact.id
    }

    // Cờ nguồn đơn cho báo cáo Chat → Đơn: đơn chỉ được tính là 'ai' khi
    // client gửi kèm aiPendingActionId trỏ tới một nháp đơn AI THẬT của org
    // (AiPendingAction type=create_order). Không tin cờ tự khai từ trình duyệt.
    // Lưu ý: confirmAction() ở pending-action-service.ts hiện chỉ đánh dấu
    // confirmed chứ KHÔNG tự tạo đơn — luồng dự kiến là FE prefill form từ
    // payload nháp rồi gọi route này kèm aiPendingActionId.
    let orderSource: 'ai' | 'staff' = 'staff'
    if (body.aiPendingActionId) {
      const pendingAi = await prisma.aiPendingAction.findFirst({
        where: { id: body.aiPendingActionId, orgId: user.orgId, type: 'create_order' },
        select: { id: true },
      })
      if (pendingAi) orderSource = 'ai'
    }

    try {
      const result = await createOrderAndSync({
        ...body,
        conversationId,
        contactId,
        orgId: user.orgId,
        createdUserId: user.id,
        source: orderSource,
        // Người lên đơn LUÔN là người đang đăng nhập, lấy từ JWT.
        //
        // Trước đây lấy body.sellerName do trình duyệt gửi lên, mà giao diện lại
        // gửi "nhân sự đang chăm sóc khách" đọc từ CRM — nên đơn bị ghi cho
        // người khác chứ không phải người bấm nút. Danh tính người tạo đơn cũng
        // không phải thứ trình duyệt được quyền tự khai.
        sellerName: body.sellerName || user.fullName || user.email || 'Trà Dược CSKH',
        sellerUsername: user.email?.split('@')[0] || undefined,
      })

      logger.info(
        {
          orderCode: result.order_code,
          userId: user.id,
          orgId: user.orgId,
          status: result.status,
        },
        '[orders] Nhân viên lên đơn',
      )

      // FM chưa đồng bộ: đơn vẫn hợp lệ nhưng client PHẢI biết để hiện cảnh báo.
      // 207 = Multi-Status: một phần thành công.
      return reply.status(result.status === 'partial' ? 207 : 200).send(result)
    } catch (err) {
      return replyCrmError(reply, err, 'tạo đơn hàng')
    }
  })

  // ── Trạng thái đồng bộ của một đơn ────────────────────────────────
  app.get<{ Params: { orderCode: string } }>(
    '/api/v1/orders/:orderCode/status',
    async (request, reply) => {
      try {
        return await getOrderSyncStatus(request.params.orderCode)
      } catch (err) {
        return replyCrmError(reply, err, 'tra trạng thái đơn')
      }
    },
  )

  // ── Đẩy lại các đơn còn kẹt ở FM (chỉ quản trị) ───────────────────
  app.post<{ Querystring: { limit?: string } }>(
    '/api/v1/orders/reconcile-fm',
    async (request, reply) => {
      const user = request.user as AuthUser
      if (user.role && !['owner', 'admin', 'manager'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ quản trị viên được chạy đối soát' })
      }
      const limit = Math.min(200, Math.max(1, parseInt(request.query.limit || '20', 10)))
      try {
        return await reconcilePendingFm(limit)
      } catch (err) {
        return replyCrmError(reply, err, 'đối soát FM')
      }
    },
  )
}
