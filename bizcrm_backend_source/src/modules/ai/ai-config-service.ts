/**
 * AI configuration & usage queries — split from ai-service.ts to keep files small.
 */
import { prisma } from '../../shared/prisma-client.js'
import { logger } from '../../shared/logger.js'
import { encryptToken, decryptToken } from '../../shared/crypto.js'
import { config } from '../../config/index.js'
import { getAvailableProviders, getProviderConfig } from './provider-registry.js'

const VERIFY_TIMEOUT_MS = 15_000

// Bootstrap defaults for a newly-onboarded org's AiConfig row. The org can
// change provider/model via Settings UI afterwards. Hardcoded (not env-driven)
// because AI provider config is owned by the UI, not deployment.
const BOOTSTRAP_PROVIDER = 'openai'
const BOOTSTRAP_MODEL = 'gpt-4.1-mini'

/** Có khoá mã hoá (TOKEN_ENC_KEY) thì mới mã hoá được; không có thì cảnh báo và giữ chữ thường. */
function canEncryptSecrets(): boolean {
  return !!process.env.TOKEN_ENC_KEY
}
let warnedPlainKey = false

export async function getProviderApiKey(orgId: string, provider: string): Promise<string> {
  const settingKey = `ai_${provider}_api_key`
  const setting = await prisma.appSetting.findFirst({ where: { orgId, settingKey } })
  if (!setting) return ''

  if (setting.valueEncrypted) {
    try {
      const encStr = Buffer.from(setting.valueEncrypted).toString('utf8')
      return decryptToken(encStr)
    } catch (err) {
      logger.error({ err, provider }, '[ai-config] không giải mã được API key — kiểm tra TOKEN_ENC_KEY')
      return setting.valuePlain || ''
    }
  }

  const plain = setting.valuePlain || ''
  // Bản chữ thường còn sót: mã hoá ngay lần đọc đầu tiên rồi xoá bản thường.
  if (plain && canEncryptSecrets()) {
    try {
      await prisma.appSetting.update({
        where: { id: setting.id },
        data: { valueEncrypted: Buffer.from(encryptToken(plain), 'utf8'), valuePlain: null },
      })
      logger.info({ provider }, '[ai-config] đã mã hoá API key đang lưu chữ thường')
    } catch (err) {
      logger.warn({ err, provider }, '[ai-config] không mã hoá được API key cũ')
    }
  } else if (plain && !warnedPlainKey) {
    warnedPlainKey = true
    logger.warn('[ai-config] API key AI đang lưu CHỮ THƯỜNG trong CSDL — đặt TOKEN_ENC_KEY để mã hoá')
  }
  return plain
}

export async function saveProviderApiKey(orgId: string, provider: string, apiKey: string) {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('API key cannot be empty')
  if (trimmed.length < 8) throw new Error('API key seems too short')
  if (!getProviderConfig(provider)) throw new Error(`Unknown provider: ${provider}`)
  const data = canEncryptSecrets()
    ? { valueEncrypted: Buffer.from(encryptToken(trimmed), 'utf8'), valuePlain: null }
    : { valuePlain: trimmed, valueEncrypted: null }
  return prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey: `ai_${provider}_api_key` } },
    update: data,
    create: { orgId, settingKey: `ai_${provider}_api_key`, ...data },
  })
}

/**
 * Verify an API key by probing the provider's /models endpoint.
 * Returns ok: true if the key is accepted, ok: false with a friendly error otherwise.
 * Uses GET /models (free, lightweight) where supported.
 */
export async function verifyProviderApiKey(
  provider: string,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const def = getProviderConfig(provider)
  if (!def) return { ok: false, status: 400, error: `Unknown provider: ${provider}` }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
  const baseUrl = def.baseUrl

  try {
    let url: string
    let headers: Record<string, string> = {}

    if (provider === 'openai' || provider === 'minimax') {
      url = `${baseUrl}/v1/models`
      headers = { authorization: `Bearer ${apiKey}` }
    } else if (provider === 'anthropic') {
      url = `${baseUrl}/v1/models`
      headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    } else if (provider === 'gemini') {
      url = `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`
    } else {
      return { ok: false, status: 400, error: `Verification not supported for ${provider}` }
    }

    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
    const rawBody = await response.text().catch(() => '')

    if (response.ok) {
      // MiniMax returns HTTP 200 even on auth failure — error is encoded in
      // `base_resp.status_code` (0 = success, non-zero = error). Parse the body to detect.
      if (provider === 'minimax') {
        try {
          const parsed = JSON.parse(rawBody) as { base_resp?: { status_code?: number; status_msg?: string } }
          const code = parsed.base_resp?.status_code
          if (code !== undefined && code !== 0) {
            return {
              ok: false,
              status: 401,
              error: parsed.base_resp?.status_msg || `MiniMax đã từ chối key (mã ${code})`,
            }
          }
        } catch {
          /* if body isn't JSON, treat HTTP 200 as success */
        }
      }
      return { ok: true }
    }

    const body = rawBody.slice(0, 300)
    const friendly =
      response.status === 401 || response.status === 403
        ? 'API key không hợp lệ hoặc không có quyền'
        : response.status === 429
          ? 'API key bị rate-limit (kiểm tra hạn mức của tài khoản)'
          : response.status === 404
            ? `Endpoint không tồn tại — kiểm tra base URL provider`
            : `${provider} trả về lỗi ${response.status}: ${body || 'không có message'}`
    return { ok: false, status: response.status, error: friendly }
  } catch (err) {
    const isAbort = (err as Error).name === 'AbortError'
    return {
      ok: false,
      status: 0,
      error: isAbort
        ? `Provider không phản hồi trong ${VERIFY_TIMEOUT_MS / 1000}s — kiểm tra mạng/proxy`
        : `Không kết nối được provider: ${(err as Error).message || String(err)}`,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function deleteProviderApiKey(orgId: string, provider: string) {
  return prisma.appSetting.deleteMany({
    where: { orgId, settingKey: `ai_${provider}_api_key` },
  })
}

export async function getAiConfig(orgId: string) {
  let aiConfig = await prisma.aiConfig.findUnique({ where: { orgId } })
  if (!aiConfig) {
    aiConfig = await prisma.aiConfig.create({
      data: {
        orgId,
        provider: BOOTSTRAP_PROVIDER,
        model: BOOTSTRAP_MODEL,
        maxDaily: config.aiDailyLimit,
        enabled: true,
      },
    })
  }
  const availableProviders = getAvailableProviders()
  // Single batched lookup beats 4 round-trips when settings are stored per-org
  const settings = await prisma.appSetting.findMany({
    where: {
      orgId,
      settingKey: { in: ['ai_openai_api_key', 'ai_minimax_api_key', 'ai_anthropic_api_key', 'ai_gemini_api_key'] },
    },
    select: { settingKey: true, valuePlain: true },
  })
  const fromDb = (key: string) => !!settings.find((s) => s.settingKey === key)?.valuePlain

  const hasOpenaiKey = fromDb('ai_openai_api_key')
  const hasMinimaxKey = fromDb('ai_minimax_api_key')
  const hasAnthropicKey = fromDb('ai_anthropic_api_key')
  const hasGeminiKey = fromDb('ai_gemini_api_key')

  const schedule = await getAiScheduleConfig(orgId)

  return {
    ...aiConfig,
    hasOpenaiKey,
    hasMinimaxKey,
    hasAnthropicKey,
    hasGeminiKey,
    availableProviders,
    schedule,
    isAfterHours: isAfterHours(new Date(), schedule.timezone, schedule.startHour, schedule.endHour),
  }
}

export type AiTaskType =
  | 'reply_draft' | 'summary' | 'sentiment' | 'lead_score' | 'ai_cdp'
  | 'ai_router' | 'auto_reply' | 'ai_master' // AI auto-reply harness (two-pass + Master)
export type TaskOverride = { provider?: string | null; model?: string | null }
export type TaskOverrides = Partial<Record<AiTaskType, TaskOverride>>

const VALID_TASK_TYPES: AiTaskType[] = ['reply_draft', 'summary', 'sentiment', 'lead_score', 'ai_cdp', 'ai_router', 'auto_reply', 'ai_master']

export function isValidTaskType(t: string): t is AiTaskType {
  return (VALID_TASK_TYPES as string[]).includes(t)
}

export async function updateAiConfig(
  orgId: string,
  input: {
    provider?: string
    model?: string
    maxDaily?: number
    enabled?: boolean
    taskOverrides?: TaskOverrides
    // AI auto-reply fields (M1)
    defaultAiMode?: string
    autoReplyEnabled?: boolean
    debounceSeconds?: number
    prefilterKeywords?: string | null
    groupRequireMention?: boolean
    mentionNames?: string | null
    // RAG + embeddings (M3)
    ragTopK?: number
    embeddingProvider?: string | null
    embeddingModel?: string | null
    // RAG guardrail (allow-lists; empty = no limit)
    allowedProductCategoryIds?: string[]
    allowedKnowledgeCategoryIds?: string[]
    // Trace retention (M3)
    traceRetentionDays?: number
    traceErrorRetentionDays?: number
    // Critic / verify-before-send (P6)
    verifyBeforeSend?: boolean
    // Auto-learn (M3)
    autoLearnEnabled?: boolean
    autoLearnIntervalDays?: number
  },
) {
  invalidateAiReplyConfigCache(orgId)
  // Sanitize taskOverrides — strip unknown task types, drop empty entries
  const cleanOverrides: TaskOverrides | undefined = input.taskOverrides
    ? Object.fromEntries(
        Object.entries(input.taskOverrides)
          .filter(([k, v]) => isValidTaskType(k) && v && (v.provider || v.model))
          .map(([k, v]) => [k, { provider: v?.provider || undefined, model: v?.model || undefined }]),
      )
    : undefined

  // Validate auto-reply fields
  const validModes = ['manual', 'auto', 'suggest']
  if (input.defaultAiMode !== undefined && !validModes.includes(input.defaultAiMode)) {
    throw new Error(`defaultAiMode must be one of: ${validModes.join(', ')}`)
  }
  if (input.debounceSeconds !== undefined && (input.debounceSeconds < 0 || input.debounceSeconds > 60)) {
    throw new Error('debounceSeconds must be between 0 and 60')
  }
  // Validate M3 fields
  if (input.ragTopK !== undefined && (input.ragTopK < 1 || input.ragTopK > 50)) {
    throw new Error('ragTopK must be between 1 and 50')
  }
  if (input.traceRetentionDays !== undefined && input.traceRetentionDays < 1) {
    throw new Error('traceRetentionDays must be at least 1')
  }
  if (input.traceErrorRetentionDays !== undefined && input.traceErrorRetentionDays < 1) {
    throw new Error('traceErrorRetentionDays must be at least 1')
  }
  if (input.autoLearnIntervalDays !== undefined && input.autoLearnIntervalDays < 1) {
    throw new Error('autoLearnIntervalDays must be at least 1')
  }
  // Sanitize guardrail allow-lists: keep only non-empty unique strings
  const cleanIds = (arr?: string[]) =>
    arr === undefined ? undefined : [...new Set(arr.filter((s) => typeof s === 'string' && s.trim()))]
  const allowedProductCategoryIds = cleanIds(input.allowedProductCategoryIds)
  const allowedKnowledgeCategoryIds = cleanIds(input.allowedKnowledgeCategoryIds)

  return prisma.aiConfig.upsert({
    where: { orgId },
    create: {
      orgId,
      provider: input.provider || BOOTSTRAP_PROVIDER,
      model: input.model || BOOTSTRAP_MODEL,
      maxDaily: input.maxDaily ?? config.aiDailyLimit,
      enabled: input.enabled ?? true,
      taskOverrides: cleanOverrides ?? {},
      defaultAiMode: input.defaultAiMode ?? 'manual',
      autoReplyEnabled: input.autoReplyEnabled ?? false,
      debounceSeconds: input.debounceSeconds ?? 5,
      prefilterKeywords: input.prefilterKeywords ?? null,
      groupRequireMention: input.groupRequireMention ?? true,
      mentionNames: input.mentionNames ?? null,
      ragTopK: input.ragTopK ?? 5,
      embeddingProvider: input.embeddingProvider ?? null,
      embeddingModel: input.embeddingModel ?? null,
      allowedProductCategoryIds: allowedProductCategoryIds ?? [],
      allowedKnowledgeCategoryIds: allowedKnowledgeCategoryIds ?? [],
      traceRetentionDays: input.traceRetentionDays ?? 14,
      traceErrorRetentionDays: input.traceErrorRetentionDays ?? 90,
      verifyBeforeSend: input.verifyBeforeSend ?? false,
      autoLearnEnabled: input.autoLearnEnabled ?? false,
      autoLearnIntervalDays: input.autoLearnIntervalDays ?? 7,
    },
    update: {
      provider: input.provider,
      model: input.model,
      maxDaily: input.maxDaily,
      enabled: input.enabled,
      ...(cleanOverrides !== undefined ? { taskOverrides: cleanOverrides } : {}),
      ...(input.defaultAiMode !== undefined ? { defaultAiMode: input.defaultAiMode } : {}),
      ...(input.autoReplyEnabled !== undefined ? { autoReplyEnabled: input.autoReplyEnabled } : {}),
      ...(input.debounceSeconds !== undefined ? { debounceSeconds: input.debounceSeconds } : {}),
      ...(input.prefilterKeywords !== undefined ? { prefilterKeywords: input.prefilterKeywords } : {}),
      ...(input.groupRequireMention !== undefined ? { groupRequireMention: input.groupRequireMention } : {}),
      ...(input.mentionNames !== undefined ? { mentionNames: input.mentionNames } : {}),
      ...(input.ragTopK !== undefined ? { ragTopK: input.ragTopK } : {}),
      ...(input.embeddingProvider !== undefined ? { embeddingProvider: input.embeddingProvider } : {}),
      ...(input.embeddingModel !== undefined ? { embeddingModel: input.embeddingModel } : {}),
      ...(allowedProductCategoryIds !== undefined ? { allowedProductCategoryIds } : {}),
      ...(allowedKnowledgeCategoryIds !== undefined ? { allowedKnowledgeCategoryIds } : {}),
      ...(input.traceRetentionDays !== undefined ? { traceRetentionDays: input.traceRetentionDays } : {}),
      ...(input.traceErrorRetentionDays !== undefined ? { traceErrorRetentionDays: input.traceErrorRetentionDays } : {}),
      ...(input.verifyBeforeSend !== undefined ? { verifyBeforeSend: input.verifyBeforeSend } : {}),
      ...(input.autoLearnEnabled !== undefined ? { autoLearnEnabled: input.autoLearnEnabled } : {}),
      ...(input.autoLearnIntervalDays !== undefined ? { autoLearnIntervalDays: input.autoLearnIntervalDays } : {}),
    },
  })
}

export type ScheduleConfig = {
  enabled: boolean
  startHour: number
  endHour: number
  daytimeMode: 'suggest' | 'manual'
  nighttimeMode: 'auto' | 'suggest'
  timezone: string
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  enabled: true,
  startHour: 18,
  endHour: 8,
  daytimeMode: 'suggest',
  nighttimeMode: 'auto',
  timezone: 'Asia/Ho_Chi_Minh',
}

/**
 * Check if the given date/time falls in the after-hours window (e.g. 18:00 -> 08:00 next day).
 */
export function isAfterHours(
  date: Date = new Date(),
  timezone: string = 'Asia/Ho_Chi_Minh',
  startHour: number = 18,
  endHour: number = 8,
): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10)
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10)
    const timeInMinutes = hour * 60 + minute

    const startMinutes = startHour * 60
    const endMinutes = endHour * 60

    if (startMinutes < endMinutes) {
      // Daytime window: e.g. 8:00 (480m) to 18:00 (1080m) is daytime
      // Therefore, after-hours is outside this daytime window (< 8:00 or >= 18:00)
      const isDaytime = timeInMinutes >= startMinutes && timeInMinutes < endMinutes
      return !isDaytime
    } else {
      // Overnight after-hours window: e.g. 18:00 (1080m) to 08:00 (480m) next day
      return timeInMinutes >= startMinutes || timeInMinutes < endMinutes
    }
  } catch {
    const utcHours = date.getUTCHours() + 7
    const vnHour = utcHours >= 24 ? utcHours - 24 : utcHours
    return vnHour >= 18 || vnHour < 8
  }
}

export async function getAiScheduleConfig(orgId: string): Promise<ScheduleConfig> {
  const setting = await prisma.appSetting.findFirst({
    where: { orgId, settingKey: 'ai_auto_reply_schedule' },
  })
  if (!setting?.valuePlain) return DEFAULT_SCHEDULE_CONFIG
  try {
    const parsed = JSON.parse(setting.valuePlain)
    return { ...DEFAULT_SCHEDULE_CONFIG, ...parsed }
  } catch {
    return DEFAULT_SCHEDULE_CONFIG
  }
}

export async function saveAiScheduleConfig(orgId: string, cfg: Partial<ScheduleConfig>) {
  invalidateAiReplyConfigCache(orgId)
  const current = await getAiScheduleConfig(orgId)
  const updated = { ...current, ...cfg }
  return prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId, settingKey: 'ai_auto_reply_schedule' } },
    update: { valuePlain: JSON.stringify(updated) },
    create: { orgId, settingKey: 'ai_auto_reply_schedule', valuePlain: JSON.stringify(updated) },
  })
}

export type AiReplyConfig = {
  defaultAiMode: string
  autoReplyEnabled: boolean
  debounceSeconds: number
  prefilterKeywords: string | null
  /** Trong nhóm, chỉ trả lời khi có người nhắc tên. */
  groupRequireMention: boolean
  /** Tên gọi coi là "được nhắc", cách nhau bằng dấu phẩy. */
  mentionNames: string | null
  schedule: ScheduleConfig
  // M3 fields
  ragTopK: number
  embeddingProvider: string | null
  embeddingModel: string | null
  traceRetentionDays: number
  traceErrorRetentionDays: number
  autoLearnEnabled: boolean
  autoLearnIntervalDays: number
}

/**
 * Get the auto-reply configuration for an org.
 * Creates a default AiConfig row if none exists.
 */
// Mỗi tin đến — kể cả hội thoại thủ công — đều đọc cấu hình + lịch (2 truy vấn).
// Cache ngắn; mọi chỗ ghi cấu hình gọi invalidateAiReplyConfigCache.
const AI_REPLY_CFG_TTL_MS = 30_000
const aiReplyConfigCache = new Map<string, { at: number; value: AiReplyConfig }>()
export function invalidateAiReplyConfigCache(orgId?: string): void {
  if (orgId) aiReplyConfigCache.delete(orgId)
  else aiReplyConfigCache.clear()
}

export async function getAiReplyConfig(orgId: string): Promise<AiReplyConfig> {
  const hit = aiReplyConfigCache.get(orgId)
  if (hit && Date.now() - hit.at < AI_REPLY_CFG_TTL_MS) return hit.value
  const value = await loadAiReplyConfig(orgId)
  aiReplyConfigCache.set(orgId, { at: Date.now(), value })
  return value
}

async function loadAiReplyConfig(orgId: string): Promise<AiReplyConfig> {
  let cfg = await prisma.aiConfig.findUnique({ where: { orgId } })
  if (!cfg) {
    cfg = await prisma.aiConfig.create({
      data: {
        orgId,
        provider: BOOTSTRAP_PROVIDER,
        model: BOOTSTRAP_MODEL,
        maxDaily: config.aiDailyLimit,
        enabled: true,
      },
    })
  }
  const schedule = await getAiScheduleConfig(orgId)
  return {
    defaultAiMode: cfg.defaultAiMode,
    autoReplyEnabled: cfg.autoReplyEnabled,
    debounceSeconds: cfg.debounceSeconds,
    prefilterKeywords: cfg.prefilterKeywords ?? null,
    groupRequireMention: cfg.groupRequireMention,
    mentionNames: cfg.mentionNames ?? null,
    schedule,
    ragTopK: cfg.ragTopK,
    embeddingProvider: cfg.embeddingProvider ?? null,
    embeddingModel: cfg.embeddingModel ?? null,
    traceRetentionDays: cfg.traceRetentionDays,
    traceErrorRetentionDays: cfg.traceErrorRetentionDays,
    autoLearnEnabled: cfg.autoLearnEnabled,
    autoLearnIntervalDays: cfg.autoLearnIntervalDays,
  }
}

/**
 * Resolve effective AI mode for a conversation.
 * - If org master switch is off → 'manual' always
 * - If conversation mode is explicitly 'manual' → 'manual'
 * - If schedule is enabled:
 *     - After hours (e.g. after 18h) → nighttimeMode ('auto')
 *     - Daytime (e.g. 08:00 - 18:00) → daytimeMode ('suggest')
 * - Otherwise: convAiMode ?? defaultAiMode
 */
export function resolveConversationMode(input: {
  orgId: string
  autoReplyEnabled: boolean
  defaultAiMode: string
  convAiMode?: string | null
  /**
   * Lý do đặt chế độ của hội thoại. CÓ lý do = nhân viên/handoff chọn rõ ràng;
   * KHÔNG có = giá trị mặc định điền lúc tạo hội thoại. Cần phân biệt vì
   * `aiMode` dùng chung một cột cho cả hai — trước đây "Thủ công" do nhân viên
   * chọn bị lịch giờ ghi đè y như chưa chọn, AI tự bật lại lúc 18:00.
   */
  convAiModeReason?: string | null
  schedule?: ScheduleConfig
  currentTime?: Date
}): string {
  if (!input.autoReplyEnabled) return 'manual'

  if (input.convAiMode === 'off') return 'manual'

  // "Thủ công" CÓ CHỦ ĐÍCH (nhân viên bấm, hoặc AI vừa chuyển người) là quyết
  // định cuối — lịch giờ không được ghi đè.
  const explicitManual = input.convAiMode === 'manual' && !!input.convAiModeReason
  if (explicitManual) return 'manual'

  if (input.schedule?.enabled) {
    // Hội thoại đã chọn rõ suggest/auto thì giữ; còn lại đi theo lịch.
    if (input.convAiMode && input.convAiMode !== 'manual') return input.convAiMode
    const afterHours = isAfterHours(
      input.currentTime,
      input.schedule.timezone || 'Asia/Ho_Chi_Minh',
      input.schedule.startHour ?? 18,
      input.schedule.endHour ?? 8,
    )
    return afterHours ? (input.schedule.nighttimeMode ?? 'auto') : (input.schedule.daytimeMode ?? 'auto')
  }

  return input.convAiMode ?? input.defaultAiMode
}

/**
 * Bulk-apply the org's default AI mode to ALL existing conversations.
 * Backs the "áp dụng cho cả hội thoại hiện tại" choice in AI config — it
 * overwrites per-conversation overrides by design (the dialog says so).
 */
export async function applyDefaultModeToAllConversations(orgId: string, mode: string): Promise<number> {
  const res = await prisma.conversation.updateMany({
    where: { orgId },
    data: { aiMode: mode, aiModeReason: 'bulk: áp dụng chế độ mặc định từ Cấu hình AI' },
  })
  return res.count
}

/**
 * Resolve effective provider+model for a given task.
 * Order of precedence: task override → org default.
 */
export function getEffectiveConfigForTask(
  cfg: { provider: string; model: string; taskOverrides?: unknown },
  taskType: AiTaskType,
): { provider: string; model: string } {
  const overrides = (cfg.taskOverrides ?? {}) as TaskOverrides
  const override = overrides[taskType]
  return {
    provider: override?.provider || cfg.provider,
    model: override?.model || cfg.model,
  }
}

export type AiUsageSeriesPoint = {
  date: string // ISO yyyy-mm-dd
  calls: number
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  costUsd: number
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function getAiUsage(orgId: string, days: number = 1) {
  const cfg = await getAiConfig(orgId)
  const safeDays = Math.max(1, Math.min(90, Math.floor(days)))
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  // Today bucket (used by existing UI panels)
  const todayUsages = await prisma.aiUsage.findMany({
    where: { orgId, createdAt: { gte: startOfDay } },
    select: { tokensIn: true, tokensOut: true, cacheReadTokens: true, costUsd: true, type: true },
  })
  const tokensIn = todayUsages.reduce((s, u) => s + u.tokensIn, 0)
  const tokensOut = todayUsages.reduce((s, u) => s + u.tokensOut, 0)
  const cacheReadTokens = todayUsages.reduce((s, u) => s + (u.cacheReadTokens ?? 0), 0)
  const costUsd = todayUsages.reduce((s, u) => s + Number(u.costUsd ?? 0), 0)
  const byType: Record<string, number> = {}
  for (const u of todayUsages) byType[u.type] = (byType[u.type] || 0) + 1
  // "Lượt gọi" / quota counts LLM calls only — embeddings are logged for cost
  // visibility but must not burn the daily call budget (3-4 embeds per reply turn).
  const llmCalls = todayUsages.filter((u) => u.type !== 'embedding').length

  // Daily series for the chart (D5.14). Only computed when days > 1 to avoid extra query.
  let series: AiUsageSeriesPoint[] = []
  if (safeDays > 1) {
    const seriesStart = new Date()
    seriesStart.setHours(0, 0, 0, 0)
    seriesStart.setDate(seriesStart.getDate() - (safeDays - 1))

    const seriesUsages = await prisma.aiUsage.findMany({
      where: { orgId, createdAt: { gte: seriesStart } },
      select: { createdAt: true, tokensIn: true, tokensOut: true, cacheReadTokens: true, costUsd: true },
    })

    const buckets = new Map<string, AiUsageSeriesPoint>()
    // Pre-fill every day in range so the chart has a continuous x-axis even
    // for days with zero calls.
    for (let i = 0; i < safeDays; i += 1) {
      const d = new Date(seriesStart)
      d.setDate(seriesStart.getDate() + i)
      const key = isoDate(d)
      buckets.set(key, { date: key, calls: 0, tokensIn: 0, tokensOut: 0, cacheReadTokens: 0, costUsd: 0 })
    }
    for (const u of seriesUsages) {
      const key = isoDate(u.createdAt)
      const bucket = buckets.get(key)
      if (!bucket) continue
      bucket.calls += 1
      bucket.tokensIn += u.tokensIn
      bucket.tokensOut += u.tokensOut
      bucket.cacheReadTokens += u.cacheReadTokens ?? 0
      bucket.costUsd += Number(u.costUsd ?? 0)
    }
    series = Array.from(buckets.values()).map((b) => ({
      ...b,
      costUsd: Number(b.costUsd.toFixed(4)),
    }))
  }

  return {
    callsToday: llmCalls,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    costUsd: Number(costUsd.toFixed(4)),
    maxDaily: cfg.maxDaily,
    remaining: Math.max(0, cfg.maxDaily - llmCalls),
    enabled: cfg.enabled,
    byType,
    series, // empty unless days > 1
    days: safeDays,
  }
}

/** Đầu ngày theo múi giờ cho trước, trả về mốc UTC tương ứng. */
export function startOfDayInTimezone(timezone = 'Asia/Ho_Chi_Minh', now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10)
  // giờ hiện tại theo múi giờ → lùi về 00:00 của ngày đó
  const elapsedMs = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000
  return new Date(now.getTime() - elapsedMs - now.getMilliseconds())
}

export async function ensureQuota(orgId: string, maxDaily: number) {
  // Ngày tính theo giờ Việt Nam (máy chủ có thể chạy UTC — reset giữa buổi sáng).
  const startOfDay = startOfDayInTimezone('Asia/Ho_Chi_Minh')
  // Đếm LƯỢT, không đếm dòng: một lượt trả lời ghi ~2–3 dòng ai_usage (router +
  // generator + critic) nên đếm dòng làm quota cạn nhanh gấp 2–3 lần cài đặt.
  // Dòng không thuộc lượt nào (tóm tắt, chấm điểm…) vẫn tính mỗi dòng một đơn vị.
  const rows = await prisma.$queryRaw<Array<{ used: bigint }>>`
    SELECT count(DISTINCT coalesce(ai_reply_run_id, id)) AS used
    FROM ai_usage
    WHERE org_id = ${orgId} AND created_at >= ${startOfDay} AND type <> 'embedding'
  `
  const used = Number(rows[0]?.used ?? 0)
  if (used >= maxDaily) throw new Error(`AI daily quota exceeded (${used}/${maxDaily} lượt hôm nay)`)
}

export { getAvailableProviders }
