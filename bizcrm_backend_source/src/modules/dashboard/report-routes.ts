/**
 * report-routes.ts — Báo cáo "Hiệu quả Chat → Đơn hàng" cho màn Tổng quan.
 *
 * GET /api/v1/reports/chat-to-order
 *   ?period=day|week|month|custom & from= & to= & compare=7d|month|quarter|year
 *   & channel= & accountId=
 *
 * Nguồn số liệu (mỗi chỉ số 1 truy vấn gộp, không lặp từng dòng tin nhắn):
 *  - friends    = TỔNG liên hệ trong danh bạ hiện có (channel_contacts), KHÔNG
 *    lọc theo kỳ — cùng giá trị ở current lẫn previous vì đây là ảnh chụp hiện
 *    tại, không phải phát sinh trong kỳ. Zalo (zca-js getAllFriends()) không
 *    trả thời điểm kết bạn thật cho từng liên hệ, nên KHÔNG thể tính "liên hệ
 *    mới trong kỳ" đáng tin — channel_contacts.createdAt chỉ là lúc hệ thống
 *    ĐỒNG BỘ danh bạ (một lần đồng bộ lại ghi cùng created_at cho toàn bộ danh
 *    bạ cũ, từng khiến báo cáo hiểu nhầm 154 người "kết bạn" trong một ngày).
 *    Dùng làm mẫu số cho tỉ trọng nhắn tin (06) và phễu — "bao nhiêu % danh bạ
 *    có nhắn tin trong kỳ" là số liệu đúng và hữu ích hơn "kết bạn mới".
 *  - msgIn      = messages senderType='contact' có sentAt trong kỳ (join
 *    conversation → orgId).
 *  - afterHours = phần msgIn có giờ (theo múi giờ của lịch AI) NGOÀI giờ hành
 *    chính. Giờ hành chính đọc từ cùng storage với GET /api/v1/ai/schedule
 *    (AppSetting 'ai_auto_reply_schedule' — getAiScheduleConfig). Theo đúng
 *    ngữ nghĩa isAfterHours(): dù start<end hay start>end, khung LÀM VIỆC luôn
 *    là [min(start,end), max(start,end)) — mặc định 08:00–18:00.
 *  - chatters   = số NGƯỜI có nhắn tin trong kỳ: DISTINCT contactId của các
 *    hội thoại có tin 'contact' trong kỳ (contactId null → đếm theo
 *    conversationId để không mất khách chưa gắn contact).
 *  - orders / revenue / aiOrders = đọc từ cdp_events eventName='order_created'
 *    (ghi tại order-service.ts sau khi CRM nhận đơn thành công — ChatMQL không
 *    có bảng đơn hàng local, đơn nằm ở CRM). revenue = SUM(properties.total),
 *    đơn vị VND NGUYÊN. aiOrders = số event có properties.source='ai'.
 *    Kỳ không có event nào VÀ CRM (fetchSalesStats) cũng không gọi được →
 *    trả null + meta.salesNote, không bịa số.
 *  - tags       = đếm hội thoại có lastMessageAt trong kỳ theo từng tag trên
 *    Contact.tags (Json string[]), màu lấy từ danh sách tag của org (cùng
 *    storage với GET /api/v1/tags — AppSetting 'org.tags'). Top 10 theo count.
 *
 * PHẠM VI THEO VAI TRÒ — cùng luật với danh sách hội thoại / /dashboard/overview:
 *  - owner/admin: toàn bộ tổ chức (trừ khi tự lọc theo kênh/tài khoản trên UI).
 *  - manager: tài khoản của mình + tài khoản cấp dưới (resolveManagerAccountIds).
 *  - member: CHỈ tài khoản được cấp qua ChannelAccountAccess.
 *  Bộ lọc kênh/tài khoản trên UI giao với phạm vi này — chọn ngoài phạm vi thì
 *  bị từ chối (accountId) hoặc tự rút gọn danh sách (kênh). Không có luật này
 *  thì nhân viên xem báo cáo sẽ thấy số liệu của TOÀN CÔNG TY thay vì phần
 *  việc của mình — sai lệch hoàn toàn với dữ liệu họ thực sự phụ trách.
 *
 * Các tỉ lệ (msgPerFriend, afterHoursPct, convRate, aiPct) và badge trend do
 * FE tính — API chỉ trả số đếm gốc.
 */
import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import { prisma } from '../../shared/prisma-client.js'
import { Prisma } from '@prisma/client'
import dayjs, { type Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear.js'
import { logger } from '../../shared/logger.js'
import { getAiScheduleConfig } from '../ai/ai-config-service.js'
import { fetchSalesStats } from '../orders/crm-order-client.js'
import { SenderType } from '../../shared/constants.js'
import { resolveManagerAccountIds } from '../zalo/zalo-access-middleware.js'

dayjs.extend(quarterOfYear)

type PeriodMetrics = {
  /** Tổng liên hệ trong danh bạ — snapshot hiện tại, KHÔNG theo kỳ (xem docblock). */
  friends: number
  msgIn: number
  afterHours: number
  orders: number | null
  revenue: number | null
  aiOrders: number | null
  chatters: number
}

type Window = { from: Date; to: Date }

const COMPARE_LABELS: Record<string, string> = {
  '7d': '7 ngày / 7 ngày trước',
  month: 'Tháng này / tháng trước',
  quarter: 'Quý này / quý trước',
  year: 'Năm nay / năm trước',
}

/**
 * Nhóm kênh tương tác — KHỚP `src/lib/channel-groups.ts` phía frontend.
 * `other` hứng phần còn lại (webchat, telegram, kênh mới chưa phân nhóm).
 */
export const CHANNEL_GROUPS: Record<string, number[]> = {
  zalo_user: [2],
  zalo_oa: [1],
  facebook: [10, 11, 30, 31],
  ecommerce: [32, 39],
  other: [12, 20],
}

/**
 * Phạm vi cuối cùng của một truy vấn báo cáo: danh sách accountId cụ thể.
 * `undefined` = không giới hạn (owner/admin, chưa chọn kênh/tài khoản nào) —
 * nhánh nhanh, chỉ lọc org + kênh còn sống. Mảng RỖNG = có quyền nhưng 0 tài
 * khoản khớp bộ lọc → phải trả về 0 khắp nơi, không phải "không giới hạn".
 */
export interface ScopeFilter {
  accountIds?: string[]
}

function scopeSql(f: ScopeFilter, col = Prisma.sql`cv.channel_account_id`): Prisma.Sql {
  if (!f.accountIds) return Prisma.empty
  if (f.accountIds.length === 0) return Prisma.sql`AND false`
  return Prisma.sql`AND ${col} IN (${Prisma.join(f.accountIds)})`
}

/**
 * Chỉ tính kênh ĐANG SỐNG — loại tài khoản đã tắt/đã xoá (đặc biệt là kênh
 * "🧪 AI Sandbox" của máy mô phỏng: mỗi lượt chạy kiểm định sinh tin nhắn thử,
 * không lọc thì quá nửa "tin nhắn đến" của kỳ là rác thử nghiệm).
 * Cùng luật với /dashboard/kpi và danh sách hội thoại.
 */
const LIVE_ACCOUNT_SQL = Prisma.sql`AND ca.is_disabled = false AND ca.deleted_at IS NULL`

function win(from: Dayjs, to: Dayjs): Window {
  return { from: from.toDate(), to: to.toDate() }
}

/**
 * Danh sách accountId "được phép xem" theo VAI TRÒ — trước khi áp bộ lọc UI.
 * `undefined` = owner/admin, không giới hạn.
 */
async function resolveAllowedAccountIds(user: { id: string; role: string }): Promise<string[] | undefined> {
  if (user.role === 'member') {
    const rows = await prisma.channelAccountAccess.findMany({
      where: { userId: user.id },
      select: { channelAccountId: true },
    })
    return rows.map((r) => r.channelAccountId)
  }
  if (user.role === 'manager') {
    return [...(await resolveManagerAccountIds(user.id))]
  }
  return undefined
}

/**
 * Giao phạm vi VAI TRÒ với bộ lọc UI (kênh / tài khoản cụ thể) → danh sách
 * accountId cuối cùng dùng cho mọi truy vấn. Dùng chung cho báo cáo và biểu
 * đồ tin nhắn để hai nơi trên cùng màn hình không bao giờ lệch số.
 */
export async function resolveScopedAccountIds(
  orgId: string,
  user: { id: string; role: string },
  query: { channel?: string; accountId?: string },
): Promise<{ accountIds?: string[]; error?: string; status?: number }> {
  const allowed = await resolveAllowedAccountIds(user)

  if (query.accountId) {
    if (allowed && !allowed.includes(query.accountId)) {
      return { status: 403, error: 'Bạn không có quyền xem dữ liệu của tài khoản này' }
    }
    const acc = await prisma.channelAccount.findFirst({
      where: { id: query.accountId, orgId },
      select: { id: true },
    })
    if (!acc) return { status: 400, error: 'Tài khoản tương tác không tồn tại trong tổ chức' }
    return { accountIds: [query.accountId] }
  }

  if (query.channel) {
    if (!CHANNEL_GROUPS[query.channel]) {
      return { status: 400, error: 'channel phải là zalo_user | zalo_oa | facebook | ecommerce | other' }
    }
    const known = Object.values(CHANNEL_GROUPS).flat().filter((x) => !CHANNEL_GROUPS.other.includes(x))
    const where: Prisma.ChannelAccountWhereInput = {
      orgId,
      isDisabled: false,
      deletedAt: null,
      platform: query.channel === 'other' ? { notIn: known } : { in: CHANNEL_GROUPS[query.channel] },
      ...(allowed ? { id: { in: allowed } } : {}),
    }
    const rows = await prisma.channelAccount.findMany({ where, select: { id: true } })
    return { accountIds: rows.map((r) => r.id) }
  }

  return { accountIds: allowed }
}

/**
 * Đo 1 kỳ: (msgIn, afterHours, chatters) + (orders, revenue, aiOrders).
 * `friends` KHÔNG nằm trong đây — đó là ảnh chụp hiện tại, không theo kỳ, gán
 * ở handler bằng countTotalFriends() sau khi gọi hàm này (xem docblock đầu file).
 */
async function measurePeriod(
  orgId: string,
  w: Window,
  biz: { lo: number; hi: number; tz: string },
  f: ScopeFilter,
): Promise<{ metrics: Omit<PeriodMetrics, 'friends'>; hasOrderEvents: boolean }> {
  const scope = scopeSql(f)
  const [msgRows, orderRows] = await Promise.all([
    // 3 chỉ số tin nhắn trong MỘT truy vấn:
    //  - giờ tính theo múi giờ của lịch AI (sent_at lưu UTC → đổi sang tz);
    //  - ngoài giờ = giờ < lo hoặc >= hi (khung làm việc [lo, hi));
    //  - chatters đếm DISTINCT contact, hội thoại chưa gắn contact đếm theo id.
    prisma.$queryRaw<[{ msg_in: bigint; after_hours: bigint; chatters: bigint }]>`
      SELECT
        COUNT(*)                                                   AS msg_in,
        COUNT(*) FILTER (
          WHERE EXTRACT(HOUR FROM (m.sent_at AT TIME ZONE 'UTC') AT TIME ZONE ${biz.tz}) < ${biz.lo}
             OR EXTRACT(HOUR FROM (m.sent_at AT TIME ZONE 'UTC') AT TIME ZONE ${biz.tz}) >= ${biz.hi}
        )                                                          AS after_hours,
        COUNT(DISTINCT COALESCE(cv.contact_id, cv.id))             AS chatters
      FROM messages m
      JOIN conversations cv ON cv.id = m.conversation_id
      JOIN channel_accounts ca ON ca.id = cv.channel_account_id
      WHERE cv.org_id = ${orgId}
        AND m.sender_type = ${SenderType.CONTACT}
        AND m.sent_at >= ${w.from}
        AND m.sent_at <= ${w.to}
        ${LIVE_ACCOUNT_SQL}
        ${scope}
    `,
    prisma.$queryRaw<[{ orders: bigint; revenue: number | null; ai_orders: bigint }]>`
      SELECT
        COUNT(*)                                                        AS orders,
        COALESCE(SUM((e.properties ->> 'total')::numeric), 0)::float8     AS revenue,
        COUNT(*) FILTER (WHERE e.properties ->> 'source' = 'ai')          AS ai_orders
      FROM cdp_events e
      LEFT JOIN conversations cv ON cv.id = (e.properties ->> 'conversationId')
      LEFT JOIN channel_accounts ca ON ca.id = COALESCE(e.properties ->> 'channelAccountId', cv.channel_account_id)
      WHERE e.org_id = ${orgId}
        AND e.event_name = 'order_created'
        AND e."timestamp" >= ${w.from}
        AND e."timestamp" <= ${w.to}
        ${scopeSql(f, Prisma.sql`COALESCE(e.properties ->> 'channelAccountId', cv.channel_account_id::text)`)}
    `,
  ])

  const m = msgRows[0]
  const o = orderRows[0]
  const orders = Number(o?.orders ?? 0)

  return {
    metrics: {
      msgIn: Number(m?.msg_in ?? 0),
      afterHours: Number(m?.after_hours ?? 0),
      chatters: Number(m?.chatters ?? 0),
      orders,
      revenue: Math.round(Number(o?.revenue ?? 0)), // VND nguyên
      aiOrders: Number(o?.ai_orders ?? 0),
    },
    hasOrderEvents: orders > 0,
  }
}

/** Tổng danh bạ hiện có (không lọc theo kỳ) — chỉ để đối chiếu, không dùng tính tỉ lệ. */
async function countTotalFriends(orgId: string, f: ScopeFilter): Promise<number> {
  const where: Prisma.ChannelContactWhereInput = {
    orgId,
    channelAccount: { isDisabled: false, deletedAt: null },
  }
  if (f.accountIds) {
    if (f.accountIds.length === 0) return 0
    where.channelAccountId = { in: f.accountIds }
  }
  return prisma.channelContact.count({ where })
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  app.get<{
    Querystring: {
      period?: 'day' | 'week' | 'month' | 'custom'
      from?: string
      to?: string
      compare?: '7d' | 'month' | 'quarter' | 'year'
      channel?: string
      accountId?: string
    }
  }>('/api/v1/reports/chat-to-order', async (request, reply) => {
    const user = request.user as { id: string; role: string; orgId: string; email?: string }
    const { period = 'month', from, to, compare, channel, accountId } = request.query

    // ── Phạm vi: vai trò ∩ bộ lọc kênh/tài khoản trên UI ─────────────
    const scoped = await resolveScopedAccountIds(user.orgId, user, { channel, accountId })
    if (scoped.error) return reply.status(scoped.status ?? 400).send({ error: scoped.error })
    const filter: ScopeFilter = { accountIds: scoped.accountIds }

    // ── Cửa sổ thời gian ────────────────────────────────────────────
    const now = dayjs()
    let label: string
    let cur: Window
    let prev: Window | null = null

    if (compare) {
      if (!COMPARE_LABELS[compare]) {
        return reply.status(400).send({ error: 'compare phải là 7d | month | quarter | year' })
      }
      label = COMPARE_LABELS[compare]
      if (compare === '7d') {
        // 7 ngày gần nhất vs 7 ngày liền trước đó
        cur = win(now.subtract(6, 'day').startOf('day'), now.endOf('day'))
        prev = win(now.subtract(13, 'day').startOf('day'), now.subtract(7, 'day').endOf('day'))
      } else {
        // month/quarter/year theo LỊCH: kỳ hiện tại tính đến hết hôm nay,
        // kỳ trước lấy trọn kỳ lịch liền trước.
        const unit = compare === 'month' ? 'month' : compare === 'quarter' ? 'quarter' : 'year'
        cur = win(now.startOf(unit), now.endOf('day'))
        const p = now.subtract(1, unit === 'quarter' ? 'quarter' : unit)
        prev = win(p.startOf(unit), p.endOf(unit))
      }
    } else if (period === 'day') {
      label = 'Hôm nay'
      cur = win(now.startOf('day'), now.endOf('day'))
    } else if (period === 'week') {
      label = 'Tuần này (7 ngày)'
      cur = win(now.subtract(6, 'day').startOf('day'), now.endOf('day'))
    } else if (period === 'month') {
      label = 'Tháng này (30 ngày)'
      cur = win(now.subtract(29, 'day').startOf('day'), now.endOf('day'))
    } else if (period === 'custom') {
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
      const f = dayjs(from ?? '')
      const t = dayjs(to ?? '')
      if (!DATE_RE.test(from ?? '') || !DATE_RE.test(to ?? '') || !f.isValid() || !t.isValid()) {
        return reply.status(400).send({ error: 'Kỳ tùy chỉnh cần from/to dạng YYYY-MM-DD' })
      }
      if (f.isAfter(t)) {
        return reply.status(400).send({ error: 'Từ ngày phải trước hoặc bằng Đến ngày' })
      }
      label = `Tùy chỉnh ${f.format('DD/MM/YYYY')} – ${t.format('DD/MM/YYYY')}`
      cur = win(f.startOf('day'), t.endOf('day'))
    } else {
      return reply.status(400).send({ error: 'period phải là day | week | month | custom' })
    }

    // ── Khung giờ hành chính từ lịch AI (mặc định 08:00–18:00) ──────
    const schedule = await getAiScheduleConfig(user.orgId)
    const lo = Math.min(schedule.startHour, schedule.endHour)
    const hi = Math.max(schedule.startHour, schedule.endHour)
    const biz = { lo, hi, tz: schedule.timezone || 'Asia/Ho_Chi_Minh' }
    const afterHoursWindow = `${String(lo).padStart(2, '0')}:00–${String(hi).padStart(2, '0')}:00`

    const [curPartial, prevPartial, totalFriends] = await Promise.all([
      measurePeriod(user.orgId, cur, biz, filter),
      prev ? measurePeriod(user.orgId, prev, biz, filter) : Promise.resolve(null),
      countTotalFriends(user.orgId, filter),
    ])
    // friends = ảnh chụp hiện tại, dùng CHUNG cho cả kỳ hiện tại và kỳ trước
    // (không có cách nào tái dựng "tổng liên hệ tại thời điểm kỳ trước" —
    // channel_contacts không giữ lịch sử số lượng theo thời gian).
    const curRes = { ...curPartial, metrics: { ...curPartial.metrics, friends: totalFriends } }
    const prevRes = prevPartial
      ? { ...prevPartial, metrics: { ...prevPartial.metrics, friends: totalFriends } }
      : null

    // ── Đơn hàng: không có event nào trong kỳ + CRM cũng chết → null ─
    // ChatMQL chỉ ghi event 'order_created' từ thời điểm được cài đặt, nên kỳ
    // trống có thể là "chưa tích lũy" chứ không phải "0 đơn". Chỉ khi CRM còn
    // sống (fetchSalesStats OK) mới dám khẳng định 0.
    let salesNote: string | undefined
    if (!curRes.hasOrderEvents) {
      try {
        await fetchSalesStats(user.email?.split('@')[0])
        // CRM sống: giữ số 0 thật, chỉ ghi chú nguồn số liệu.
        salesNote =
          'Số đơn/doanh số tính từ sự kiện lên đơn qua ChatMQL (tích lũy từ khi cài đặt), không gồm đơn tạo trực tiếp trên CRM.'
      } catch (err) {
        logger.warn({ err }, '[reports] CRM không phản hồi — trả null cho nhóm đơn hàng')
        curRes.metrics.orders = null
        curRes.metrics.revenue = null
        curRes.metrics.aiOrders = null
        // Kỳ trước cũng không thể khẳng định — null nốt để FE khỏi vẽ trend ảo.
        if (prevRes && !prevRes.hasOrderEvents) {
          prevRes.metrics.orders = null
          prevRes.metrics.revenue = null
          prevRes.metrics.aiOrders = null
        }
        salesNote =
          'Chưa có dữ liệu đơn hàng: kỳ này không có sự kiện lên đơn qua ChatMQL và CRM không phản hồi. Số liệu sẽ tự tích lũy từ nay qua các đơn tạo trong ChatMQL.'
      }
    }

    // ── Tags theo hội thoại ─────────────────────────────────────────
    // Đếm hội thoại có lastMessageAt trong kỳ, theo từng tag của contact.
    // Contact.tags là jsonb string[] — unnest bằng LATERAL, 1 truy vấn.
    const tagRows = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
      SELECT elem #>> '{}' AS tag, COUNT(DISTINCT cv.id) AS count
      FROM conversations cv
      JOIN channel_accounts ca ON ca.id = cv.channel_account_id
      JOIN contacts c ON c.id = cv.contact_id
      CROSS JOIN LATERAL jsonb_array_elements(c.tags) AS elem
      WHERE cv.org_id = ${user.orgId}
        ${LIVE_ACCOUNT_SQL}
        ${scopeSql(filter)}
        AND cv.last_message_at >= ${cur.from}
        AND cv.last_message_at <= ${cur.to}
        AND c.deleted_at IS NULL
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `

    // Màu tag từ danh sách tag của org (cùng storage với GET /api/v1/tags).
    const tagSetting = await prisma.appSetting.findUnique({
      where: { orgId_settingKey: { orgId: user.orgId, settingKey: 'org.tags' } },
    })
    let orgTags: { name: string; color: string }[] = []
    try {
      orgTags = tagSetting?.valuePlain ? JSON.parse(tagSetting.valuePlain) : []
    } catch {
      orgTags = []
    }
    const colorOf = new Map(orgTags.map(t => [t.name.toLowerCase(), t.color]))
    const FALLBACK = '#64748b'
    const tags = tagRows.map(r => {
      const color = colorOf.get(r.tag.toLowerCase()) ?? FALLBACK
      // bg = màu nhạt 12% — FE dùng cho nền chip.
      return { name: r.tag, color, bg: `${color}1f`, count: Number(r.count) }
    })

    return {
      label,
      current: curRes.metrics,
      ...(prevRes ? { previous: prevRes.metrics } : {}),
      tags,
      meta: {
        afterHoursWindow,
        timezone: biz.tz,
        // Nhân viên/quản lý bị giới hạn và chưa được cấp tài khoản nào — báo rõ
        // lý do trống thay vì để trắng khó hiểu.
        ...(filter.accountIds?.length === 0
          ? { scopeNote: 'Bạn chưa được cấp quyền xem tài khoản kênh nào nên báo cáo này đang trống.' }
          : {}),
        ...(salesNote ? { salesNote } : {}),
      },
    }
  })
}
