/**
 * simulate-routes.ts — API-driven sandbox for the AI auto-reply harness.
 *
 * Lets an owner/admin drive the whole "respond → inspect → improve → re-test"
 * loop over HTTP, WITHOUT the Zalo channel or the chat UI. Used to validate that
 * the debug/trace info is truthful + useful and to run human-feedback improvement
 * cycles programmatically.
 *
 * Endpoints (owner/admin only):
 *   POST /api/v1/ai/simulate/conversation
 *     body: { name?, aiMode?='auto' }
 *     → creates a VIRTUAL contact + conversation on a dedicated 🧪 sandbox channel
 *       so you can simulate a multi-turn chat that IS recorded into history, without
 *       touching any real customer's conversation. Returns { conversationId, contactId }.
 *
 *   POST /api/v1/ai/simulate/reply
 *     body: { conversationId, customerText, mode?='suggest', includeTrace?=true, persist? }
 *     → runs runHarness() as if the customer just sent `customerText`. For a sandbox
 *       conversation `persist` DEFAULTS TO TRUE (omit it) — the customer turn + AI reply
 *       are recorded into history so the thread builds up turn by turn and stays reviewable.
 *       Pass persist:false ONLY for a pure dry-run (e.g. A/B before/after a logic change).
 *       Returns reply + decision + AiReplyRun id + (by default) the full trace.
 *
 *   GET /api/v1/ai/simulate/case-context?conversationId=&runId=&messageId=
 *     → returns exactly what the AI Master would see as "case under review".
 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import { prisma } from '../../shared/prisma-client.js'
import { sendImageCore } from '../chat/send-image-core.js'
import { runHarness } from './harness/reply-generator.js'
import { loadCaseContext } from './master/master-agent.js'

const SANDBOX_CHANNEL_DISPLAY = '🧪 AI Sandbox'
const sandboxUid = (orgId: string) => `ai-sandbox-${orgId}`

function ownerAdminOnly(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user as { role: string }
  if (!['owner', 'admin'].includes(user.role)) {
    reply.status(403).send({ error: 'Chỉ owner/admin được dùng AI sandbox' })
    return false
  }
  return true
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Find or create the per-org virtual channel that hosts all sandbox conversations. */
async function getOrCreateSandboxChannel(orgId: string, ownerUserId: string): Promise<string> {
  const uid = sandboxUid(orgId)
  const existing = await prisma.channelAccount.findFirst({
    where: { orgId, externalUid: uid },
    select: { id: true },
  })
  if (existing) return existing.id
  const created = await prisma.channelAccount.create({
    data: {
      orgId,
      ownerUserId,
      externalUid: uid,
      displayName: SANDBOX_CHANNEL_DISPLAY,
      platform: 2, // personal-style virtual channel (Int); never actually connects
      status: 'disconnected',
    },
    select: { id: true },
  })
  return created.id
}

export async function simulateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  // ── Create a virtual sandbox conversation (recorded into history) ──────────
  app.post<{
    Body: { name?: string; aiMode?: string }
  }>('/api/v1/ai/simulate/conversation', async (request, reply) => {
    if (!ownerAdminOnly(request, reply)) return
    const user = request.user as { orgId: string; id: string }
    const { name, aiMode } = request.body ?? {}
    const effMode = ['manual', 'suggest', 'auto'].includes(aiMode ?? '') ? aiMode! : 'auto'

    try {
      const channelId = await getOrCreateSandboxChannel(user.orgId, user.id)
      const contact = await prisma.contact.create({
        data: { orgId: user.orgId, fullName: name?.trim() || '🧪 Khách ảo (sandbox)' },
        select: { id: true, fullName: true },
      })
      const conv = await prisma.conversation.create({
        data: {
          orgId: user.orgId,
          channelAccountId: channelId,
          contactId: contact.id,
          threadType: 'user',
          externalThreadId: `sandbox-${randomUUID()}`,
          displayName: contact.fullName,
          aiMode: effMode,
          lastMessageAt: new Date(),
        },
        select: { id: true },
      })
      return reply.status(201).send({
        conversationId: conv.id,
        contactId: contact.id,
        contactName: contact.fullName,
        aiMode: effMode,
        note: 'Hội thoại sandbox — dùng simulate/reply với persist=true để ghi lịch sử nhiều lượt.',
      })
    } catch (err) {
      app.log.error({ err }, '[simulate] create conversation failed')
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  // ── List sandbox conversations (to find ids to test against) ───────────────
  app.get('/api/v1/ai/simulate/conversations', async (request, reply) => {
    if (!ownerAdminOnly(request, reply)) return
    const user = request.user as { orgId: string }
    try {
      const channel = await prisma.channelAccount.findFirst({
        where: { orgId: user.orgId, externalUid: sandboxUid(user.orgId) },
        select: { id: true },
      })
      if (!channel) return { conversations: [] }
      const convs = await prisma.conversation.findMany({
        where: { orgId: user.orgId, channelAccountId: channel.id },
        orderBy: { lastMessageAt: 'desc' },
        select: {
          id: true, displayName: true, aiMode: true, lastMessageAt: true,
          _count: { select: { messages: true } },
        },
      })
      return { conversations: convs }
    } catch (err) {
      app.log.error({ err }, '[simulate] list conversations failed')
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  // ── Simulate a customer turn through the harness ───────────────────────────
  app.post<{
    Body: { conversationId?: string; customerText?: string; mode?: string; includeTrace?: boolean; persist?: boolean; botId?: string }
  }>('/api/v1/ai/simulate/reply', async (request, reply) => {
    if (!ownerAdminOnly(request, reply)) return
    const user = request.user as { orgId: string }
    const { conversationId, customerText, mode, includeTrace = true, persist, botId } = request.body ?? {}

    if (!conversationId || !customerText?.trim()) {
      return reply.status(400).send({ error: 'conversationId và customerText là bắt buộc' })
    }
    const text = customerText.trim()

    // org-scope guard + load channel (for the sandbox-only persist guard)
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, orgId: user.orgId },
      select: { id: true, channelAccount: { select: { externalUid: true } } },
    })
    if (!conv) return reply.status(404).send({ error: 'Conversation không tồn tại trong tổ chức' })

    const isSandbox = conv.channelAccount?.externalUid === sandboxUid(user.orgId)
    // Sandbox conversations record history by DEFAULT (the sandbox exists to be a
    // reviewable multi-turn test thread). Pass persist:false explicitly for a pure
    // dry-run (e.g. A/B before/after a logic change). Real customer convs never persist.
    const effPersist = persist === undefined ? isSandbox : persist
    if (effPersist && !isSandbox) {
      return reply.status(400).send({
        error: 'persist chỉ dùng cho hội thoại sandbox (tránh ghi nhầm vào hội thoại khách thật). Tạo qua POST /ai/simulate/conversation.',
      })
    }

    const effMode = mode === 'auto' ? 'auto' : 'suggest'
    // Anchor both messages to the turn's start time (NOT Date.now() after the harness),
    // so the AI reply sorts right after its own customer turn — not after the next turn.
    const turnAt = new Date()
    const replyAt = new Date(turnAt.getTime() + 1)
    try {
      // Persist the customer turn FIRST so the harness transcript includes it (matches real flow).
      if (effPersist) {
        await prisma.message.create({
          data: { conversationId, senderType: 'contact', content: text, contentType: 'text', sentAt: turnAt },
        })
      }

      // botId: thử NGHIỆM một Agent cụ thể mà không cần gán kênh cho nó trước.
      const result = await runHarness(user.orgId, conversationId, text, effMode, { forceBotId: botId })

      // Persist the AI reply (if any) so the thread builds up turn by turn.
      let replyMessageId: string | undefined
      if (effPersist && result.reply) {
        const msg = await prisma.message.create({
          data: {
            conversationId,
            senderType: 'self',
            content: result.reply,
            contentType: 'text',
            sentAt: replyAt,
            aiGenerated: true,
            aiReplyRunId: result.runId ?? null,
            responseSource: effMode === 'auto' ? 'ai_auto' : 'ai_suggest',
          },
          select: { id: true },
        })
        replyMessageId = msg.id
      }

      // Ảnh AI muốn gửi cũng phải hiện trong luồng test. Trước đây chỉ phần chữ
      // được ghi lại, nên người test thấy AI nói "em gửi ảnh rồi ạ" mà chẳng
      // có ảnh nào — tưởng tính năng hỏng trong khi nó chạy đúng.
      //
      // Hội thoại sandbox không gắn với Zalo thật nên không có gì bay ra ngoài;
      // sendImageCore chỉ ghi bản ghi ảnh vào luồng.
      if (effPersist && result.images?.length) {
        for (const [i, img] of result.images.entries()) {
          try {
            await sendImageCore({
              orgId: user.orgId,
              conversationId,
              imageUrl: img.imageUrl,
              caption: img.caption,
              sender: 'ai',
              aiReplyRunId: result.runId ?? null,
            })
          } catch (err) {
            request.log.warn({ err, product: img.productName }, '[simulate] không ghi được ảnh vào luồng test')
          }
          void i
        }
      }

      if (effPersist) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: replyAt },
        }).catch(() => {})
      }

      let trace: unknown[] | undefined
      if (includeTrace && result.runId) {
        await sleep(400) // let fire-and-forget trace rows land
        trace = await prisma.aiTrace.findMany({
          where: { orgId: user.orgId, aiReplyRunId: result.runId },
          orderBy: { createdAt: 'asc' },
          select: { step: true, level: true, payload: true, latencyMs: true },
        })
      }

      return {
        runId: result.runId,
        reply: result.reply,
        // Ảnh AI định gửi kèm — hiện ra để quản trị kiểm tra trước khi bật thật.
        images: result.images ?? [],
        handoff: result.handoff ?? null,
        routerDecision: result.routerDecision ?? null,
        persisted: effPersist,
        ...(replyMessageId ? { replyMessageId } : {}),
        ...(trace ? { trace } : {}),
      }
    } catch (err) {
      app.log.error({ err }, '[simulate] reply failed')
      return reply.status(500).send({ error: 'Harness lỗi: ' + (err as Error).message })
    }
  })

  // ── Inspect the case context the Master would receive ──────────────────────
  app.get<{
    Querystring: { conversationId?: string; runId?: string; messageId?: string }
  }>('/api/v1/ai/simulate/case-context', async (request, reply) => {
    if (!ownerAdminOnly(request, reply)) return
    const user = request.user as { orgId: string }
    const { conversationId, runId, messageId } = request.query

    if (!conversationId && !runId && !messageId) {
      return reply.status(400).send({ error: 'cần conversationId, runId hoặc messageId' })
    }
    try {
      const ctx = await loadCaseContext(user.orgId, {
        conversationId: conversationId ?? null,
        aiReplyRunId: runId ?? null,
        messageId: messageId ?? null,
      })
      if (!ctx) return reply.status(404).send({ error: 'Không dựng được case context' })
      return { caseContext: ctx }
    } catch (err) {
      app.log.error({ err }, '[simulate] case-context failed')
      return reply.status(500).send({ error: (err as Error).message })
    }
  })
}
