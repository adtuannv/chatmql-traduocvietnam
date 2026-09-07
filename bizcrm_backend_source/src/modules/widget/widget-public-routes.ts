/**
 * widget-public-routes.ts — API CÔNG KHAI cho nút chat nhúng trên website khách.
 *
 * Không có JWT: người truy cập website là khách vãng lai, chưa đăng nhập CRM.
 * Ba lớp phòng vệ thay cho xác thực:
 *   1. `siteKey` xác định widget (công khai — nằm trong mã nguồn trang)
 *   2. Danh sách tên miền: chặn người khác chép mã nhúng sang site của họ
 *   3. Rate-limit toàn cục của Fastify đã đăng ký ở app.ts
 *
 * `visitorId` do trình duyệt khách tự sinh và lưu localStorage. Cùng một
 * visitorId thì nối lại đúng hội thoại cũ — khách F5 không tạo hội thoại mới.
 *
 * Widget KHÔNG tự tạo tin nhắn: mọi tin đều đi qua `deliverWebVisitorMessage`
 * của kênh Web Chat sẵn có, nên hội thoại vào đúng inbox và bắn `chat:message`
 * như mọi kênh khác. Widget chỉ là lớp nhúng công khai đứng trước kênh đó.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../../shared/prisma-client.js'
import { deliverWebVisitorMessage } from '../chat/web-chat-service.js'
import { SenderType, Platform } from '../../shared/constants.js'
import { logger } from '../../shared/logger.js'

/** Lấy hostname từ header Origin/Referer để đối chiếu danh sách tên miền. */
function requestHost(request: FastifyRequest): string | null {
  const raw = (request.headers.origin || request.headers.referer) as string | undefined
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Tên miền có được phép nhúng không.
 * Khớp cả tên miền con: khai `traduocvietnam.com` thì `shop.traduocvietnam.com` cũng qua.
 */
function hostAllowed(domains: unknown, host: string | null): boolean {
  const list = Array.isArray(domains)
    ? domains.filter((d): d is string => typeof d === 'string' && !!d.trim())
    : []
  if (list.length === 0) return true // chưa khai = cho phép mọi nơi (chế độ thử)
  if (!host) return false
  return list.some((d) => {
    const norm = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    return host === norm || host.endsWith(`.${norm}`)
  })
}

export async function widgetPublicRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Widget chạy trên website của KHÁCH nên phải nhận mọi Origin — kể cả khi
   * production đặt CORS_ORIGIN giới hạn cho ứng dụng CRM. Quyền truy cập được
   * kiểm bằng danh sách tên miền của từng widget, không bằng CORS.
   *
   * Cũng phải gỡ CORP của helmet, nếu không trình duyệt chặn ngay từ đầu.
   */
  app.addHook('onSend', async (request, reply, payload) => {
    if (!request.url.startsWith('/api/v1/widget/')) return payload
    reply.header('Access-Control-Allow-Origin', request.headers.origin ?? '*')
    reply.header('Access-Control-Allow-Headers', 'Content-Type')
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin')
    reply.header('Vary', 'Origin')
    return payload
  })

  async function loadWidget(request: FastifyRequest, reply: FastifyReply, siteKey: string) {
    const w = await prisma.websiteWidget.findUnique({ where: { siteKey } })
    if (!w || !w.isActive) {
      reply.status(404).send({ error: 'widget_not_found' })
      return null
    }
    if (!hostAllowed(w.domains, requestHost(request))) {
      logger.warn({ siteKey, host: requestHost(request) }, '[widget] tên miền không được phép')
      reply.status(403).send({ error: 'domain_not_allowed' })
      return null
    }
    return w
  }

  /** Hội thoại của một khách: một visitorId ↔ một hội thoại, F5 không tạo mới. */
  const threadIdOf = (siteKey: string, visitorId: string) =>
    `web:${siteKey}:${visitorId.trim().slice(0, 64)}`

  // ── Cấu hình hiển thị ────────────────────────────────────────────────
  app.get<{ Params: { siteKey: string } }>('/api/v1/widget/:siteKey/config', async (request, reply) => {
    const w = await loadWidget(request, reply, request.params.siteKey)
    if (!w) return
    // Chỉ trả thứ cần để vẽ — không lộ orgId hay cấu hình nội bộ.
    return {
      title: w.title,
      // Tên khách nhìn thấy; chưa đặt thì lùi về `title` để không bao giờ trống.
      displayName: w.displayName || w.title,
      logoUrl: w.logoUrl || null,
      greeting: w.greeting,
      primaryColor: w.primaryColor,
      position: w.position,
      channels: {
        liveChat: w.liveChatEnabled,
        zalo: w.zaloUrl || null,
        facebook: w.facebookUrl || null,
        phone: w.phoneNumber || null,
      },
    }
  })

  // ── Khách gửi tin ────────────────────────────────────────────────────
  app.post<{
    Params: { siteKey: string }
    Body: { visitorId?: string; text?: string; name?: string; pageUrl?: string }
  }>('/api/v1/widget/:siteKey/messages', async (request, reply) => {
    const w = await loadWidget(request, reply, request.params.siteKey)
    if (!w) return
    if (!w.liveChatEnabled) return reply.status(403).send({ error: 'live_chat_disabled' })

    const { visitorId, text, name, pageUrl } = request.body ?? {}
    if (!visitorId?.trim()) return reply.status(400).send({ error: 'visitorId là bắt buộc' })
    if (!text?.trim()) return reply.status(400).send({ error: 'text là bắt buộc' })
    if (text.length > 4000) return reply.status(400).send({ error: 'Tin nhắn quá dài' })

    const threadId = threadIdOf(w.siteKey, visitorId)
    const existing = await prisma.conversation.findFirst({
      where: { orgId: w.orgId, externalThreadId: threadId },
      select: { id: true },
    })

    // Kênh Web Chat phải thuộc về một người dùng — khách vãng lai không có tài
    // khoản nên lấy owner của tổ chức làm chủ kênh (giống web-chat-routes.ts
    // lấy user đang đăng nhập).
    const owner = await prisma.user.findFirst({
      where: { orgId: w.orgId, role: 'owner' },
      select: { id: true },
    })

    try {
      if (existing) {
        const res = await deliverWebVisitorMessage({
          orgId: w.orgId,
          ownerUserId: owner?.id ?? '',
          conversationId: existing.id,
          text: text.trim(),
          visitorName: name?.trim(),
        })
        return reply.status(201).send({ conversationId: res.conversationId })
      }

      // Hội thoại mới: tạo qua service chung rồi gắn lại externalThreadId theo
      // visitorId để lần sau tìm lại được, kèm nguồn là tên website.
      const res = await deliverWebVisitorMessage({
        orgId: w.orgId,
        ownerUserId: owner?.id ?? '',
        text: text.trim(),
        // Ghi rõ khách đến từ WEBSITE NÀO (tên widget đặt trong admin) thay vì
        // "Khách website" chung chung — nhiều site cùng org sẽ phân biệt được.
        visitorName: name?.trim() || `Khách ${w.name}`,
        aiMode: 'auto',
      })
      await prisma.conversation.update({
        where: { id: res.conversationId },
        data: { externalThreadId: threadId },
      })
      const conv = await prisma.conversation.findUnique({
        where: { id: res.conversationId },
        select: { contactId: true },
      })
      if (conv?.contactId) {
        await prisma.contact.update({
          where: { id: conv.contactId },
          data: {
            // zaloUid là cột định danh chung của mọi kênh trong TDVN (xem
            // message-handler.ts `identityField`), không riêng Zalo.
            zaloUid: threadId,
            source: `Web: ${w.name}`,
            metadata: { widget: w.name, siteKey: w.siteKey, pageUrl: pageUrl ?? null },
          },
        })
      }
      return reply.status(201).send({ conversationId: res.conversationId })
    } catch (err: unknown) {
      logger.error({ err, siteKey: w.siteKey }, '[widget] gửi tin thất bại')
      return reply.status(500).send({ error: 'send_failed' })
    }
  })

  // ── Khách đọc tin (hỏi lại theo chu kỳ) ──────────────────────────────
  app.get<{
    Params: { siteKey: string }
    Querystring: { visitorId?: string; after?: string }
  }>('/api/v1/widget/:siteKey/messages', async (request, reply) => {
    const w = await loadWidget(request, reply, request.params.siteKey)
    if (!w) return
    const visitorId = request.query.visitorId?.trim()
    if (!visitorId) return reply.status(400).send({ error: 'visitorId là bắt buộc' })

    const conv = await prisma.conversation.findFirst({
      where: { orgId: w.orgId, externalThreadId: threadIdOf(w.siteKey, visitorId) },
      select: { id: true },
    })
    if (!conv) return { messages: [] }

    const after = request.query.after ? new Date(request.query.after) : null
    const rows = await prisma.message.findMany({
      where: {
        conversationId: conv.id,
        isDeleted: false,
        // eCDP lọc `visibility: 'external'`; TDVN KHÔNG có cột đó (tin nội bộ
        // chưa được hỗ trợ — xem FEATURES.CHAT_INTERNAL_NOTES ở frontend). Lọc
        // theo senderType là tương đương chặt hơn: chỉ trả tin của khách và
        // của nhân viên, bỏ tin `system` (sự kiện kênh, ghi chú máy sinh ra).
        senderType: { in: [SenderType.SELF, SenderType.CONTACT] },
        ...(after && !isNaN(after.getTime()) ? { sentAt: { gt: after } } : {}),
      },
      orderBy: { sentAt: 'asc' },
      take: 100,
      select: { id: true, content: true, senderType: true, sentAt: true },
    })
    // Chỉ trả nội dung — không lộ tên nhân viên hay ghi chú nội bộ.
    return {
      messages: rows.map((m) => ({
        id: m.id,
        text: m.content ?? '',
        fromShop: m.senderType === SenderType.SELF,
        at: m.sentAt,
      })),
    }
  })

  // Giữ tham chiếu Platform để rõ widget chỉ dùng kênh WEBCHAT.
  void Platform.WEBCHAT
}
