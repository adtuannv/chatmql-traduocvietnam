/**
 * chat-routes.ts — REST API for conversations and messages.
 * Ported from ZaloCRM with adaptations for BizCRM.
 */
import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import { prisma } from '../../shared/prisma-client.js'
import { emitPinToggle, emitReaction, emitAiModeChanged, emitConvDeleted } from '../realtime/socket-gateway.js'
import { getPoolEntry } from '../zalo/zalo-pool.js'
import { chatMessageRoutes } from './chat-message-routes.js'
import { chatGroupRoutes } from './chat-group-routes.js'
import { enrichContactFromZalo } from './message-handler.js'
import { requireZaloAccess, resolveManagerAccountIds } from '../zalo/zalo-access-middleware.js'
import { forwardReactionToZalo, isSupportedEmoji } from '../zalo/zalo-reactions.js'
import multipart from '@fastify/multipart'
import { logger } from '../../shared/logger.js'
import { deriveActorKind, type ActorKindValue, Platform } from '../../shared/constants.js'

type QueryParams = Record<string, string>

// ── Quote helpers (ported from ZaloCRM) ───────────────────────────────────────

/** Map BizCRM contentType → Zalo internal msgType for quote references */
function mapReplyMsgType(contentType: string): string {
  if (contentType === 'text') return 'webchat'
  if (contentType === 'image') return 'chat.photo'
  if (contentType === 'file') return 'share.file'
  if (contentType === 'video') return 'chat.video.msg'
  if (contentType === 'voice') return 'chat.voice'
  if (contentType === 'sticker') return 'chat.sticker'
  if (contentType === 'gif') return 'chat.gif'
  if (contentType === 'link') return 'chat.link'
  if (contentType === 'location') return 'chat.location.new'
  return contentType
}

/** Build a SendMessageQuote compatible with zca-js sendMessage API */
export function buildReplyQuote(message: {
  externalMsgId: string | null
  senderUid: string | null
  content: string | null
  contentType: string
  sentAt: Date
}) {
  if (!message.externalMsgId || !message.senderUid) return null
  return {
    content: message.content ?? '',
    msgType: mapReplyMsgType(message.contentType),
    propertyExt: {},
    uidFrom: message.senderUid,
    msgId: message.externalMsgId,
    cliMsgId: message.externalMsgId,
    ts: String(message.sentAt.getTime()),
    ttl: 0,
  }
}

/**
 * Convert the DB-shaped `quote` JSON into the `reply` shape the frontend renders.
 * Apply at every place a message is returned to the client (HTTP response + socket emit)
 * so the quote box appears live, not just after a /messages refetch on reload.
 */
export function transformMessageForFrontend<T extends { quote?: unknown; contentType?: string; content?: string | null }>(message: T): Omit<T, 'quote'> & {
  reply: { msgId: string; cliMsgId?: string; content: string; msgType: string; uidFrom: string; ts: string } | null
  actorKind: ActorKindValue
} {
  const { quote, ...rest } = message
  const actorKind = deriveActorKind(message as Record<string, unknown>)
  
  // Sanitize content for image/file to guarantee frontend parsing never fails
  let safeContent = rest.content ?? ''
  if (rest.contentType === 'image') {
    if (!safeContent || !safeContent.trim().startsWith('{')) {
      safeContent = JSON.stringify({
        href: safeContent.startsWith('http') ? safeContent : 'https://tracrm-api.bizino.ai/uploads/chat-media/placeholder.png',
        thumb: safeContent.startsWith('http') ? safeContent : 'https://tracrm-api.bizino.ai/uploads/chat-media/placeholder.png',
        caption: safeContent || 'Hình ảnh',
        title: 'image.png'
      })
    } else {
      const publicBase = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '')
      if (publicBase && safeContent.includes('http://localhost:4520/uploads/')) {
        safeContent = safeContent.replaceAll('http://localhost:4520/uploads/', `${publicBase}/uploads/`)
      }
    }
  } else if (rest.contentType === 'file') {
    if (!safeContent || !safeContent.trim().startsWith('{')) {
      safeContent = JSON.stringify({
        title: safeContent || 'Tài liệu',
        href: safeContent.startsWith('http') ? safeContent : '#',
        fileExt: 'file',
        fileSize: '0'
      })
    }
  }
  (rest as any).content = safeContent

  const q = quote as Record<string, unknown> | null | undefined
  if (!q || typeof q !== 'object') return { ...rest, reply: null, actorKind }
  return {
    ...rest,
    actorKind,
    reply: {
      msgId: (q.msgId as string) || (q.cliMsgId as string) || '',
      cliMsgId: (q.cliMsgId as string) || undefined,
      content: (q.content as string) || '',
      msgType: (q.msgType as string) || 'text',
      uidFrom: (q.uidFrom as string) || '',
      ts: (q.ts as string) || '',
    },
  }
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  // Register multipart for file uploads (5MB limit)
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  })

  // ── Conversation filter counts ──────────────────────────────────────
  app.get('/api/v1/conversations/counts', async (request) => {
    const user = request.user as { orgId: string; id: string; role: string }
    const { accountId = '', tab = '' } = request.query as QueryParams

    const baseWhere: any = {
      orgId: user.orgId,
      channelAccount: {
        isDisabled: false,
        deletedAt: null,
      },
    }
    if (accountId) {
      baseWhere.channelAccountId = accountId
      delete baseWhere.channelAccount
    }
    if (tab) baseWhere.tab = tab

    // Members can only see conversations from accessible Zalo accounts
    if (user.role === 'member') {
      const accessibleAccounts = await prisma.channelAccountAccess.findMany({
        where: { userId: user.id },
        select: { channelAccountId: true },
      })
      const ids = accessibleAccounts.map(a => a.channelAccountId)
      if (accountId && ids.includes(accountId)) {
        baseWhere.channelAccountId = accountId
      } else if (ids.length > 0) {
        baseWhere.channelAccountId = { in: ids }
      }
    }

    // Manager: scope to own + subordinates' accounts
    if (user.role === 'manager') {
      const accessibleIds = await resolveManagerAccountIds(user.id)
      const idArray = Array.from(accessibleIds)
      if (accountId && accessibleIds.has(accountId)) {
        baseWhere.channelAccountId = accountId
      } else if (idArray.length > 0) {
        baseWhere.channelAccountId = { in: idArray }
      } else {
        baseWhere.channelAccountId = '__none__' // no accounts → no results
      }
    }

    const [unread, unreplied, ai, total] = await Promise.all([
      prisma.conversation.count({ where: { ...baseWhere, unreadCount: { gt: 0 } } }),
      prisma.conversation.count({ where: { ...baseWhere, isReplied: false } }),
      // "AI tư vấn": hội thoại đang để AI tự trả lời (aiMode = auto) — badge cho bộ lọc bên trái.
      prisma.conversation.count({ where: { ...baseWhere, aiMode: 'auto' } }),
      prisma.conversation.count({ where: baseWhere }),
    ])

    return { unread, unreplied, ai, total }
  })

  // ── List conversations (paginated, filterable) ──────────────────────
  app.get('/api/v1/conversations', async (request) => {
    const user = request.user as { orgId: string; id: string; role: string }
    const {
      page = '1',
      limit = '50',
      search = '',
      contactId = '',
      accountId = '',
      unread = '',
      unreplied = '',
      from = '',
      to = '',
      tab = '',
      aiMode = '',
      assignedTo = '',
      platform = '',
    } = request.query as QueryParams & { platform?: string }

    const where: any = {
      orgId: user.orgId,
      channelAccount: {
        isDisabled: false,
        deletedAt: null,
      },
    }
    if (contactId) where.contactId = contactId
    if (tab) where.tab = tab
    if (accountId) {
      where.channelAccountId = accountId
      delete where.channelAccount
    }
    if (platform === 'oa' || platform === '1' || platform === 'zalo_oa') {
      where.channelAccount = { ...(where.channelAccount || {}), platform: Platform.ZALO_OA }
    } else if (platform === 'personal' || platform === '2' || platform === 'user' || platform === 'zalo_user') {
      where.channelAccount = { ...(where.channelAccount || {}), platform: Platform.ZALO_USER }
    } else if (platform === 'facebook' || platform === 'fb' || platform === '10' || platform === '30') {
      where.channelAccount = { ...(where.channelAccount || {}), platform: { in: [Platform.FACEBOOK_PAGE, Platform.PANCAKE_FB] } }
    } else if (platform === 'tiktok' || platform === 'tt' || platform === '40' || platform === '32') {
      where.channelAccount = { ...(where.channelAccount || {}), platform: { in: [Platform.TIKTOK_SHOP, Platform.PANCAKE_TIKTOK] } }
    }
    if (search) {
      where.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
        { contact: { OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ] } },
      ]
    }

    // Advanced filters
    if (unread === 'true') where.unreadCount = { gt: 0 }
    if (unreplied === 'true') where.isReplied = false
    // Cột lọc bên trái: chế độ AI đang bật và hội thoại được giao cho mình.
    // Hai trường này đã có trong bảng nhưng trước đây chưa lọc được qua API,
    // nên các nút "Auto" và "Được gán cho tôi" bấm vào không đổi danh sách.
    if (aiMode) where.aiMode = aiMode
    if (assignedTo === 'me') where.assignedUserId = user.id
    else if (assignedTo) where.assignedUserId = assignedTo
    if (from || to) {
      where.lastMessageAt = {}
      if (from) { const d = new Date(from); if (!isNaN(d.getTime())) where.lastMessageAt.gte = d }
      if (to) { const d = new Date(to); if (!isNaN(d.getTime())) where.lastMessageAt.lte = d }
      if (Object.keys(where.lastMessageAt).length === 0) delete where.lastMessageAt
    }

    // Member RBAC
    if (user.role === 'member') {
      const accessibleAccounts = await prisma.channelAccountAccess.findMany({
        where: { userId: user.id },
        select: { channelAccountId: true },
      })
      const ids = accessibleAccounts.map(a => a.channelAccountId)
      if (accountId && ids.includes(accountId)) {
        where.channelAccountId = accountId
      } else if (ids.length > 0) {
        where.channelAccountId = { in: ids }
      }
    }

    // Manager RBAC: scope to own + subordinates' accounts
    if (user.role === 'manager') {
      const accessibleIds = await resolveManagerAccountIds(user.id)
      const idArray = Array.from(accessibleIds)
      if (accountId && accessibleIds.has(accountId)) {
        where.channelAccountId = accountId
      } else if (idArray.length > 0) {
        where.channelAccountId = { in: idArray }
      } else {
        where.channelAccountId = '__none__'
      }
    }

    const pageNum = Math.max(1, parseInt(page))
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)))

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: {
            id: true, fullName: true, phone: true, email: true, avatarUrl: true, zaloUid: true,
            tags: true, leadScore: true, lifecycleStage: true, companyId: true,
            company: { select: { id: true, name: true } },
            // Customer 360 persistent AI fields — read by ContactAiSummary component
            aiSummary: true, aiSentimentLabel: true, aiSentimentConfidence: true, aiSentimentReason: true,
            aiIntent: true, aiPainPoints: true, aiCompetitors: true, aiSignals: true,
            aiAnalyzedAt: true, aiConversationId: true,
          } },
          channelAccount: { select: { id: true, displayName: true, externalUid: true, platform: true } },
          pins: { select: { id: true } },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: {
              id: true, content: true, contentType: true,
              senderType: true, senderName: true, sentAt: true, isDeleted: true,
            },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.conversation.count({ where }),
    ])

    return {
      conversations: conversations.map(c => ({
        ...c,
        contact: c.contact ? { ...c.contact, status: c.contact.lifecycleStage } : c.contact,
        isPinned: c.pins.length > 0,
      })),
      total,
      page: pageNum,
      limit: limitNum,
    }
  })

  // ── Get single conversation ─────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/v1/conversations/:id', { preHandler: requireZaloAccess() }, async (request, reply) => {
    const user = request.user as { orgId: string }
    const conv = await prisma.conversation.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
      include: {
        contact: { include: { company: { select: { id: true, name: true, industry: true, taxCode: true } } } },
        channelAccount: { select: { id: true, displayName: true, externalUid: true, status: true, platform: true } },
        pins: { select: { id: true } },
      },
    })
    if (!conv) return reply.status(404).send({ error: 'Not found' })
    return { ...conv, isPinned: conv.pins.length > 0 }
  })

  // ── Delete a conversation (owner/admin only) ────────────────────────
  // Removes the conversation and all its messages/reactions/pins/AI suggestions
  // via DB-level ON DELETE CASCADE. Audit-logged. This only deletes the local
  // CRM record — it does NOT touch the thread on Zalo.
  app.delete<{ Params: { id: string } }>('/api/v1/conversations/:id', async (request, reply) => {
    const user = request.user as { orgId: string; id: string; role: string }

    if (!['owner', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: 'Chỉ chủ sở hữu hoặc quản trị viên mới được xóa hội thoại' })
    }

    const conv = await prisma.conversation.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
      select: { id: true, displayName: true, contactId: true },
    })
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' })

    await prisma.conversation.delete({ where: { id: conv.id } })

    // Audit log — fire-and-forget
    prisma.activityLog.create({
      data: {
        orgId: user.orgId,
        userId: user.id,
        action: 'conversation.deleted',
        entityType: 'Conversation',
        entityId: conv.id,
        details: { displayName: conv.displayName, contactId: conv.contactId, by: user.id },
      },
    }).catch(err => logger.error({ err }, '[chat] activityLog create failed'))

    // Notify every open client so the conversation disappears from their list
    try {
      emitConvDeleted(user.orgId, conv.id)
    } catch { /* socket not ready */ }

    return { success: true }
  })

  // ── List messages for a conversation ────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess() }, async (request, reply) => {
    const user = request.user as { orgId: string }
    const { page = '1', limit = '50' } = request.query as QueryParams

    const conv = await prisma.conversation.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
      select: { id: true },
    })
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' })

    const pageNum = Math.max(1, parseInt(page))
    const limitNum = Math.min(200, parseInt(limit))

    const [rawMessages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: request.params.id },
        orderBy: { sentAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        select: {
          id: true, externalMsgId: true, senderUid: true, senderName: true,
          content: true, contentType: true, senderType: true, sentAt: true,
          isDeleted: true, quote: true, attachments: true,
          aiGenerated: true, aiReplyRunId: true, responseSource: true,
          repliedBy: { select: { fullName: true } }, // staff who sent (manual/ai_suggest)
          reactions: { select: { emoji: true, reactorId: true } },
          znsLog: { select: { status: true, deliveredAt: true } }, // ZNS delivery lifecycle
        },
      }),
      prisma.message.count({ where: { conversationId: request.params.id } }),
    ])

    const messages = rawMessages.map(transformMessageForFrontend)
    return { messages: messages.reverse(), total, page: pageNum, limit: limitNum }
  })

  // ── Thả / gỡ cảm xúc cho một tin nhắn ───────────────────────────────
  // DB là nguồn sự thật: ghi xong rồi mới đẩy sang Zalo. Zalo hỏng (mất kết
  // nối, hết hạn mức, tin không có externalMsgId) cũng KHÔNG làm hỏng request —
  // nhân viên vẫn thấy cảm xúc trong CRM, lý do trả về qua `reason`.
  app.post<{
    Params: { id: string; msgId: string }
    Body: { icon?: string; emoji?: string }
  }>('/api/v1/conversations/:id/messages/:msgId/reaction', { preHandler: requireZaloAccess() }, async (request, reply) => {
    const user = request.user as { orgId: string; id: string }
    const { id, msgId } = request.params
    // Giao diện gửi `icon`; nhận thêm `emoji` để client cũ vẫn chạy được.
    const rawEmoji = request.body?.icon ?? request.body?.emoji ?? ''
    const emoji = typeof rawEmoji === 'string' ? rawEmoji.trim() : ''

    const conv = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      select: {
        id: true,
        channelAccountId: true,
        externalThreadId: true,
        threadType: true,
        channelAccount: { select: { platform: true } },
      },
    })
    if (!conv) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' })

    const message = await prisma.message.findFirst({
      where: { id: msgId, conversationId: conv.id },
      select: { id: true, externalMsgId: true },
    })
    if (!message) return reply.status(404).send({ error: 'Không tìm thấy tin nhắn trong hội thoại này' })

    // Chuỗi rỗng = gỡ cảm xúc, nên chỉ kiểm tra khi có emoji.
    if (emoji !== '' && !isSupportedEmoji(emoji)) {
      return reply.status(400).send({ error: 'Zalo chỉ hỗ trợ các cảm xúc: 👍 ❤️ 😂 😮 😢 😡' })
    }

    // Cột `reactorId` vốn để lưu UID Zalo, nhưng cảm xúc thả từ CRM không có
    // UID Zalo tương ứng — dùng id nhân viên để vẫn giữ ràng buộc 1 người/1 tin.
    const reactorId = user.id
    const action: 'added' | 'removed' = emoji === '' ? 'removed' : 'added'

    if (action === 'added') {
      await prisma.messageReaction.upsert({
        where: { messageId_reactorId: { messageId: message.id, reactorId } },
        create: { messageId: message.id, reactorId, emoji },
        update: { emoji },
      })
    } else {
      // deleteMany: gỡ khi chưa từng thả cũng không được coi là lỗi.
      await prisma.messageReaction.deleteMany({ where: { messageId: message.id, reactorId } })
    }

    try {
      emitReaction(conv.id, message.id, emoji, action)
    } catch { /* socket not ready */ }

    // Chỉ Zalo cá nhân mới có API addReaction. Kênh khác vẫn ghi DB + bắn socket
    // để cảm xúc hiện trong CRM, chỉ bỏ bước đồng bộ ra ngoài.
    const forward = conv.channelAccount?.platform === Platform.ZALO_USER
      ? await forwardReactionToZalo({
          accountId: conv.channelAccountId,
          threadId: conv.externalThreadId ?? '',
          threadType: conv.threadType === 'group' ? 'group' : 'user',
          externalMsgId: message.externalMsgId ?? '',
          emoji,
        })
      : { forwarded: false, reason: 'kênh không hỗ trợ cảm xúc' }

    const reason = forward.forwarded ? undefined : (forward.reason ?? forward.error)
    if (!forward.forwarded) {
      logger.warn({ convId: conv.id, messageId: message.id, reason }, '[chat] cảm xúc chưa đẩy được sang Zalo')
    }

    return { ok: true, action, forwarded: forward.forwarded, ...(reason ? { reason } : {}) }
  })

  /**
   * Ghi đè luật "chỉ trả lời khi nhắc tên" cho riêng một hội thoại.
   *
   * `null` = trả về theo cài đặt chung của tổ chức. Người trực một nhóm biết rõ
   * nhóm đó cần gì hơn là một công tắc áp cho toàn tổ chức, nên giá trị đặt ở
   * đây thắng cài đặt chung.
   */
  app.patch<{
    Params: { id: string }
    Body: { requireMention: boolean | null }
  }>('/api/v1/conversations/:id/require-mention', async (request, reply) => {
    const user = request.user as { orgId: string; id: string }
    const gia_tri = request.body?.requireMention
    if (gia_tri !== null && typeof gia_tri !== 'boolean') {
      return reply.status(400).send({ error: 'requireMention phải là true, false hoặc null' })
    }

    const conv = await prisma.conversation.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
      select: { id: true, requireMention: true },
    })
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' })

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: { requireMention: gia_tri },
      select: { id: true, requireMention: true },
    })

    prisma.activityLog.create({
      data: {
        orgId: user.orgId,
        userId: user.id,
        action: 'conversation.require_mention_changed',
        entityType: 'Conversation',
        entityId: conv.id,
        details: { from: conv.requireMention, to: gia_tri, by: user.id },
      },
    }).catch(err => logger.error({ err }, '[chat] activityLog create failed'))

    return { convId: updated.id, requireMention: updated.requireMention }
  })

  // ── AI mode toggle ──────────────────────────────────────────────
  const VALID_AI_MODES = new Set(['manual', 'suggest', 'auto'])

  app.patch<{
    Params: { id: string }
    Body: { aiMode: string }
  }>('/api/v1/conversations/:id/ai-mode', async (request, reply) => {
    const user = request.user as { orgId: string; id: string }
    const { aiMode } = request.body

    if (!aiMode || !VALID_AI_MODES.has(aiMode)) {
      return reply.status(400).send({
        error: 'Invalid aiMode. Must be one of: manual, suggest, auto',
      })
    }

    const conv = await prisma.conversation.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
      select: { id: true, orgId: true, aiMode: true },
    })
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' })

    const prevMode = conv.aiMode
    const reason = `set by staff ${user.id}`

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: { aiMode, aiModeReason: reason },
      select: { id: true, aiMode: true, aiModeReason: true },
    })

    // Audit log — fire-and-forget
    prisma.activityLog.create({
      data: {
        orgId: user.orgId,
        userId: user.id,
        action: 'conversation.ai_mode_changed',
        entityType: 'Conversation',
        entityId: conv.id,
        details: { from: prevMode, to: aiMode, by: user.id },
      },
    }).catch(err => logger.error({ err }, '[chat] activityLog create failed'))

    // Emit realtime event
    try {
      emitAiModeChanged(user.orgId, conv.id, {
        convId: conv.id,
        aiMode,
        aiModeReason: reason,
        by: user.id,
      })
    } catch { /* socket not ready */ }

    return { convId: updated.id, aiMode: updated.aiMode, aiModeReason: updated.aiModeReason }
  })

  // ── AI pause toggle ─────────────────────────────────────────────
  // PATCH /api/v1/conversations/:id/ai-pause
  // Body: { minutes?: number } (default 60; minutes <= 0 clears pause)
  //       { until?: string }   (ISO datetime — alternative to minutes)
  // Any org member can call this.
  app.patch<{
    Params: { id: string }
    Body: { minutes?: number; until?: string }
  }>('/api/v1/conversations/:id/ai-pause', async (request, reply) => {
    const user = request.user as { orgId: string; id: string }
    const { minutes, until } = request.body ?? {}

    const conv = await prisma.conversation.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
      select: { id: true, orgId: true },
    })
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' })

    let aiPausedUntil: Date | null = null

    if (until) {
      const parsed = new Date(until)
      if (isNaN(parsed.getTime())) {
        return reply.status(400).send({ error: 'Invalid `until` datetime' })
      }
      aiPausedUntil = parsed
    } else if (minutes === undefined || minutes === null || minutes <= 0) {
      // Clear pause
      aiPausedUntil = null
    } else {
      const DEFAULT_PAUSE_MINUTES = 60
      const pauseMinutes = Math.min(minutes || DEFAULT_PAUSE_MINUTES, 1440) // cap at 24h
      aiPausedUntil = new Date(Date.now() + pauseMinutes * 60 * 1000)
    }

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: { aiPausedUntil },
      select: { id: true, aiPausedUntil: true, aiMode: true },
    })

    // Audit log — fire-and-forget
    prisma.activityLog.create({
      data: {
        orgId: user.orgId,
        userId: user.id,
        action: 'conversation.ai_paused',
        entityType: 'Conversation',
        entityId: conv.id,
        details: { aiPausedUntil: aiPausedUntil?.toISOString() ?? null, by: user.id },
      },
    }).catch(err => logger.error({ err }, '[chat] activityLog create failed'))

    // Emit realtime event
    try {
      emitAiModeChanged(user.orgId, conv.id, {
        convId: conv.id,
        aiMode: updated.aiMode ?? 'manual',
        aiModeReason: aiPausedUntil ? `paused_until:${aiPausedUntil.toISOString()}` : 'unpaused',
        by: user.id,
      })
    } catch { /* socket not ready */ }

    return {
      convId: updated.id,
      aiPausedUntil: updated.aiPausedUntil,
    }
  })

  // ── Backfill conversation message history ───────────────────────────
  app.post<{ Params: { id: string }; Body: { maxMessages?: number } }>(
    '/api/v1/conversations/:id/backfill',
    { preHandler: requireZaloAccess() },
    async (request, reply) => {
      const user = request.user as { orgId: string }
      const { maxMessages = 200 } = request.body || {}

      const conv = await prisma.conversation.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
        select: {
          id: true,
          channelAccountId: true,
          externalThreadId: true,
          threadType: true,
          displayName: true,
        },
      })
      if (!conv) return reply.status(404).send({ error: 'Conversation not found' })
      if (!conv.externalThreadId) return reply.status(400).send({ error: 'Conversation has no external thread ID' })

      const poolEntry = getPoolEntry(conv.channelAccountId)
      if (!poolEntry || !poolEntry.api || poolEntry.status !== 'connected') {
        return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' })
      }

      const threadType = conv.threadType === 'group' ? 'group' : 'user'
      const { backfillConversation } = await import('../zalo/zalo-message-sync.js')
      const result = await backfillConversation(
        poolEntry.api,
        conv.channelAccountId,
        conv.externalThreadId,
        threadType,
        maxMessages,
      )

      return {
        success: true,
        convId: conv.id,
        displayName: conv.displayName,
        ...result,
      }
    }
  )

  // ── Message routes (send text/image/file, shared media) ─────────
  await app.register(chatMessageRoutes)

  // ── Group routes (group-info, add-member, friends) ──────────────
  await app.register(chatGroupRoutes)
}

