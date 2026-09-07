import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import { authRoutes } from './modules/auth/auth-routes.js'
import { apiKeyRoutes } from './modules/auth/api-key-routes.js'
import { contactRoutes } from './modules/contacts/contact-routes.js'
import { companyRoutes } from './modules/contacts/company-routes.js'
import { appointmentRoutes } from './modules/contacts/appointment-routes.js'
import { noteRoutes } from './modules/contacts/note-routes.js'
import { taskRoutes } from './modules/tasks/task-routes.js'
import { dashboardRoutes } from './modules/dashboard/dashboard-routes.js'
import { activityRoutes } from './modules/dashboard/activity-routes.js'
import { reportRoutes } from './modules/dashboard/report-routes.js'
import { chatRoutes } from './modules/chat/chat-routes.js'
import { webChatRoutes } from './modules/chat/web-chat-routes.js'
import { zaloRoutes } from './modules/zalo/zalo-routes.js'
import { automationRoutes } from './modules/automation/automation-routes.js'
import { settingsRoutes } from './modules/settings/settings-routes.js'
import { notificationRoutes } from './modules/notifications/notification-routes.js'
import { searchRoutes } from './modules/search/search-routes.js'
import { initSocketGateway } from './modules/realtime/socket-gateway.js'
import { profileRoutes } from './modules/auth/profile-routes.js'
import { aiRoutes } from './modules/ai/ai-routes.js'
import { assistantRoutes } from './modules/ai/assistant-routes.js'
import { aiBotRoutes } from './modules/ai/ai-bot-routes.js'
import { aiEvalRoutes } from './modules/ai/ai-eval-routes.js'
import { masterRoutes } from './modules/ai/master-routes.js'
import { knowledgeGapRoutes } from './modules/ai/knowledge-gap-routes.js'
import { scenarioRoutes } from './modules/ai/scenario-routes.js'
import { ensureVectorIndexes } from './shared/ensure-vector-indexes.js'
import kbRoutes from './modules/knowledge/kb-routes.js'
import importRoutes from './modules/knowledge/import-routes.js'
import learnHistoryRoutes from './modules/ai/learn-history-routes.js'
import orderSlotsRoutes from './modules/ai/order-slots-routes.js'
import { libraryRoutes } from './modules/knowledge/library-routes.js'
import { analyticsRoutes } from './modules/analytics/analytics-routes.js'
import { zaloWebhookRoutes } from './modules/zalo/zalo-webhook.js'
import { autoReconnectSavedAccounts } from './modules/zalo/zalo-pool.js'
import { cdpPropertyRoutes } from './modules/cdp/cdp-property-routes.js'
import { cdpEventRoutes } from './modules/cdp/cdp-event-routes.js'
import { cdpLifecycleRoutes } from './modules/cdp/cdp-lifecycle-routes.js'
import { cdpSegmentRoutes } from './modules/cdp/cdp-segment-routes.js'
import { cdpDictionaryRoutes } from './modules/cdp/cdp-dictionary-routes.js'
import { cdpPresetRoutes } from './modules/cdp/cdp-preset-routes.js'
import { initAppointmentReminder } from './modules/contacts/appointment-reminder.js'
import { initNotificationGenerator } from './modules/notifications/notification-generator.js'
import { friendRoutes } from './modules/zalo/friend-routes.js'
import { groupRoutes } from './modules/zalo/group-routes.js'
import { chatOperationsRoutes } from './modules/chat/chat-operations-routes.js'
import { zaloOaOAuthRoutes } from './modules/zalo-oa/oauth-routes.js'
import { zaloOaWebhookRoutes } from './modules/zalo-oa/oa-webhook.js'
import { csWindowRoutes } from './modules/zalo-oa/cs-window.js'
import { facebookPageOAuthRoutes } from './modules/facebook-page/oauth-routes.js'
import { fbTokenImportRoutes } from './modules/facebook-page/fb-token-import-routes.js'
import { facebookPageWebhookRoutes } from './modules/facebook-page/fb-webhook.js'
import { znsRoutes } from './modules/zalo-oa/zns-routes.js'
import { znsCampaignRoutes } from './modules/zalo-oa/zns-campaign-routes.js'
import { processZnsSendJob } from './modules/zalo-oa/zns-campaign-worker.js'
import { initZnsSendWorker, initEmbeddingWorker } from './shared/queue.js'
import { processTriggerJob, processDelayJob } from './modules/automation/automation-engine.js'
import { initWorkers, shutdownQueue } from './shared/queue.js'
import { embedAndStoreKbEntry } from './modules/knowledge/embedding-service.js'
import { prisma as _prisma } from './shared/prisma-client.js'
import { recoverPendingAiReplies } from './modules/ai/harness/auto-reply-orchestrator.js'
import { initTraceRetentionCron } from './modules/ai/observability/trace-retention-cron.js'
import { traceRoutes } from './modules/ai/observability/trace-routes.js'
import { simulateRoutes } from './modules/ai/simulate-routes.js'
import { initTraceCleanup } from './modules/ai/observability/trace-cleanup-job.js'
import rateLimit from '@fastify/rate-limit'
import fastifyCachePlugin from './shared/fastify-cache-plugin.js'
import { pollConversationIdle } from './modules/automation/conversation-idle-poller.js'
import { pollNoReply24h } from './modules/automation/no-reply-24h-poller.js'
import { initIntegrations } from './modules/integrations/registry.js'
import { registerPerfexIntegration } from './modules/integrations/perfex/perfex-subscriber.js'
import { perfexRoutes } from './modules/integrations/perfex/perfex-routes.js'
import { pancakeWebhookRoutes } from './modules/pancake/pancake-webhook.js'
import { pancakeRoutes } from './modules/pancake/pancake-routes.js'
import { tiktokOAuthRoutes } from './modules/tiktok-shop/oauth-routes.js'
import { tiktokWebhookRoutes } from './modules/tiktok-shop/tiktok-webhook.js'
import { platformAuthRoutes } from './modules/platform/platform-auth-routes.js'
import { platformOrgRoutes } from './modules/platform/org-admin-routes.js'
import { platformProvisioningRoutes } from './modules/platform/provisioning-routes.js'
import { platformEnterCompanyRoutes } from './modules/platform/enter-company-routes.js'
import { platformReportRoutes } from './modules/platform/report-routes.js'
import { platformBrandingRoutes } from './modules/platform/platform-branding-routes.js'
import { productRoutes, PRODUCT_UPLOADS_DIR } from './modules/products/product-routes.js'
import { crmProductRoutes } from './modules/crm-products/crm-products-routes.js'
import { productDocRoutes } from './modules/product-docs/product-docs-routes.js'
import { docLibraryRoutes, DOC_ASSETS_DIR } from './modules/doc-library/doc-library-routes.js'
import { crmSyncRoutes } from './modules/integrations/crm-sync/crm-sync-routes.js'
import { orderRoutes } from './modules/orders/order-routes.js'
import { promotionAdminRoutes } from './modules/orders/promotion-admin-routes.js'
import { syncRbac } from './modules/settings/rbac-seed.js'
import { roleRoutes } from './modules/settings/role-routes.js'
import { CHAT_MEDIA_DIR } from './modules/chat/chat-media-store.js'
import { embedAndStoreProduct } from './modules/products/product-embedding.js'

const app = Fastify({ logger: true })

// W6-FIX: Global rate limiting — DDoS baseline.
// Dev: 1000/min (localhost sends all requests from same IP).
// Prod: 200/min per IP.
const isDev = process.env.NODE_ENV !== 'production'
await app.register(rateLimit, {
  max: isDev ? 1000 : 200,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
})

// CORS: In production, restrict to Cloudflare Pages domain(s)
// CORS_ORIGIN can be a single origin or comma-separated list
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : true  // dev mode: allow all
await app.register(cors, {
  origin: corsOrigin,
  credentials: true,
  // Explicit method list — @fastify/cors's default doesn't always include
  // PUT/PATCH/DELETE in the preflight response, which breaks the
  // PUT /api/v1/ai/api-key, PATCH /api/v1/settings/team/:id flows etc.
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
})
// W1-FIX: Security headers (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
// crossOriginResourcePolicy: 'cross-origin' — allows frontend on different origin
// (e.g. localhost:3000, chatmql.traduocvietnam.com) to load static assets
// (uploaded images, avatars, product images) served from the API.
await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
})
// C1-FIX: Fail-fast if JWT_SECRET is missing or weak in production
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me'
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-change-me')) {
  console.error('FATAL: JWT_SECRET must be set to a strong value in production')
  process.exit(1)
}
await app.register(jwt, { secret: jwtSecret })

// Fastify JWT type augmentation
declare module 'fastify' {
  interface FastifyInstance {
    jwt: import('@fastify/jwt').JWT
  }
}
// Company-token claim shape (unchanged required fields keep all existing
// route code type-safe). Optional fields cover same-org impersonation and
// super-admin "enter company". Platform tokens (kind:'platform', sub) are
// signed via a cast and only consumed by requirePlatformAdmin, which narrows.
type JwtClaims = {
  id: string
  email: string
  fullName: string
  role: string
  orgId: string
  impersonatedBy?: string
  platformActorId?: string
  kind?: 'company' | 'platform'
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtClaims
    user: JwtClaims
  }
}

// Health check (used by Docker HEALTHCHECK)
app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }))

// Zalo domain verification (white-list). Zalo's contract: the file
// zalo_verifier<CODE>.html must return <CODE> as its body. Echo the code from the
// filename so it works for any app-id (now and after future app-id changes).
// Public, no auth, served at the API domain root (bzncrm-api.bizino.ai).
// Validate the charset first — echoing arbitrary path input as text/html would be a
// reflected-XSS vector; Zalo codes are only [A-Za-z0-9_-].
app.get<{ Params: { code: string } }>('/zalo_verifier:code.html', async (request, reply) => {
  const code = request.params.code
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(code)) return reply.code(404).send('not found')
  return reply.type('text/html').send(code)
})

// ── Public static files (avatars, etc.) — NO auth required ──────────
import fastifyStatic from '@fastify/static'
import { UPLOADS_DIR } from './modules/auth/profile-routes.js'
import { widgetScriptRoutes } from './modules/widget/widget-script.js'
import { widgetPublicRoutes } from './modules/widget/widget-public-routes.js'
import { widgetAdminRoutes, WIDGET_LOGO_DIR } from './modules/widget/widget-admin-routes.js'
await app.register(fastifyStatic, {
  root: UPLOADS_DIR,
  prefix: '/uploads/avatars/',
  decorateReply: false,
})
await app.register(fastifyStatic, {
  root: PRODUCT_UPLOADS_DIR,
  prefix: '/uploads/products/',
  decorateReply: false,
})
await app.register(fastifyStatic, {
  root: DOC_ASSETS_DIR,
  prefix: '/uploads/doc-assets/',
  decorateReply: false,
})
await app.register(fastifyStatic, {
  root: CHAT_MEDIA_DIR,
  prefix: '/uploads/chat-media/',
  decorateReply: false,
})
await app.register(fastifyStatic, {
  root: WIDGET_LOGO_DIR,
  prefix: '/uploads/widget-logos/',
  decorateReply: false,
  // Logo hiện trên website của KHÁCH. helmet mặc định `same-origin` sẽ chặn
  // ảnh này y như đã chặn widget.js — phải mở chéo miền thì logo mới lên.
  setHeaders: (res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Access-Control-Allow-Origin', '*')
  },
})

// ── Public Media Proxy (no auth needed for img tags) ─────────────────
app.get('/api/v1/media/proxy', async (request, reply) => {
  const { url } = request.query as { url?: string }
  if (!url) return reply.status(400).send({ error: 'Missing url query parameter' })
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return reply.status(400).send({ error: 'Invalid url protocol' })
    }
    const fetchRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      }
    })
    if (!fetchRes.ok) {
      return reply.status(fetchRes.status).send({ error: `Proxy upstream returned ${fetchRes.status}` })
    }
    const contentType = fetchRes.headers.get('content-type') || 'image/jpeg'
    reply.header('Content-Type', contentType)
    reply.header('Cache-Control', 'public, max-age=604800, immutable')
    const buffer = Buffer.from(await fetchRes.arrayBuffer())
    return reply.send(buffer)
  } catch (err: any) {
    return reply.status(500).send({ error: err.message })
  }
})

// ── Route-level Redis cache (register before routes) ──────────────────
await app.register(fastifyCachePlugin)

// Routes
await app.register(authRoutes)
await app.register(apiKeyRoutes)
await app.register(contactRoutes)
await app.register(companyRoutes)
await app.register(appointmentRoutes)
await app.register(noteRoutes)
await app.register(taskRoutes)
await app.register(dashboardRoutes)
await app.register(reportRoutes)
await app.register(activityRoutes)
await app.register(chatRoutes)
await app.register(webChatRoutes)
await app.register(zaloRoutes)
await app.register(automationRoutes)
await app.register(settingsRoutes)
await app.register(roleRoutes) // RBAC: /me/permissions, /permissions, /roles
await app.register(notificationRoutes)
await app.register(searchRoutes)
await app.register(profileRoutes)
await app.register(aiRoutes)
await app.register(assistantRoutes)
await app.register(aiBotRoutes)
await app.register(aiEvalRoutes) // bộ câu hỏi vàng — kiểm định hồi quy cho AI
await app.register(masterRoutes)
await app.register(knowledgeGapRoutes)
await app.register(scenarioRoutes)
await app.register(kbRoutes)
await app.register(importRoutes)
await app.register(learnHistoryRoutes)
await app.register(orderSlotsRoutes)
await app.register(libraryRoutes)
await app.register(analyticsRoutes)
await app.register(zaloWebhookRoutes) // Internal webhook — no JWT
await app.register(cdpPropertyRoutes)
await app.register(cdpEventRoutes)
await app.register(cdpLifecycleRoutes)
await app.register(cdpSegmentRoutes)
await app.register(cdpDictionaryRoutes)
await app.register(cdpPresetRoutes)
await app.register(friendRoutes)
await app.register(groupRoutes)
await app.register(chatOperationsRoutes)
await app.register(zaloOaOAuthRoutes)
await app.register(zaloOaWebhookRoutes) // Public — secured by signature (grace mode)
await app.register(csWindowRoutes)
await app.register(facebookPageOAuthRoutes)
await app.register(fbTokenImportRoutes)
await app.register(facebookPageWebhookRoutes) // Public — enforces hub.challenge + X-Hub-Signature-256
await app.register(znsRoutes)
await app.register(znsCampaignRoutes)
await app.register(perfexRoutes)
await app.register(traceRoutes)
await app.register(simulateRoutes)
await app.register(pancakeWebhookRoutes)  // Public webhook — no JWT
await app.register(pancakeRoutes)         // JWT-protected settings
await app.register(tiktokWebhookRoutes)   // Public TikTok Shop webhook — no JWT
await app.register(tiktokOAuthRoutes)     // TikTok Shop OAuth routes

// ── Platform (super admin / multi-tenant control plane) ──────────────
await app.register(platformAuthRoutes)
await app.register(platformOrgRoutes)
await app.register(platformProvisioningRoutes)
await app.register(platformEnterCompanyRoutes)
await app.register(platformReportRoutes)
await app.register(platformBrandingRoutes)

// ── Product Knowledge Base ───────────────────────────────────────────
await app.register(productRoutes)
await app.register(crmProductRoutes)  // /crm-products — đọc sản phẩm thẳng từ CRM
await app.register(productDocRoutes)  // /product-docs — tài liệu bán hàng theo mã SP
await app.register(docLibraryRoutes)  // /doc-library — thư viện thư mục + tài nguyên

// ── CRM & FM Integrations + Order Dispatch ───────────────────────────
await app.register(crmSyncRoutes)
await app.register(orderRoutes)
await app.register(promotionAdminRoutes)
// Widget live chat cho website: script + API công khai (không JWT) + quản trị.
await app.register(widgetScriptRoutes)   // GET /widget.js — công khai
await app.register(widgetPublicRoutes)   // /widget/:siteKey/* — công khai, chặn theo tên miền
await app.register(widgetAdminRoutes)    // /widgets — JWT + quyền integrations.*

// RBAC: đồng bộ danh mục quyền + 4 vai trò gốc (idempotent, lỗi không chặn boot).
await syncRbac()

// Error handler
app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _request, reply) => {
  const statusCode = (error as any).statusCode || 500
  const code = typeof (error as any).code === 'string' ? (error as any).code : undefined
  const body: { error: string; code?: string } = { error: error.message || 'Internal Server Error' }
  // Forward app-level error codes (e.g. ORG_EXPIRED) only for client errors —
  // avoid leaking framework/Prisma codes on 5xx.
  if (code && statusCode < 500) body.code = code
  reply.status(statusCode).send(body)
})

// Start
const port = parseInt(process.env.PORT || '4520')
try {
  await app.listen({ port, host: '0.0.0.0' })
  // Attach Socket.IO to the underlying Node HTTP server
  initSocketGateway(app.server)
  console.log(`🚀 BizCRM API running on http://localhost:${port}`)
  console.log(`🔌 Socket.IO listening on ws://localhost:${port}/socket.io`)

  // Initialize scheduled jobs (after Socket.IO is ready)
  initAppointmentReminder()
  initNotificationGenerator()

  // Auto-reconnect Zalo accounts with saved sessions (fire-and-forget)
  autoReconnectSavedAccounts().catch(err =>
    console.error('Auto-reconnect failed:', err.message)
  )

  // Ensure pgvector HNSW indexes exist (fire-and-forget; non-fatal if unsupported)
  ensureVectorIndexes().catch(err =>
    console.error('Vector index ensure failed:', err.message)
  )

  // Auto-backfill missing product and KB embeddings on startup (fire-and-forget)
  _prisma.organization.findMany({ select: { id: true } }).then(async (orgs) => {
    for (const org of orgs) {
      import('./modules/products/product-embedding.js').then(({ backfillProductEmbeddings }) =>
        backfillProductEmbeddings(org.id).catch(() => {})
      )
      import('./modules/knowledge/embedding-service.js').then(({ backfillEmbeddings }) =>
        backfillEmbeddings(org.id).catch(() => {})
      )
    }
  }).catch(() => {})

  // ── BullMQ Workers — process automation triggers & delays via Redis ──
  initWorkers(
    async (job) => {
      const { trigger, context } = job.data
      await processTriggerJob(trigger, context)
    },
    async (job) => {
      await processDelayJob(job.data)
    },
  )
  console.log('📦 BullMQ automation workers started')

  // ── ZNS mass-send worker (rate-limited) ──
  initZnsSendWorker(processZnsSendJob)

  // ── KB & Product embedding worker (generate + store vectors) ──
  initEmbeddingWorker(async (job) => {
    const { orgId, entryId, productId, kind } = job.data
    if (kind === 'product' && productId) {
      const ok = await embedAndStoreProduct(orgId, productId)
      if (!ok) throw new Error(`Product embed failed for product ${productId}`)
      return
    }
    if (!entryId) return
    // Shared embed path — keeps on-save embeds consistent with the backfill.
    await embedAndStoreKbEntry(orgId, entryId)
  })
  console.log('🧬 KB & Product embedding worker started')

  // ── AI auto-reply orchestrator (debounced, per-conversation) ──
  // Hàng đợi BullMQ cho AI đã bỏ — chỉ còn debounce trong tiến trình. Bù phần
  // mất khi restart: xếp lịch lại các tin khách chưa được trả lời.
  recoverPendingAiReplies().catch(err => console.error('AI reply recovery failed:', err?.message))
  initTraceRetentionCron()
  console.log('🤖 AI reply orchestrator started')

  // ── AI trace cleanup (purges expired AiTrace rows, every 6h) ──
  const traceCleanupInterval = initTraceCleanup()
  console.log('🔍 AI trace cleanup scheduler started')

  // ── Integrations (PerfexCRM, …) — decoupled subscribers, opt-in per org ──
  registerPerfexIntegration()
  await initIntegrations()
  console.log('🔗 Integrations initialized')

  // ── Conversation idle poller (fires conversation_idle trigger) ──
  const idlePollInterval = setInterval(() => {
    pollConversationIdle().catch(err => console.error('[idle-poller]', err.message))
  }, 60_000)
  console.log('⏱️  Conversation idle poller started (60s)')

  // ── No-reply 24h poller (fires no_reply_24h trigger) ──
  const noReplyPollInterval = setInterval(() => {
    pollNoReply24h().catch(err => console.error('[no-reply-24h]', err.message))
  }, 300_000) // every 5 minutes
  console.log('⏱️  No-reply 24h poller started (5m)')

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...')
    clearInterval(idlePollInterval)
    clearInterval(noReplyPollInterval)
    clearInterval(traceCleanupInterval)
    await shutdownQueue()
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
} catch (err: any) {
  app.log.error(err)
  process.exit(1)
}

