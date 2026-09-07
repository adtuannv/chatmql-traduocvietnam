/**
 * ai-routes.ts — D5.6+: AI HTTP layer.
 * Thin wrapper over ai-service.ts. Auth + per-conversation access checks live here.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authMiddleware } from '../auth/auth-middleware.js'
import { analyzeCustomer360 } from './customer360-service.js'
import { prisma } from '../../shared/prisma-client.js'
import {
  getAiConfig,
  updateAiConfig,
  getAiUsage,
  generateAiOutput,
  scoreLeadFromConversation,
  analyzeConversation,
  getAvailableProviders,
} from './ai-service.js'
import {
  saveProviderApiKey,
  deleteProviderApiKey,
  verifyProviderApiKey,
  applyDefaultModeToAllConversations,
  getAiScheduleConfig,
  saveAiScheduleConfig,
  isAfterHours,
} from './ai-config-service.js'
import { getToolsConfig, applyToolsPatch } from './tools-config-service.js'
import { getEffectiveConfigForTask } from './ai-config-service.js'
import { getContextBudgets, resolveBudgetTier } from './harness/budgets.js'
import { listPendingActions, confirmAction, rejectAction, type PendingActionStatus } from './pending-action-service.js'
import {
  getLogicDocs,
  getLogicDoc,
  getLogicDocVersions,
  upsertLogicDoc,
  revertLogicDoc,
  seedDefaultLogicDocs,
  isValidDocType,
  type AiLogicDocType,
} from './logic-doc-service.js'

async function assertConversationAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  conversationId: string,
): Promise<boolean> {
  const user = request.user as { id: string; role: string; orgId: string }
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId: user.orgId },
    select: { id: true, channelAccountId: true },
  })
  if (!conversation) {
    reply.status(404).send({ error: 'Conversation not found' })
    return false
  }
  if (['owner', 'admin', 'manager'].includes(user.role)) return true

  const access = await prisma.channelAccountAccess.findFirst({
    where: { channelAccountId: conversation.channelAccountId, userId: user.id },
    select: { id: true },
  })
  if (!access) {
    reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' })
    return false
  }
  return true
}

/**
 * Map an internal/provider error to an HTTP status + a useful, user-facing
 * message. Earlier this hid every provider failure (eg invalid OpenAI key)
 * behind a generic 500 fallback, so the UI just showed "Failed to summarize
 * conversation" with no actionable info. We now:
 *   1. Match a wider set of provider-error patterns
 *   2. Translate the common ones to Vietnamese for end users
 *   3. Pass through the original message (truncated) when nothing matches,
 *      instead of swallowing it into the English fallback.
 */
function statusFromError(err: unknown, fallback: string): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : ''
  const lower = raw.toLowerCase()

  // Quota / rate limits ────────────────────────────────────────────────
  if (lower.includes('quota exceeded')) {
    return { status: 429, message: 'Đã vượt hạn mức AI hôm nay. Tăng giới hạn ở Cài đặt → AI hoặc thử lại ngày mai.' }
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return { status: 429, message: `Provider giới hạn tốc độ — thử lại sau ít phút. (${raw.slice(0, 160)})` }
  }

  // Auth — invalid / missing key ──────────────────────────────────────
  if (lower.includes('not configured')) {
    return { status: 400, message: 'Provider AI chưa được cấu hình API key. Vào Cài đặt → AI để thêm key.' }
  }
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key') ||
    lower.includes('api key seems too short') ||
    lower.includes('api key cannot be empty')
  ) {
    return { status: 401, message: `API key không hợp lệ hoặc đã hết hạn. Vào Cài đặt → AI để cập nhật. (${raw.slice(0, 160)})` }
  }

  // Disabled / config issues ──────────────────────────────────────────
  if (lower.includes('disabled')) {
    return { status: 400, message: 'AI đang tắt cho tổ chức của bạn. Bật ở Cài đặt → AI.' }
  }
  if (lower.includes('unknown provider') || lower.includes('unsupported provider')) {
    return { status: 400, message: raw }
  }

  // Not found ─────────────────────────────────────────────────────────
  if (lower.includes('not found')) {
    return { status: 404, message: raw }
  }

  // Provider HTTP error with status code (4xx → 502, 5xx → 502)
  // Bubble the trimmed upstream message so users can see the real cause.
  const httpMatch = raw.match(/\b(4\d{2}|5\d{2})\b/)
  if (httpMatch || lower.includes('request failed') || lower.includes('returned empty')) {
    return { status: 502, message: `Lỗi từ AI provider: ${raw.slice(0, 240)}` }
  }

  // Network / abort / timeout ─────────────────────────────────────────
  if (lower.includes('aborted') || lower.includes('timeout')) {
    return { status: 504, message: 'Provider phản hồi quá chậm — thử lại.' }
  }

  // Last resort: surface the raw error message instead of hiding it
  // behind the English fallback. Caller-supplied fallback only kicks in
  // when err isn't an Error instance.
  return { status: 500, message: raw ? `${fallback}: ${raw.slice(0, 200)}` : fallback }
}

function sendError(reply: FastifyReply, err: unknown, fallback: string) {
  const { status, message } = statusFromError(err, fallback)
  return reply.status(status).send({ error: message })
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware)

  app.get('/api/v1/ai/providers', async () => {
    return { providers: getAvailableProviders() }
  })

  app.get('/api/v1/ai/config', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      return await getAiConfig(user.orgId)
    } catch (err: any) {
      app.log.error({ err }, '[ai] config fetch failed')
      return sendError(reply, err, 'Failed to fetch AI config')
    }
  })

  app.put<{
    Body: {
      provider?: string
      model?: string
      maxDaily?: number
      enabled?: boolean
      taskOverrides?: Record<string, { provider?: string; model?: string }>
      // AI auto-reply fields
      defaultAiMode?: string
      autoReplyEnabled?: boolean
      debounceSeconds?: number
      prefilterKeywords?: string | null
      groupRequireMention?: boolean
      mentionNames?: string | null
      // RAG guardrail allow-lists (empty = no limit)
      allowedProductCategoryIds?: string[]
      allowedKnowledgeCategoryIds?: string[]
      // Critic / verify-before-send
      verifyBeforeSend?: boolean
    }
  }>('/api/v1/ai/config', async (request, reply) => {
    try {
      const user = request.user as { role: string; orgId: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ admin/owner được chỉnh AI config' })
      }
      const body = request.body
      if (body.maxDaily !== undefined && body.maxDaily < 1) {
        return reply.status(400).send({ error: 'maxDaily must be at least 1' })
      }
      return await updateAiConfig(user.orgId, body)
    } catch (err: any) {
      app.log.error({ err }, '[ai] config update failed')
      return sendError(reply, err, 'Failed to update AI config')
    }
  })

  // Bulk-apply the default AI mode to ALL existing conversations (owner/admin).
  // Called from AI config after the staff explicitly confirms in the dialog.
  app.post<{ Body: { mode?: string } }>('/api/v1/ai/config/apply-default-mode', async (request, reply) => {
    try {
      const user = request.user as { role: string; orgId: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ admin/owner được áp dụng chế độ AI hàng loạt' })
      }
      const mode = request.body?.mode
      if (!mode || !['manual', 'suggest', 'auto'].includes(mode)) {
        return reply.status(400).send({ error: 'mode phải là manual | suggest | auto' })
      }
      const updated = await applyDefaultModeToAllConversations(user.orgId, mode)
      return { updated }
    } catch (err: any) {
      app.log.error({ err }, '[ai] apply-default-mode failed')
      return sendError(reply, err, 'Failed to apply default mode')
    }
  })

  // ── AI Auto-reply Schedule (Business hours vs After hours) ────────────────
  app.get('/api/v1/ai/schedule', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const schedule = await getAiScheduleConfig(user.orgId)
      const afterHours = isAfterHours(new Date(), schedule.timezone, schedule.startHour, schedule.endHour)
      return {
        schedule,
        isAfterHours: afterHours,
        currentServerTime: new Date().toISOString(),
      }
    } catch (err: any) {
      app.log.error({ err }, '[ai] schedule fetch failed')
      return sendError(reply, err, 'Failed to fetch AI schedule config')
    }
  })

  app.put<{
    Body: {
      enabled?: boolean
      startHour?: number
      endHour?: number
      daytimeMode?: 'suggest' | 'manual'
      nighttimeMode?: 'auto' | 'suggest'
      timezone?: string
    }
  }>('/api/v1/ai/schedule', async (request, reply) => {
    try {
      const user = request.user as { role: string; orgId: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ admin/owner được chỉnh lịch AI' })
      }
      const updated = await saveAiScheduleConfig(user.orgId, request.body ?? {})
      const schedule = await getAiScheduleConfig(user.orgId)
      const afterHours = isAfterHours(new Date(), schedule.timezone, schedule.startHour, schedule.endHour)
      return {
        schedule,
        isAfterHours: afterHours,
      }
    } catch (err: any) {
      app.log.error({ err }, '[ai] schedule update failed')
      return sendError(reply, err, 'Failed to update AI schedule config')
    }
  })

  // ── Tools / function config (per-function enable + guardrail) ───────────────
  // ── Ngân sách ký tự của prompt (theo model sinh trả lời của org) ────────────
  // FE dùng để hiện bộ đếm ký tự + cảnh báo "phần vượt sẽ bị cắt" ngay trong
  // editor persona/playbook/tài liệu logic — chấm dứt cắt ngầm không ai biết.
  app.get('/api/v1/ai/context-budgets', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const cfg = await getAiConfig(user.orgId)
      // Model của task auto_reply (task sinh câu trả lời) quyết định bậc ngân sách.
      const gen = getEffectiveConfigForTask(cfg, 'auto_reply')
      const model = gen.model || null
      return {
        budgets: getContextBudgets(model),
        tier: resolveBudgetTier(model),
        model,
      }
    } catch (err: any) {
      app.log.error({ err }, '[ai] context-budgets fetch failed')
      return sendError(reply, err, 'Failed to fetch context budgets')
    }
  })

  app.get('/api/v1/ai/tools-config', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      return { tools: await getToolsConfig(user.orgId) }
    } catch (err: any) {
      app.log.error({ err }, '[ai] tools-config fetch failed')
      return sendError(reply, err, 'Failed to fetch tools config')
    }
  })

  app.put<{ Body: Record<string, unknown> }>('/api/v1/ai/tools-config', async (request, reply) => {
    try {
      const user = request.user as { id?: string; role: string; orgId: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ admin/owner được chỉnh cấu hình tool' })
      }
      const next = await applyToolsPatch(user.orgId, request.body ?? {}, user.id ?? 'staff')
      return { tools: next }
    } catch (err: any) {
      app.log.error({ err }, '[ai] tools-config update failed')
      return sendError(reply, err, err?.message ?? 'Failed to update tools config')
    }
  })

  // ── AI pending actions (human-in-loop: confirm before execute) ──────────────
  app.get<{ Querystring: { status?: string } }>('/api/v1/ai/pending-actions', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const status = request.query?.status as PendingActionStatus | undefined
      return { data: await listPendingActions(user.orgId, status) }
    } catch (err: any) {
      app.log.error({ err }, '[ai] pending-actions list failed')
      return sendError(reply, err, 'Failed to list pending actions')
    }
  })

  app.post<{ Params: { id: string } }>('/api/v1/ai/pending-actions/:id/confirm', async (request, reply) => {
    try {
      const user = request.user as { id?: string; orgId: string }
      const res = await confirmAction(request.params.id, user.orgId, user.id ?? 'staff')
      if (!res.ok) return reply.status(400).send({ error: res.error })
      return { success: true, executedRef: res.executedRef }
    } catch (err: any) {
      app.log.error({ err }, '[ai] pending-action confirm failed')
      return sendError(reply, err, 'Failed to confirm action')
    }
  })

  app.post<{ Params: { id: string } }>('/api/v1/ai/pending-actions/:id/reject', async (request, reply) => {
    try {
      const user = request.user as { id?: string; orgId: string }
      const ok = await rejectAction(request.params.id, user.orgId, user.id ?? 'staff')
      if (!ok) return reply.status(400).send({ error: 'Không thể từ chối (đã xử lý hoặc không tồn tại)' })
      return { success: true }
    } catch (err: any) {
      app.log.error({ err }, '[ai] pending-action reject failed')
      return sendError(reply, err, 'Failed to reject action')
    }
  })

  app.get<{ Querystring: { days?: string } }>('/api/v1/ai/usage', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const daysParam = Number.parseInt(request.query?.days ?? '1', 10)
      const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 1
      return await getAiUsage(user.orgId, days)
    } catch (err: any) {
      app.log.error({ err }, '[ai] usage fetch failed')
      return sendError(reply, err, 'Failed to fetch AI usage')
    }
  })

  // Response: { suggestions: Array<{ suggestionId, tone: 'concise'|'friendly'|'detailed', text }> }
  app.post<{ Body: { conversationId: string } }>('/api/v1/ai/suggest', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const { conversationId } = request.body
      if (!conversationId) return reply.status(400).send({ error: 'conversationId is required' })
      if (!(await assertConversationAccess(request, reply, conversationId))) return
      return await generateAiOutput({ orgId: user.orgId, conversationId, type: 'reply_draft' })
    } catch (err: any) {
      app.log.error({ err }, '[ai] suggest failed')
      return sendError(reply, err, 'Failed to generate AI suggestion')
    }
  })

  app.post<{ Body: { conversationId: string } }>('/api/v1/ai/summarize', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const { conversationId } = request.body
      if (!conversationId) return reply.status(400).send({ error: 'conversationId is required' })
      if (!(await assertConversationAccess(request, reply, conversationId))) return
      return await generateAiOutput({ orgId: user.orgId, conversationId, type: 'summary' })
    } catch (err: any) {
      app.log.error({ err }, '[ai] summarize failed')
      return sendError(reply, err, 'Failed to summarize conversation')
    }
  })

  app.post<{ Body: { conversationId: string } }>('/api/v1/ai/sentiment', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const { conversationId } = request.body
      if (!conversationId) return reply.status(400).send({ error: 'conversationId is required' })
      if (!(await assertConversationAccess(request, reply, conversationId))) return
      return await generateAiOutput({ orgId: user.orgId, conversationId, type: 'sentiment' })
    } catch (err: any) {
      app.log.error({ err }, '[ai] sentiment failed')
      return sendError(reply, err, 'Failed to analyze sentiment')
    }
  })

  // Combined analysis (summary + sentiment + lead score) — single LLM call to save tokens.
  // Results are persisted to Contact columns. Frontend reads Contact fields on page load.
  app.post<{ Body: { conversationId: string; forceFresh?: boolean } }>('/api/v1/ai/conversation-analyze', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const { conversationId, forceFresh } = request.body
      if (!conversationId) return reply.status(400).send({ error: 'conversationId is required' })
      if (!(await assertConversationAccess(request, reply, conversationId))) return
      const result = await analyzeConversation(
        { orgId: user.orgId, conversationId },
        { forceFresh: !!forceFresh },
      )
      return result
    } catch (err: any) {
      app.log.error({ err }, '[ai] conversation-analyze failed')
      return sendError(reply, err, 'Failed to analyze conversation')
    }
  })

  app.post<{ Body: { conversationId: string } }>('/api/v1/ai/score-lead', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const { conversationId } = request.body
      if (!conversationId) return reply.status(400).send({ error: 'conversationId is required' })
      if (!(await assertConversationAccess(request, reply, conversationId))) return
      return await scoreLeadFromConversation({ orgId: user.orgId, conversationId })
    } catch (err: any) {
      app.log.error({ err }, '[ai] score-lead failed')
      return sendError(reply, err, 'Failed to score lead')
    }
  })

  // D5.3 — Contact-centric analysis: resolves the contact's most-recent conversation
  // and runs the analyzeConversation pipeline. Results persist to Contact columns.
  // Returns { noConversation: true } when the contact has none yet.
  //
  // Response includes the contact's CURRENT lifecycle stage + tags so the panel can
  // compute "Apply" suggestions (e.g. stage change, tag append) without a second round-trip.
  // ── Customer 360: phân tích 4 mục cho modal trong khung chat ────────
  //
  // Chân dung dựng từ dữ liệu thật (không hỏi AI), ba mục còn lại do AI.
  // AI hỏng thì vẫn trả về chân dung — modal không trắng trơn.
  app.post<{ Body: { conversationId?: string; forceFresh?: boolean } }>(
    '/api/v1/ai/customer-360',
    async (request, reply) => {
      const user = request.user as { id: string; role: string; orgId: string }
      const conversationId = request.body?.conversationId?.trim()
      if (!conversationId) return reply.status(400).send({ error: 'Thiếu conversationId' })

      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, orgId: user.orgId },
        select: { id: true, channelAccountId: true },
      })
      if (!conv) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' })

      // Cùng luật quyền với contact-analyze: nhân viên thường phải được cấp
      // quyền trên tài khoản Zalo này mới xem được.
      if (!['owner', 'admin', 'manager'].includes(user.role)) {
        const access = await prisma.channelAccountAccess.findFirst({
          where: { channelAccountId: conv.channelAccountId, userId: user.id },
          select: { id: true },
        })
        if (!access) {
          return reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' })
        }
      }

      try {
        return await analyzeCustomer360({
          orgId: user.orgId,
          conversationId: conv.id,
          forceFresh: !!request.body?.forceFresh,
        })
      } catch (err: any) {
        app.log.error({ err }, '[ai] customer-360 failed')
        return reply.status(500).send({ error: err?.message || 'Không phân tích được' })
      }
    },
  )

  app.post<{ Body: { contactId: string; forceFresh?: boolean } }>('/api/v1/ai/contact-analyze', async (request, reply) => {
    try {
      const user = request.user as { id: string; role: string; orgId: string }
      const { contactId, forceFresh } = request.body
      if (!contactId) return reply.status(400).send({ error: 'contactId is required' })

      const contact = await prisma.contact.findFirst({
        where: { id: contactId, orgId: user.orgId },
        select: { id: true, lifecycleStage: true, tags: true },
      })
      if (!contact) return reply.status(404).send({ error: 'Contact not found' })

      const conversation = await prisma.conversation.findFirst({
        where: { contactId, orgId: user.orgId },
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, channelAccountId: true, lastMessageAt: true },
      })
      if (!conversation) return { noConversation: true }

      // ACL: non-owner/admin/manager need explicit ChannelAccountAccess on this account
      if (!['owner', 'admin', 'manager'].includes(user.role)) {
        const access = await prisma.channelAccountAccess.findFirst({
          where: { channelAccountId: conversation.channelAccountId, userId: user.id },
          select: { id: true },
        })
        if (!access) {
          return reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' })
        }
      }

      const analysis = await analyzeConversation(
        { orgId: user.orgId, conversationId: conversation.id },
        { forceFresh: !!forceFresh },
      )

      return {
        ...analysis,
        conversationId: conversation.id,
        lastMessageAt: conversation.lastMessageAt,
        contactLifecycleStage: contact.lifecycleStage,
        contactTags: Array.isArray(contact.tags) ? (contact.tags as string[]) : [],
      }
    } catch (err: any) {
      app.log.error({ err }, '[ai] contact-analyze failed')
      return sendError(reply, err, 'Failed to analyze contact conversation')
    }
  })

  // ── Per-org API key management (owner/admin only) ────────────────────

  // Probe-only: verify a key without saving (used for "test" before commit)
  app.post<{ Body: { provider: string; apiKey: string } }>('/api/v1/ai/api-key/verify', async (request, reply) => {
    try {
      const user = request.user as { role: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ admin/owner được quản lý API key' })
      }
      const { provider, apiKey } = request.body
      if (!provider || !apiKey) {
        return reply.status(400).send({ error: 'provider and apiKey are required' })
      }
      const result = await verifyProviderApiKey(provider, apiKey)
      if (!result.ok) return reply.status(422).send({ ok: false, error: result.error })
      return { ok: true }
    } catch (err: any) {
      app.log.error({ err }, '[ai] verify api key failed')
      return sendError(reply, err, 'Failed to verify API key')
    }
  })

  // Save: verifies first by default, then persists. Pass skipVerify=true to bypass
  // (e.g. for keys that don't expose a /models endpoint).
  app.put<{ Body: { provider: string; apiKey: string; skipVerify?: boolean } }>('/api/v1/ai/api-key', async (request, reply) => {
    try {
      const user = request.user as { role: string; orgId: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ admin/owner được quản lý API key' })
      }
      const { provider, apiKey, skipVerify } = request.body
      if (!provider || !apiKey) {
        return reply.status(400).send({ error: 'provider and apiKey are required' })
      }
      if (!skipVerify) {
        const probe = await verifyProviderApiKey(provider, apiKey)
        if (!probe.ok) {
          return reply.status(422).send({ ok: false, verified: false, error: probe.error })
        }
      }
      await saveProviderApiKey(user.orgId, provider, apiKey)
      return { ok: true, verified: !skipVerify }
    } catch (err: any) {
      app.log.error({ err }, '[ai] save api key failed')
      return sendError(reply, err, 'Failed to save API key')
    }
  })

  app.delete<{ Params: { provider: string } }>('/api/v1/ai/api-key/:provider', async (request, reply) => {
    try {
      const user = request.user as { role: string; orgId: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ admin/owner được quản lý API key' })
      }
      await deleteProviderApiKey(user.orgId, request.params.provider)
      return { ok: true }
    } catch (err: any) {
      app.log.error({ err }, '[ai] delete api key failed')
      return sendError(reply, err, 'Failed to delete API key')
    }
  })

  /** GET /api/v1/ai/suggestions?conversationId=&limit= — gợi ý đã lưu, chưa dùng (đọc lại khi mở hội thoại muộn) */
  app.get<{ Querystring: { conversationId?: string; limit?: string } }>('/api/v1/ai/suggestions', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const { conversationId, limit } = request.query
      if (!conversationId) return reply.status(400).send({ error: 'conversationId là bắt buộc' })
      const items = await prisma.aiSuggestion.findMany({
        where: { orgId: user.orgId, conversationId, accepted: false },
        orderBy: { createdAt: 'desc' },
        take: Math.min(parseInt(limit ?? '5', 10) || 5, 20),
        select: { id: true, content: true, confidence: true, createdAt: true },
      })
      return { items }
    } catch (err: any) {
      app.log.error({ err }, '[ai] list suggestions failed')
      return sendError(reply, err, 'Failed to list suggestions')
    }
  })

  app.post<{ Params: { id: string } }>('/api/v1/ai/suggestions/:id/accept', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const { id } = request.params
      const updated = await prisma.aiSuggestion.updateMany({
        where: { id, orgId: user.orgId },
        data: { accepted: true },
      })
      if (updated.count === 0) return reply.status(404).send({ error: 'Suggestion not found' })
      return { accepted: true }
    } catch (err: any) {
      app.log.error({ err }, '[ai] accept failed')
      return sendError(reply, err, 'Failed to mark suggestion accepted')
    }
  })

  // ── AI Logic Docs (owner/admin only) ────────────────────────────────

  /** GET /api/v1/ai/logic-docs — list all docs (meta, no content) */
  app.get('/api/v1/ai/logic-docs', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const docs = await getLogicDocs(user.orgId)
      return { docs }
    } catch (err: any) {
      app.log.error({ err }, '[ai] logic-docs list failed')
      return sendError(reply, err, 'Failed to list logic docs')
    }
  })

  /** GET /api/v1/ai/logic-docs/:type — get single doc with full content + version history */
  app.get<{ Params: { type: string } }>('/api/v1/ai/logic-docs/:type', async (request, reply) => {
    try {
      const user = request.user as { orgId: string }
      const { type } = request.params
      if (!isValidDocType(type)) {
        return reply.status(400).send({ error: `Invalid doc type. Valid types: index, persona, playbook, handoff_rules, mechanism` })
      }
      const [doc, versions] = await Promise.all([
        getLogicDoc(user.orgId, type as AiLogicDocType),
        getLogicDocVersions(user.orgId, type as AiLogicDocType),
      ])
      if (!doc) return reply.status(404).send({ error: `Logic doc type "${type}" not found. Use POST /seed to create defaults.` })
      return { doc, versions }
    } catch (err: any) {
      app.log.error({ err }, '[ai] logic-doc get failed')
      return sendError(reply, err, 'Failed to get logic doc')
    }
  })

  /** PUT /api/v1/ai/logic-docs/:type — create or update doc content */
  app.put<{ Params: { type: string }; Body: { content: string; changeNote?: string } }>('/api/v1/ai/logic-docs/:type', async (request, reply) => {
    try {
      const user = request.user as { id: string; role: string; orgId: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ admin/owner được chỉnh sửa logic doc' })
      }
      const { type } = request.params
      if (!isValidDocType(type)) {
        return reply.status(400).send({ error: `Invalid doc type. Valid types: index, persona, playbook, handoff_rules, mechanism` })
      }
      const { content, changeNote } = request.body
      if (!content || !content.trim()) {
        return reply.status(400).send({ error: 'content is required' })
      }
      const doc = await upsertLogicDoc(user.orgId, type as AiLogicDocType, content, user.id, changeNote)
      return { doc }
    } catch (err: any) {
      app.log.error({ err }, '[ai] logic-doc upsert failed')
      return sendError(reply, err, 'Failed to update logic doc')
    }
  })

  /** POST /api/v1/ai/logic-docs/:type/revert — restore a previous version */
  app.post<{ Params: { type: string }; Body: { version: number } }>('/api/v1/ai/logic-docs/:type/revert', async (request, reply) => {
    try {
      const user = request.user as { id: string; role: string; orgId: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ admin/owner được revert logic doc' })
      }
      const { type } = request.params
      if (!isValidDocType(type)) {
        return reply.status(400).send({ error: `Invalid doc type` })
      }
      const { version } = request.body
      if (!version || !Number.isInteger(version) || version < 1) {
        return reply.status(400).send({ error: 'version must be a positive integer' })
      }
      const doc = await revertLogicDoc(user.orgId, type as AiLogicDocType, version, user.id)
      return { doc }
    } catch (err: any) {
      app.log.error({ err }, '[ai] logic-doc revert failed')
      return sendError(reply, err, 'Failed to revert logic doc')
    }
  })

  /** POST /api/v1/ai/logic-docs/seed — create default docs (idempotent) */
  app.post('/api/v1/ai/logic-docs/seed', async (request, reply) => {
    try {
      const user = request.user as { id: string; role: string; orgId: string }
      if (!['owner', 'admin'].includes(user.role)) {
        return reply.status(403).send({ error: 'Chỉ admin/owner được seed logic docs' })
      }
      const result = await seedDefaultLogicDocs(user.orgId, user.id)
      return { ok: true, ...result }
    } catch (err: any) {
      app.log.error({ err }, '[ai] logic-doc seed failed')
      return sendError(reply, err, 'Failed to seed logic docs')
    }
  })
}
