import { SenderType } from '../../shared/constants.js'
import { resolveScopedAccountIds } from './report-routes.js'
import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import { prisma } from '../../shared/prisma-client.js'
import dayjs from 'dayjs'
import { logger } from '../../shared/logger.js'
import { fetchSalesStats, type SalesStats } from '../orders/crm-order-client.js'

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  // GET /api/v1/dashboard/kpi
  app.get('/api/v1/dashboard/kpi', async (request) => {
    const user = request.user as { orgId: string }
    const today = dayjs().startOf('day').toDate()
    const weekAgo = dayjs().subtract(7, 'day').toDate()

    const [totalContacts, newContactsThisWeek, appointmentsToday, messagesUnreplied, messagesToday, unreadConversations] = await Promise.all([
      prisma.contact.count({ where: { orgId: user.orgId, mergedInto: null, isGroup: false, deletedAt: null } }),
      prisma.contact.count({ where: { orgId: user.orgId, createdAt: { gte: weekAgo }, mergedInto: null, isGroup: false, deletedAt: null } }),
      prisma.appointment.count({ where: { orgId: user.orgId, appointmentDate: { gte: today, lte: dayjs().endOf('day').toDate() } } }),
      prisma.conversation.count({ where: { orgId: user.orgId, isReplied: false, channelAccount: { isDisabled: false, deletedAt: null } } }),
      prisma.message.count({ where: { conversation: { orgId: user.orgId, channelAccount: { isDisabled: false, deletedAt: null } }, sentAt: { gte: today } } }),
      prisma.conversation.count({ where: { orgId: user.orgId, unreadCount: { gt: 0 }, channelAccount: { isDisabled: false, deletedAt: null } } }),
    ])

    return {
      messagesToday,
      messagesUnreplied,
      messagesUnread: unreadConversations,
      appointmentsToday,
      newContactsThisWeek,
      totalContacts,
    }
  })

  // GET /api/v1/dashboard/overview — số liệu cho dashboard mới.
  //
  // Ba khác biệt so với /kpi cũ:
  //  1. Có doanh thu. KPI cũ không có lấy một con số bán hàng nào, trong khi
  //     đó là thứ cần nhìn đầu tiên mỗi sáng.
  //  2. Gọi đúng tên: 888 và 408 là số HỘI THOẠI, không phải số tin nhắn —
  //     màn hình cũ ghi "Tin nhắn chưa xem: 408" là sai. Số tin nhắn chưa đọc
  //     thật là tổng unreadCount, trả thêm ở đây.
  //  3. Trả về cả phần của riêng người đang đăng nhập, để nhân viên không nhìn
  //     số toàn công ty rồi tưởng là của mình.
  app.get('/api/v1/dashboard/overview', async (request) => {
    const user = request.user as { orgId: string; id: string; role: string; email?: string }
    const today = dayjs().startOf('day').toDate()
    const endOfToday = dayjs().endOf('day').toDate()
    const weekAgo = dayjs().subtract(7, 'day').toDate()

    const liveAccount = { isDisabled: false, deletedAt: null }

    // Nhân viên chỉ thấy hội thoại thuộc tài khoản Zalo mình được cấp quyền —
    // đúng luật đang dùng ở danh sách hội thoại. Không có luật này thì màn hình
    // báo 891 hội thoại chờ trả lời cho một người chỉ phụ trách vài chục.
    let convScope: any = { orgId: user.orgId, channelAccount: liveAccount }
    if (user.role === 'member') {
      const access = await prisma.channelAccountAccess.findMany({
        where: { userId: user.id },
        select: { channelAccountId: true },
      })
      const ids = access.map(a => a.channelAccountId)
      convScope = ids.length
        ? { orgId: user.orgId, channelAccountId: { in: ids }, channelAccount: liveAccount }
        // Chưa được cấp tài khoản nào thì không có hội thoại nào — trả 0 chứ
        // không phải trả số của cả công ty.
        : { orgId: user.orgId, channelAccountId: '__none__' }
    }

    const [
      totalContacts, newContactsThisWeek, appointmentsToday,
      convUnreplied, convUnread, unreadAgg, messagesToday,
      myReplies, myConvUnreplied,
    ] = await Promise.all([
      prisma.contact.count({ where: { orgId: user.orgId, mergedInto: null, isGroup: false, deletedAt: null } }),
      prisma.contact.count({ where: { orgId: user.orgId, createdAt: { gte: weekAgo }, mergedInto: null, isGroup: false, deletedAt: null } }),
      prisma.appointment.count({ where: { orgId: user.orgId, appointmentDate: { gte: today, lte: endOfToday } } }),
      prisma.conversation.count({ where: { ...convScope, isReplied: false } }),
      prisma.conversation.count({ where: { ...convScope, unreadCount: { gt: 0 } } }),
      prisma.conversation.aggregate({ _sum: { unreadCount: true }, where: convScope }),
      prisma.message.count({ where: { conversation: convScope, sentAt: { gte: today } } }),
      // Việc của riêng mình hôm nay.
      prisma.message.count({
        where: { repliedByUserId: user.id, sentAt: { gte: today } },
      }),
      prisma.conversation.count({ where: { ...convScope, isReplied: false, assignedUserId: user.id } }),
    ])

    // CRM hỏng thì vẫn trả phần hội thoại — thà thiếu ô doanh thu còn hơn
    // trắng cả dashboard.
    let sales: SalesStats | null = null
    let salesError: string | null = null
    try {
      sales = await fetchSalesStats(user.email?.split('@')[0])
    } catch (err: any) {
      salesError = err?.detail || err?.message || 'Không lấy được số liệu bán hàng từ CRM'
      logger.warn({ err }, '[dashboard] Không lấy được thống kê bán hàng')
    }

    return {
      conversations: {
        unrepliedConversations: convUnreplied,
        unreadConversations: convUnread,
        unreadMessages: unreadAgg._sum.unreadCount ?? 0,
        messagesToday,
      },
      me: {
        repliesToday: myReplies,
        unrepliedAssigned: myConvUnreplied,
      },
      contacts: { total: totalContacts, newThisWeek: newContactsThisWeek },
      appointmentsToday,
      sales,
      salesError,
      // Nhân viên mặc định xem số của mình; chủ và quản trị xem toàn công ty.
      defaultScope: ['owner', 'admin', 'manager'].includes(user.role) ? 'org' : 'mine',
      role: user.role,
    }
  })

  // GET /api/v1/dashboard/pipeline — count contacts per lifecycle stage.
  // Returns { status, _count } shape for back-compat with frontend that
  // expects the old `status` key — `status` is now the lifecycle stage.
  app.get('/api/v1/dashboard/pipeline', async (request) => {
    const user = request.user as { orgId: string }
    const grouped = await prisma.contact.groupBy({
      by: ['lifecycleStage'],
      where: { orgId: user.orgId, mergedInto: null, isGroup: false, deletedAt: null },
      _count: { _all: true },
    })
    return grouped.map(g => ({ status: g.lifecycleStage, lifecycleStage: g.lifecycleStage, _count: g._count }))
  })

  // GET /api/v1/dashboard/sources
  app.get('/api/v1/dashboard/sources', async (request) => {
    const user = request.user as { orgId: string }
    const grouped = await prisma.contact.groupBy({
      by: ['source'],
      where: { orgId: user.orgId, mergedInto: null, isGroup: false, deletedAt: null },
      _count: { _all: true },
    })
    return grouped.map(g => ({ source: g.source ?? 'Không rõ', _count: g._count }))
  })

  // GET /api/v1/dashboard/message-volume — last 7 days
  app.get<{ Querystring: { channel?: string; accountId?: string } }>(
    '/api/v1/dashboard/message-volume', async (request, reply) => {
    const user = request.user as { id: string; role: string; orgId: string }
    // Cùng phạm vi với báo cáo Chat → Đơn: vai trò (nhân viên/quản lý chỉ thấy
    // tài khoản được cấp) ∩ bộ lọc kênh/tài khoản trên UI — hai khối trên cùng
    // màn Tổng quan không được lệch số như đợt kênh sandbox trước đây.
    const scoped = await resolveScopedAccountIds(user.orgId, user, request.query)
    if (scoped.error) return reply.status(scoped.status ?? 400).send({ error: scoped.error })
    // Chỉ kênh đang sống — đồng nhất với /kpi (kênh sandbox của máy mô phỏng
    // từng khiến thẻ "Tin nhắn hôm nay" và cột biểu đồ cùng ngày lệch số).
    const liveAcc = { isDisabled: false, deletedAt: null }
    const convScope = scoped.accountIds
      ? scoped.accountIds.length
        ? { channelAccountId: { in: scoped.accountIds }, channelAccount: liveAcc }
        : { channelAccountId: '__none__' }
      : { channelAccount: liveAcc }
    const days: { date: string; sent: number; received: number }[] = []

    for (let i = 6; i >= 0; i--) {
      const d = dayjs().subtract(i, 'day')
      const start = d.startOf('day').toDate()
      const end = d.endOf('day').toDate()

      const [sent, received] = await Promise.all([
        prisma.message.count({
          where: {
            conversation: { orgId: user.orgId, ...convScope },
            senderType: SenderType.SELF,
            sentAt: { gte: start, lte: end },
          },
        }),
        prisma.message.count({
          where: {
            conversation: { orgId: user.orgId, ...convScope },
            senderType: SenderType.CONTACT,
            sentAt: { gte: start, lte: end },
          },
        }),
      ])

      days.push({ date: d.format('YYYY-MM-DD'), sent, received })
    }

    return { data: days }
  })
}
