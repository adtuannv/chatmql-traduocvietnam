import { Platform } from '../../shared/constants.js'
/**
 * zalo-routes.ts — Zalo account management routes.
 * Ported from ZaloCRM. QR login + zca-js SDK integration deferred to D9.
 */
import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import { prisma } from '../../shared/prisma-client.js'
import { Prisma } from '@prisma/client'
import { loginWithQR, disconnectAccount as poolDisconnect, reconnectWithSession, getPoolEntry, syncOnConnect, getDebugLog, getPoolStatus } from './zalo-pool.js'
import { getRateLimitStatus } from './zalo-rate-limiter.js'
import { logger } from '../../shared/logger.js'
import { resolveManagerAccountIds } from './zalo-access-middleware.js'

export async function zaloRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  // GET /api/v1/zalo-accounts — list accounts (soft-deleted ones are hidden)
  // Optional ?type=personal|oa filters by account type.
  // Optional ?includeDisabled=true to include disabled accounts.
  /**
   * Đánh dấu tài khoản Zalo là Business (Pro) hay thường.
   *
   * Zalo Business có hạn mức gửi và tính năng khác tài khoản thường, nên đội
   * vận hành cần nhìn là biết nick nào dùng được việc gì — trước đó dữ liệu có
   * sẵn trong cơ sở dữ liệu nhưng không chỗ nào hiện ra, cũng không sửa được.
   *
   * Chỉ áp cho Zalo cá nhân: OA là loại tài khoản khác, không có khái niệm này.
   */
  app.patch<{ Params: { id: string }; Body: { isBusiness?: boolean; businessTier?: string | null } }>(
    '/api/v1/zalo-accounts/:id/business',
    async (request, reply) => {
      const user = request.user as { orgId: string; role: string }
      if (user.role !== 'owner' && user.role !== 'admin') {
        return reply.code(403).send({ message: 'Chỉ quản trị mới đổi được đánh dấu này' })
      }

      const acc = await prisma.channelAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId, deletedAt: null },
        select: { id: true, platform: true },
      })
      if (!acc) return reply.code(404).send({ message: 'Không tìm thấy tài khoản' })
      if (acc.platform !== Platform.ZALO_USER) {
        return reply.code(400).send({ message: 'Chỉ đánh dấu được cho tài khoản Zalo cá nhân' })
      }

      const isBusiness = request.body.isBusiness ?? false
      // Hạ về tài khoản thường thì xoá luôn hạng: giữ lại "pro" trên một nick
      // không còn là business chỉ gây hiểu nhầm về sau.
      const tier = isBusiness ? (request.body.businessTier?.trim() || 'pro') : null

      const updated = await prisma.channelAccount.update({
        where: { id: acc.id },
        data: { isBusiness, businessTier: tier },
        select: { id: true, isBusiness: true, businessTier: true },
      })
      return updated
    },
  )

  app.get<{ Querystring: { type?: 'personal' | 'oa'; includeDisabled?: string } }>('/api/v1/zalo-accounts', async (request) => {
    const user = request.user as { orgId: string; id: string; role: string }
    const typeFilter = request.query.type
    const includeDisabled = request.query.includeDisabled === 'true'
    
    let accessibleAccountIds: Set<string> | null = null
    if (user.role === 'manager' || user.role === 'member') {
      accessibleAccountIds = await resolveManagerAccountIds(user.id)
    }

    const accounts = await prisma.channelAccount.findMany({
      where: {
        orgId: user.orgId,
        status: { not: 'archived' },
        deletedAt: null,
        ...(!includeDisabled ? { isDisabled: false } : {}),
        ...(typeFilter ? { platform: typeFilter === 'oa' ? Platform.ZALO_OA : typeFilter === 'personal' ? Platform.ZALO_USER : undefined } : {}),
        ...(accessibleAccountIds ? { id: { in: Array.from(accessibleAccountIds) } } : {}),
      },
      select: {
        id: true,
        platform: true,
        externalUid: true,
        externalPageId: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        isBusiness: true,
        businessTier: true,
        isDisabled: true,
        lastConnectedAt: true,
        createdAt: true,
        owner: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const result = accounts.map(a => {
      const poolEntry = getPoolEntry(a.id)
      // OA accounts are HTTP-based: if we have tokens (status=connected) we are live.
      const liveStatus = a.platform === Platform.ZALO_OA ? a.status ?? 'disconnected' : (poolEntry?.status ?? a.status ?? 'disconnected')
      return { ...a, liveStatus }
    })

    // Sort: connected first, then connecting/pending, then disconnected, with disabled at bottom
    result.sort((a, b) => {
      const getPriority = (acc: typeof a) => {
        if (acc.isDisabled) return 100
        const st = acc.liveStatus || acc.status || 'disconnected'
        if (st === 'connected') return 1
        if (st === 'connecting' || st === 'qr_pending') return 2
        if (st === 'webhook_pending' || st === 'token_expired') return 3
        return 4 // disconnected
      }
      const pA = getPriority(a)
      const pB = getPriority(b)
      if (pA !== pB) return pA - pB
      return (a.displayName || '').localeCompare(b.displayName || '', 'vi')
    })

    return result
  })

  // POST /api/v1/zalo-accounts/connect — QR-first: create temp + trigger QR in 1 call
  app.post<{ Body: { phone?: string } }>('/api/v1/zalo-accounts/connect', async (request, reply) => {
    const user = request.user as { orgId: string; id: string }
    const { phone } = request.body || {}

    // Create a temporary placeholder account (will be updated or revived after QR success)
    const account = await prisma.channelAccount.create({
      data: {
        orgId: user.orgId,
        ownerUserId: user.id,
        displayName: null,
        phone: phone || null,
        status: 'qr_pending',
      },
    })

    // Start QR login in background — QR delivered via Socket.IO
    loginWithQR(account.id, user.orgId).catch(err => {
      logger.error(`[zalo-routes] QR login failed for ${account.id}:`, err.message)
    })

    return reply.status(201).send({
      message: 'QR login initiated — watch for zalo:qr Socket.IO event',
      accountId: account.id,
    })
  })

  // PATCH /api/v1/zalo-accounts/:id — update account display name or toggle disabled
  app.patch<{ Params: { id: string }; Body: { displayName?: string; isDisabled?: boolean } }>('/api/v1/zalo-accounts/:id', async (request, reply) => {
    const user = request.user as { orgId: string }
    const { displayName, isDisabled } = request.body ?? {}

    const account = await prisma.channelAccount.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
    })
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    const updated = await prisma.channelAccount.update({
      where: { id: request.params.id },
      data: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(isDisabled !== undefined ? { isDisabled } : {}),
      },
    })

    if (isDisabled === true) {
      await poolDisconnect(request.params.id).catch(() => {})
    }

    return updated
  })


  // POST /api/v1/zalo-accounts/:id/login — initiate QR login
  app.post<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/login', async (request, reply) => {
    const user = request.user as { orgId: string }
    const account = await prisma.channelAccount.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
    })
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    // Start QR login in background — QR delivered via Socket.IO
    loginWithQR(account.id, user.orgId).catch(err => {
      logger.error(`[zalo-routes] QR login failed for ${account.id}:`, err.message)
    })

    return {
      message: 'QR login initiated — watch for zalo:qr Socket.IO event',
      accountId: account.id,
    }
  })

  // POST /api/v1/zalo-accounts/:id/reconnect — reconnect with saved session
  app.post<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/reconnect', async (request, reply) => {
    const user = request.user as { orgId: string }
    const account = await prisma.channelAccount.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
    })
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    const session = account.sessionData as { cookie: any; imei: string; userAgent: string } | null
    if (!session?.imei) {
      return reply.status(400).send({ error: 'No saved session — please login with QR first' })
    }

    // Reconnect in background
    reconnectWithSession(account.id, user.orgId, session).catch(err => {
      logger.error(`[zalo-routes] Reconnect failed for ${account.id}:`, err.message)
    })

    return { message: 'Reconnect initiated — watch for zalo:connected Socket.IO event', accountId: account.id }
  })

  // DELETE /api/v1/zalo-accounts/:id — soft-delete: disconnect + mark as deleted.
  //
  // We never hard-delete the ZaloAccount row because the schema cascades
  // would wipe every dependent Conversation (and via Conversation → every
  // Message, MessageReaction, PinnedConversation), plus all ZaloFriend /
  // ZaloGroup / ZaloGroupMember / DailyMessageStat / ChannelAccountAccess rows.
  // Users who hit "remove account" expect to disconnect the Zalo session,
  // not to lose years of chat history. Conversations + messages stay
  // accessible (read-only) under their original channelAccountId; the account
  // is filtered out of the integrations list by the deletedAt-IS-NULL clause.
  app.delete<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id', async (request, reply) => {
    const user = request.user as { orgId: string }
    const account = await prisma.channelAccount.findFirst({
      where: { id: request.params.id, orgId: user.orgId, deletedAt: null },
    })
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    // Soft-delete FIRST: mark as deleted + disabled so the connection watchdog
    // (which skips deletedAt / isDisabled rows) can't re-establish the session
    // in the gap before teardown finishes. The `revive on matching externalUid`
    // path in zalo-pool.ts clears these flags when the user explicitly re-pairs
    // the same Zalo number.
    await prisma.channelAccount.update({
      where: { id: request.params.id },
      data: {
        deletedAt: new Date(),
        status: 'disconnected',
        isDisabled: true,
      },
    })

    // Then stop the live listener + clean up the in-memory pool entry.
    await poolDisconnect(request.params.id).catch(() => {})

    return reply.status(204).send()
  })

  // GET /api/v1/zalo-accounts/:id/status — live status
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/status', async (request, reply) => {
    const user = request.user as { orgId: string }
    const account = await prisma.channelAccount.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
      select: { id: true, status: true },
    })
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    return { accountId: request.params.id, liveStatus: account.status }
  })

  // ── Backfill Chat History ───────────────────────────────────────────
  // POST /api/v1/zalo-accounts/:id/backfill — Trigger full historical backfill for an account
  app.post<{ Params: { id: string }; Body: { maxMessages?: number; includeFriends?: boolean } }>(
    '/api/v1/zalo-accounts/:id/backfill',
    async (request, reply) => {
      const user = request.user as { orgId: string }
      const { maxMessages = 200, includeFriends = false } = request.body || {}

      const account = await prisma.channelAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId, deletedAt: null },
      })
      if (!account) return reply.status(404).send({ error: 'Account not found' })

      const poolEntry = getPoolEntry(account.id)
      if (!poolEntry || !poolEntry.api || poolEntry.status !== 'connected') {
        return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' })
      }

      // Start backfill in background
      const { backfillAllAccountConversations, backfillFriendThreads } = await import('./zalo-message-sync.js')
      backfillAllAccountConversations(poolEntry.api, account.id, user.orgId, maxMessages)
        .then(async result => {
          logger.info(`[zalo-routes] Backfill finished for ${account.id}: +${result.totalInserted} messages`)
          // Quét bạn bè chạy NỐI TIẾP, không song song: hai vòng lặp cùng bắn vào
          // một tài khoản Zalo là cách nhanh nhất để bị khoá tạm.
          if (includeFriends) {
            logger.info(`[zalo-routes] Tiếp tục quét theo danh sách bạn bè cho ${account.id}`)
            const fr = await backfillFriendThreads(poolEntry.api, account.id, user.orgId, maxMessages)
            logger.info(`[zalo-routes] Quét bạn bè xong ${account.id}: ${fr.withHistory} người có lịch sử, +${fr.totalInserted} tin`)
          }
        })
        .catch(err => {
          logger.error(`[zalo-routes] Backfill failed for ${account.id}:`, err.message)
        })

      return {
        message: includeFriends
          ? 'Đã bắt đầu kéo lịch sử hội thoại, xong sẽ quét tiếp theo danh sách bạn bè. Theo dõi qua zalo:backfill-progress.'
          : 'Đã bắt đầu kéo lịch sử hội thoại. Theo dõi tiến độ qua sự kiện zalo:backfill-progress trên Socket.IO.',
        accountId: account.id,
        includeFriends,
      }
    }
  )

  // POST /api/v1/zalo-accounts/:id/backfill-friends — Kéo lịch sử theo DANH SÁCH BẠN BÈ
  // Khác /backfill ở chỗ: đi theo bạn bè đã đồng bộ, nên lấy được cả khách chưa
  // từng có hội thoại trong hệ thống (chat từ trước khi kết nối rồi im lặng).
  app.post<{ Params: { id: string }; Body: { maxMessages?: number; maxFriends?: number } }>(
    '/api/v1/zalo-accounts/:id/backfill-friends',
    async (request, reply) => {
      const user = request.user as { orgId: string }
      const { maxMessages = 200, maxFriends = 0 } = request.body || {}

      const account = await prisma.channelAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId, deletedAt: null },
      })
      if (!account) return reply.status(404).send({ error: 'Account not found' })

      const poolEntry = getPoolEntry(account.id)
      if (!poolEntry || !poolEntry.api || poolEntry.status !== 'connected') {
        return reply.status(400).send({ error: 'Tài khoản Zalo chưa kết nối' })
      }

      const friendCount = await prisma.channelContact.count({ where: { channelAccountId: account.id } })
      if (friendCount === 0) {
        return reply.status(400).send({
          error: 'Chưa có danh sách bạn bè cho tài khoản này — kết nối lại để hệ thống đồng bộ bạn bè trước.',
        })
      }

      const { backfillFriendThreads } = await import('./zalo-message-sync.js')
      backfillFriendThreads(poolEntry.api, account.id, user.orgId, maxMessages, maxFriends)
        .then(r => logger.info(`[zalo-routes] Backfill bạn bè xong ${account.id}: ${r.withHistory} người có lịch sử, +${r.totalInserted} tin`))
        .catch(err => logger.error(`[zalo-routes] Backfill bạn bè lỗi ${account.id}:`, err.message))

      return {
        message: 'Đã bắt đầu quét lịch sử theo danh sách bạn bè. Theo dõi qua sự kiện zalo:backfill-progress (mode=friends).',
        accountId: account.id,
        friendCount,
      }
    }
  )

  // GET /api/v1/zalo-accounts/:id/test-history/:threadId — Diagnostic test for 1-1 history API
  app.get<{ Params: { id: string; threadId: string } }>(
    '/api/v1/zalo-accounts/:id/test-history/:threadId',
    async (request, reply) => {
      const { id, threadId } = request.params
      const poolEntry = getPoolEntry(id)
      if (!poolEntry || !poolEntry.api) {
        return reply.status(400).send({ error: 'Tài khoản chưa kết nối trong pool' })
      }
      const api = poolEntry.api as any
      const ctx = api.listener?.ctx || api.getContext?.() || {}
      const results: any[] = []

      // Test combinations of endpoints and params
      const tests = [
        { service: api.zpwServiceMap?.chat?.[0] || 'https://chat3-wpa.chat.zalo.me', path: '/api/message/history', params: { toid: threadId, count: 20 } },
        { service: api.zpwServiceMap?.chat?.[0] || 'https://chat3-wpa.chat.zalo.me', path: '/api/message/history', params: { toid: threadId, count: 20, imei: ctx.imei } },
        { service: api.zpwServiceMap?.chat?.[0] || 'https://chat3-wpa.chat.zalo.me', path: '/api/message/list', params: { toid: threadId, count: 20 } },
        { service: api.zpwServiceMap?.chat?.[0] || 'https://chat3-wpa.chat.zalo.me', path: '/api/message/list', params: { convId: threadId, count: 20, globalMsgId: 0 } },
        { service: api.zpwServiceMap?.conversation?.[0] || 'https://tt-conversation-wpa.chat.zalo.me', path: '/api/conversation/history', params: { toid: threadId, count: 20 } },
        { service: api.zpwServiceMap?.conversation?.[0] || 'https://tt-conversation-wpa.chat.zalo.me', path: '/api/conv/getmessage', params: { toid: threadId, count: 20 } },
      ]

      for (const t of tests) {
        try {
          const res = await api.custom(`test_${Date.now()}_${Math.random()}`, async ({ utils }: any) => {
            const url = utils.makeURL(`${t.service}${t.path}`);
            const encryptedParams = utils.encodeAES(JSON.stringify(t.params));
            const response = await utils.request(utils.makeURL(url, { params: encryptedParams }), { method: 'GET' });
            return response;
          })({});
          results.push({ test: t, status: 'ok', data: res });
        } catch (err: any) {
          results.push({ test: t, status: 'error', error: err.message, stack: err.stack });
        }
      }

      return {
        zpwServiceMap: api.zpwServiceMap,
        ctx: { uid: ctx.uid, imei: ctx.imei ? 'exists' : 'missing' },
        results
      }
    }
  )


  // GET /api/v1/zalo-accounts/:id/stats — Statistics of contacts and messages
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/stats', async (request, reply) => {
    const user = request.user as { orgId: string }
    const account = await prisma.channelAccount.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
    })
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    const [contacts, conversations, messages] = await Promise.all([
      prisma.channelContact.count({ where: { channelAccountId: account.id } }),
      prisma.conversation.count({ where: { channelAccountId: account.id } }),
      prisma.message.count({ where: { conversation: { channelAccountId: account.id } } }),
    ])

    return { contacts, conversations, messages }
  })

  // ── Zalo Account Access (ACL) ───────────────────────────────────────
  // GET /api/v1/zalo-accounts/:id/access — list users with access
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/access', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }

    // Only owner/admin can view access list
    if (user.role !== 'owner' && user.role !== 'admin') {
      return reply.status(403).send({ error: 'Chỉ owner/admin mới có thể xem danh sách quyền' })
    }

    const account = await prisma.channelAccount.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
    })
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    const access = await prisma.channelAccountAccess.findMany({
      where: { channelAccountId: request.params.id },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    })
    return access
  })

  // POST /api/v1/zalo-accounts/:id/access — grant access
  // Binary access model: presence of a row = full access. The legacy
  // `permission` column is kept for backward compat and pinned to 'admin'.
  app.post<{ Params: { id: string }; Body: { userId: string } }>(
    '/api/v1/zalo-accounts/:id/access',
    async (request, reply) => {
      const user = request.user as { orgId: string; role: string }
      const { userId } = request.body

      // Only owner/admin can manage access
      if (user.role !== 'owner' && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Chỉ owner/admin mới có thể quản lý quyền truy cập' })
      }

      if (!userId) {
        return reply.status(400).send({ error: 'userId is required' })
      }

      const account = await prisma.channelAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
      })
      if (!account) return reply.status(404).send({ error: 'Account not found' })

      // Verify target user belongs to same org
      const targetUser = await prisma.user.findFirst({
        where: { id: userId, orgId: user.orgId },
        select: { id: true, fullName: true },
      })
      if (!targetUser) return reply.status(404).send({ error: 'User not found in org' })

      const access = await prisma.channelAccountAccess.upsert({
        where: { channelAccountId_userId: { channelAccountId: request.params.id, userId } },
        update: { permission: 'admin' },
        create: { channelAccountId: request.params.id, userId, permission: 'admin' },
        include: { user: { select: { id: true, fullName: true, email: true } } },
      })
      return access
    },
  )

  // DELETE /api/v1/zalo-accounts/:id/access/:userId — revoke access
  app.delete<{ Params: { id: string; userId: string } }>(
    '/api/v1/zalo-accounts/:id/access/:userId',
    async (request, reply) => {
      const user = request.user as { orgId: string; role: string }

      // Only owner/admin can revoke access
      if (user.role !== 'owner' && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Chỉ owner/admin mới có thể thu hồi quyền' })
      }

      const account = await prisma.channelAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
      })
      if (!account) return reply.status(404).send({ error: 'Account not found' })

      const deleted = await prisma.channelAccountAccess.deleteMany({
        where: { channelAccountId: request.params.id, userId: request.params.userId },
      })

      if (deleted.count === 0) {
        return reply.status(404).send({ error: 'Access entry not found' })
      }

      return { success: true, message: 'Đã thu hồi quyền truy cập' }
    },
  )

  // GET /api/v1/zalo-accounts/:id/rate-status — rate limit remaining quotas
  app.get<{ Params: { id: string } }>('/api/v1/zalo-accounts/:id/rate-status', async (request, reply) => {
    const user = request.user as { orgId: string }
    const account = await prisma.channelAccount.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
    })
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    return getRateLimitStatus(request.params.id)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // D9.3 — Zalo Friends
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/v1/zalo-accounts/:id/friends
  app.get<{
    Params: { id: string }
    Querystring: { search?: string; limit?: string; cursor?: string; favorites?: string }
  }>('/api/v1/zalo-accounts/:id/friends', async (request, reply) => {
    const user = request.user as { orgId: string }
    const account = await prisma.channelAccount.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
    })
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    const { search, limit = '50', cursor, favorites } = request.query
    const take = Math.min(parseInt(limit), 100)

    const friends = await prisma.channelContact.findMany({
      where: {
        channelAccountId: request.params.id,
        orgId: user.orgId,
        ...(search ? { displayName: { contains: search, mode: 'insensitive' } } : {}),
        ...(favorites === 'true' ? { isFavorite: true } : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
        isBlocked: false,
      },
      take,
      orderBy: [{ isFavorite: 'desc' }, { displayName: 'asc' }],
    })

    return {
      friends,
      nextCursor: friends.length === take ? friends[friends.length - 1].id : null,
      total: friends.length,
    }
  })

  // POST /api/v1/zalo-accounts/:id/friends/sync — sync from Zalo (stub)
  app.post<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/friends/sync',
    async (request, reply) => {
      const user = request.user as { orgId: string }
      const account = await prisma.channelAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
      })
      if (!account) return reply.status(404).send({ error: 'Account not found' })

      // Try live sync via pool's zca-js API
      const poolEntry = getPoolEntry(request.params.id)
      if (poolEntry?.api && poolEntry.status === 'connected') {
        try {
          const api = poolEntry.api as any
          if (typeof api.getAllFriends !== 'function') {
            return { synced: 0, message: 'zca-js does not expose getAllFriends' }
          }
          const friendsResult = await api.getAllFriends()
          const friends: any[] = friendsResult?.data || friendsResult || []
          let synced = 0

          for (const f of friends) {
            const uid = f.userId || f.uid || f.id
            const name = f.displayName || f.zaloName || f.dName || f.name || `Zalo ${String(uid).slice(-4)}`
            if (!uid) continue

            await prisma.channelContact.upsert({
              where: {
                channelAccountId_friendUid: { channelAccountId: request.params.id, friendUid: String(uid) },
              },
              update: {
                displayName: name,
                avatarUrl: f.avatar || f.avatarUrl || null,
              },
              create: {
                orgId: user.orgId,
                channelAccountId: request.params.id,
                friendUid: String(uid),
                displayName: name,
                avatarUrl: f.avatar || f.avatarUrl || null,
              },
            })
            synced++
          }
          return { synced, message: `Đã đồng bộ ${synced} bạn bè từ Zalo` }
        } catch (err: any) {
          logger.warn(`[zalo-routes] Friend sync failed:`, err.message)
          return reply.status(500).send({ error: `Sync failed: ${err.message}` })
        }
      }

      // Fallback: return current DB count when not connected
      const count = await prisma.channelContact.count({ where: { channelAccountId: request.params.id } })
      return { synced: count, message: 'Tài khoản Zalo chưa kết nối — hiển thị dữ liệu đã lưu' }
    }
  )

  // POST /api/v1/zalo-accounts/:id/sync — Alias for friends/sync
  app.post<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/sync',
    async (request, reply) => {
      const user = request.user as { orgId: string }
      const account = await prisma.channelAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
      })
      if (!account) return reply.status(404).send({ error: 'Account not found' })

      const poolEntry = getPoolEntry(request.params.id)
      if (poolEntry?.api && poolEntry.status === 'connected') {
        try {
          const api = poolEntry.api as any
          if (typeof api.getAllFriends === 'function') {
            const friendsResult = await api.getAllFriends()
            const friends: any[] = friendsResult?.data || friendsResult || []
            let synced = 0
            for (const f of friends) {
              const uid = f.userId || f.uid || f.id
              const name = f.displayName || f.zaloName || f.dName || f.name || `Zalo ${String(uid).slice(-4)}`
              if (!uid) continue
              await prisma.channelContact.upsert({
                where: { channelAccountId_friendUid: { channelAccountId: request.params.id, friendUid: String(uid) } },
                update: { displayName: name, avatarUrl: f.avatar || f.avatarUrl || null },
                create: { orgId: user.orgId, channelAccountId: request.params.id, friendUid: String(uid), displayName: name, avatarUrl: f.avatar || f.avatarUrl || null },
              })
              synced++
            }
            return { synced, message: `Đã đồng bộ ${synced} bạn bè từ Zalo` }
          }
        } catch (err: any) {
          logger.warn(`[zalo-routes] Sync failed:`, err.message)
          return reply.status(500).send({ error: `Sync failed: ${err.message}` })
        }
      }
      const count = await prisma.channelContact.count({ where: { channelAccountId: request.params.id } })
      return { synced: count, message: 'Tài khoản Zalo chưa kết nối' }
    }
  )


  // PATCH /api/v1/zalo-accounts/:id/friends/:friendId — toggle favorite / blocked
  app.patch<{
    Params: { id: string; friendId: string }
    Body: { isFavorite?: boolean; isBlocked?: boolean }
  }>('/api/v1/zalo-accounts/:id/friends/:friendId', async (request, reply) => {
    const user = request.user as { orgId: string }
    const { isFavorite, isBlocked } = request.body

    const friend = await prisma.channelContact.findFirst({
      where: { id: request.params.friendId, channelAccountId: request.params.id, orgId: user.orgId },
    })
    if (!friend) return reply.status(404).send({ error: 'Friend not found' })

    const updated = await prisma.channelContact.update({
      where: { id: request.params.friendId },
      data: {
        ...(isFavorite !== undefined ? { isFavorite } : {}),
        ...(isBlocked !== undefined ? { isBlocked } : {}),
      },
    })
    return updated
  })

  // ═══════════════════════════════════════════════════════════════════════
  // D9.4 — Zalo Groups
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/v1/zalo-accounts/:id/groups
  app.get<{
    Params: { id: string }
    Querystring: { search?: string; limit?: string; cursor?: string }
  }>('/api/v1/zalo-accounts/:id/groups', async (request, reply) => {
    const user = request.user as { orgId: string }
    const account = await prisma.channelAccount.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
    })
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    const { search, limit = '50', cursor } = request.query
    const take = Math.min(parseInt(limit), 100)

    const groups = await prisma.channelGroup.findMany({
      where: {
        channelAccountId: request.params.id,
        orgId: user.orgId,
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      take,
      orderBy: [{ isAdmin: 'desc' }, { memberCount: 'desc' }, { name: 'asc' }],
    })

    return {
      groups,
      nextCursor: groups.length === take ? groups[groups.length - 1].id : null,
      total: groups.length,
    }
  })

  // POST /api/v1/zalo-accounts/:id/groups/sync — sync from Zalo (stub)
  app.post<{ Params: { id: string } }>(
    '/api/v1/zalo-accounts/:id/groups/sync',
    async (request, reply) => {
      const user = request.user as { orgId: string }
      const account = await prisma.channelAccount.findFirst({
        where: { id: request.params.id, orgId: user.orgId },
      })
      if (!account) return reply.status(404).send({ error: 'Account not found' })

      const count = await prisma.channelGroup.count({ where: { channelAccountId: request.params.id } })
      return { synced: count, message: 'Live sync requires connected Zalo account (D9.6)' }
    }
  )

  // PATCH /api/v1/zalo-accounts/:id/groups/:groupId — toggle muted
  app.patch<{
    Params: { id: string; groupId: string }
    Body: { isMuted?: boolean }
  }>('/api/v1/zalo-accounts/:id/groups/:groupId', async (request, reply) => {
    const user = request.user as { orgId: string }
    const { isMuted } = request.body

    const group = await prisma.channelGroup.findFirst({
      where: { id: request.params.groupId, channelAccountId: request.params.id, orgId: user.orgId },
    })
    if (!group) return reply.status(404).send({ error: 'Group not found' })

    const updated = await prisma.channelGroup.update({
      where: { id: request.params.groupId },
      data: { ...(isMuted !== undefined ? { isMuted } : {}) },
    })
    return updated
  })

  // ── Debug: in-memory Zalo event log (not persisted, 500 recent) ─────
  // Admin-only: owner/admin can view event log for auditing.
  app.get<{ Querystring: { search?: string; source?: 'personal' | 'oa' | 'all'; limit?: string } }>(
    '/api/v1/debug/zalo-events',
    async (request, reply) => {
      const user = request.user as { role: string }
      if (user.role !== 'owner' && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Chỉ admin mới có quyền xem nhật ký sự kiện' })
      }

      const { search, source = 'all', limit = '100' } = request.query
      let entries = getDebugLog()

      // Filter by source: personal = no 'oa:' prefix, oa = 'oa:' prefix
      if (source === 'oa') {
        entries = entries.filter(e => e.accountId.startsWith('oa:'))
      } else if (source === 'personal') {
        entries = entries.filter(e => !e.accountId.startsWith('oa:'))
      }

      // Search in event name, summary, accountId
      if (search) {
        const q = search.toLowerCase()
        entries = entries.filter(e =>
          e.event.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.accountId.toLowerCase().includes(q),
        )
      }

      // Return newest first, capped
      const take = Math.min(parseInt(limit) || 100, 500)
      return entries.slice(-take).reverse()
    },
  )

  // ── D9.6 — Org-wide pool snapshot for ops monitoring ─────────────────
  // Returns the live state of every Zalo account in the user's org so admins
  // can see at a glance which sessions are active / connecting / disconnected.
  //
  // SECURITY: must NEVER serialize the full PoolEntry — its `api` field is a
  // live `ZaloAPI` instance whose nested `listener.ctx` holds the Zalo session
  // (imei + cookie + secretKey). We project to a safe primitives-only shape.
  // Also gated to owner/admin/manager — members can't see other staff's
  // session state across the whole org.
  app.get('/api/v1/zalo/pool/status', async (request, reply) => {
    const user = request.user as { orgId: string; role: string }
    if (!['owner', 'admin', 'manager'].includes(user.role)) {
      return reply.status(403).send({ error: 'Bạn không có quyền xem trạng thái pool' })
    }
    const entries = await getPoolStatus(user.orgId)
    const safeEntries = entries.map((e) => ({
      accountId: e.accountId,
      orgId: e.orgId,
      status: e.status,
      connected: !!e.api,
      connectedAt: e.connectedAt ?? null,
    }))
    const summary = safeEntries.reduce(
      (acc, e) => {
        const status = e.status ?? 'unknown'
        acc[status] = (acc[status] ?? 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )
    return {
      total: safeEntries.length,
      summary,
      entries: safeEntries,
    }
  })
}
