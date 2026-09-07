/**
 * AI service — generation logic.
 * Config & usage queries live in ai-config-service.ts. Helpers in ai-helpers.ts. Pricing in ai-pricing.ts.
 */
import { prisma } from '../../shared/prisma-client.js'
import { getProviderConfig } from './provider-registry.js'
import { generateWithAnthropic } from './providers/anthropic.js'
import { generateWithGemini } from './providers/gemini.js'
import { generateWithOpenai } from './providers/openai.js'
import { buildReplyDraftPrompt, parseReplyDraftSuggestions, type ReplyDraftTone } from './prompts/reply-draft.js'
import { buildSummaryPrompt } from './prompts/summary.js'
import { buildSentimentPrompt } from './prompts/sentiment.js'
import { buildLeadScoringPrompt } from './prompts/lead-scoring.js'
import { buildAnalysisPrompt } from './prompts/analysis.js'
import { detectLanguage, buildContextBlock, parseSentiment, parseLeadScore } from './ai-helpers.js'
import { estimateCost, type GenerateRaw } from './ai-pricing.js'
import { getAiConfig, getProviderApiKey, ensureQuota, getEffectiveConfigForTask } from './ai-config-service.js'

// User-configurable task types (must match ai-config-service.AiTaskType)
export type AiTaskType = 'reply_draft' | 'summary' | 'sentiment' | 'lead_score'
// Logged task types include the synthetic batch task. Used by AiUsage.type only.
export type LoggedTaskType =
  | AiTaskType | 'conversation_analysis' | 'ai_cdp'
  | 'ai_router' | 'auto_reply' | 'ai_master' // harness + Master (góp ý/cải thiện)
  | 'embedding' // vector embeds (RAG queries + KB/product backfills)
  | 'assistant_qa' // Trợ lý AI nội bộ — hỏi đáp tự do của nhân viên, không gắn hội thoại
export type SentimentResult = { label: 'positive' | 'neutral' | 'negative'; confidence: number; reason: string }
export type ConversationAnalysis = { summary: string; sentiment: SentimentResult; leadScore: LeadScoreResult }
export type LeadScoreResult = {
  score: number
  intent: 'cold' | 'warm' | 'hot'
  signals: Array<{ type: string; strength: number; evidence: string }>
  summary: string
  /** Customer pain points the AI extracted from the conversation (max 3). */
  painPoints: string[]
  /** Competitor brand names mentioned by the customer (max 3). */
  competitors: string[]
}

// Re-export for backwards compatibility with consumers that imported from ai-service.
export {
  getAiConfig,
  updateAiConfig,
  getAiUsage,
  getAvailableProviders,
} from './ai-config-service.js'

// ── Provider dispatch ───────────────────────────────────────────────────

export async function dispatchProvider(
  provider: string,
  apiKey: string,
  model: string,
  system: string,
  userPrompt: string,
  options: { jsonMode?: boolean; maxTokens?: number } = {},
): Promise<GenerateRaw> {
  const def = getProviderConfig(provider)
  const baseUrl = def?.baseUrl || ''
  if (!baseUrl) throw new Error(`Unknown provider: ${provider}`)

  // OpenAI + Minimax use the same OpenAI-compatible chat/completions API
  if (provider === 'openai' || provider === 'minimax') {
    return generateWithOpenai(baseUrl, apiKey, model, system, userPrompt, options)
  }
  if (provider === 'anthropic') {
    return generateWithAnthropic(baseUrl, apiKey, model, system, userPrompt, {
      enableCaching: true,
      maxTokens: options.maxTokens,
    })
  }
  if (provider === 'gemini') return generateWithGemini(baseUrl, apiKey, model, system, userPrompt, options)
  throw new Error(`Unsupported provider: ${provider}`)
}

// ── Usage logging ───────────────────────────────────────────────────────

export async function logUsage(input: {
  orgId: string
  provider: string
  model: string
  type: LoggedTaskType
  conversationId?: string
  contactId?: string
  raw: GenerateRaw
  // E5.3 — feature tag + harness turn grouping
  feature?: string
  aiReplyRunId?: string
}) {
  await prisma.aiUsage.create({
    data: {
      orgId: input.orgId,
      provider: input.provider,
      model: input.model,
      type: input.type,
      conversationId: input.conversationId,
      contactId: input.contactId,
      tokensIn: input.raw.tokensIn,
      tokensOut: input.raw.tokensOut,
      cacheReadTokens: input.raw.cacheReadTokens ?? 0,
      cacheCreationTokens: input.raw.cacheCreationTokens ?? 0,
      costUsd: estimateCost(input.model, input.raw),
      feature: input.feature ?? null,
      aiReplyRunId: input.aiReplyRunId ?? null,
    },
  })
}

// ── Conversation loader ─────────────────────────────────────────────────

async function loadConversation(conversationId: string, orgId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId },
    include: {
      contact: { select: { id: true, fullName: true } },
      messages: {
        where: { isDeleted: false },
        orderBy: { sentAt: 'desc' },
        take: 40,
        select: { senderType: true, senderName: true, content: true, contentType: true, sentAt: true },
      },
    },
  })
  if (!conversation) throw new Error('Conversation not found')
  return { ...conversation, messages: [...conversation.messages].reverse() }
}

// ── Public API ──────────────────────────────────────────────────────────

export async function generateAiOutput(input: {
  orgId: string
  conversationId: string
  type: Exclude<AiTaskType, 'lead_score'>
}) {
  const [cfg, conv] = await Promise.all([
    getAiConfig(input.orgId),
    loadConversation(input.conversationId, input.orgId),
  ])
  if (!cfg.enabled) throw new Error('AI is disabled for this organization')
  await ensureQuota(input.orgId, cfg.maxDaily)

  // Resolve provider + model for this specific task (may override default)
  const { provider, model } = getEffectiveConfigForTask(cfg, input.type)
  const apiKey = await getProviderApiKey(input.orgId, provider)
  if (!apiKey) throw new Error(`AI provider key for "${provider}" is not configured`)

  const customerName = conv.contact?.fullName || 'customer'
  const userPrompt = buildContextBlock(conv.messages, customerName)
  const language = detectLanguage(userPrompt)
  // reply_draft + sentiment both ask the model for strict JSON
  const isJson = input.type === 'sentiment' || input.type === 'reply_draft'

  const system =
    input.type === 'reply_draft'
      ? buildReplyDraftPrompt(language)
      : input.type === 'summary'
        ? buildSummaryPrompt(language)
        : buildSentimentPrompt(language)

  const raw = await dispatchProvider(provider, apiKey, model, system, userPrompt, {
    jsonMode: isJson,
    maxTokens: input.type === 'summary' ? 600 : input.type === 'reply_draft' ? 1200 : 800,
  })

  await logUsage({
    orgId: input.orgId,
    provider,
    model,
    type: input.type,
    conversationId: input.conversationId,
    raw,
    feature: input.type === 'reply_draft' ? 'manual_suggest' : 'analyze',
  })

  if (input.type === 'sentiment') {
    const parsed = parseSentiment(raw.text)
    await prisma.aiSuggestion.create({
      data: {
        orgId: input.orgId,
        conversationId: input.conversationId,
        type: 'sentiment',
        content: JSON.stringify(parsed),
        confidence: parsed.confidence,
      },
    })
    return parsed
  }

  if (input.type === 'reply_draft') {
    const items = parseReplyDraftSuggestions(raw.text)
    if (!items) {
      throw new Error('AI returned malformed reply suggestions. Please try again.')
    }
    // Persist one AiSuggestion row per variant so each carries its own id for
    // downstream acceptance tracking. Single LLM call → single AiUsage row (already logged above).
    const saved = await Promise.all(
      items.map(item =>
        prisma.aiSuggestion.create({
          data: {
            orgId: input.orgId,
            conversationId: input.conversationId,
            type: 'reply_suggestion',
            content: item.text,
            confidence: 0.8,
          },
        }),
      ),
    )
    const suggestions: Array<{ suggestionId: string; tone: ReplyDraftTone; text: string }> =
      items.map((item, idx) => ({ suggestionId: saved[idx].id, tone: item.tone, text: item.text }))
    return { suggestions }
  }

  // summary branch
  const content = raw.text.trim()
  await prisma.aiSuggestion.create({
    data: {
      orgId: input.orgId,
      conversationId: input.conversationId,
      type: 'summary',
      content,
      confidence: 0.8,
    },
  })
  return { summary: content }
}

export type AnalyzeOptions = { forceFresh?: boolean }

/**
 * Combined analysis: 1 LLM call returns summary + sentiment + lead score
 * (+ painPoints/competitors). Results are persisted directly to Contact
 * columns (ai_summary, ai_sentiment_label, etc.) so they survive across
 * sessions and are available immediately on page load.
 *
 * The frontend reads Contact fields for initial display and only calls this
 * endpoint when the user explicitly clicks "Phân tích khách hàng" or
 * "Phân tích lại".
 *
 * Logs ONE AiUsage row per call. Creates 3 AiSuggestion rows for
 * history/usage tracking.
 */
export async function analyzeConversation(
  input: { orgId: string; conversationId: string },
  options: AnalyzeOptions = {},
): Promise<ConversationAnalysis & { fromCache: boolean }> {
  const [cfg, conv] = await Promise.all([
    getAiConfig(input.orgId),
    loadConversation(input.conversationId, input.orgId),
  ])
  if (!cfg.enabled) throw new Error('AI is disabled for this organization')

  await ensureQuota(input.orgId, cfg.maxDaily)

  // The 3 sub-tasks share configuration — read summary's effective config as canonical.
  const { provider, model } = getEffectiveConfigForTask(cfg, 'summary')
  const apiKey = await getProviderApiKey(input.orgId, provider)
  if (!apiKey) throw new Error(`AI provider key for "${provider}" is not configured`)

  const customerName = conv.contact?.fullName || 'customer'
  const userPrompt = buildContextBlock(conv.messages, customerName)
  const language = detectLanguage(userPrompt)

  const raw = await dispatchProvider(provider, apiKey, model, buildAnalysisPrompt(language), userPrompt, {
    jsonMode: true,
    maxTokens: 1400,
  })

  await logUsage({
    orgId: input.orgId,
    provider,
    model,
    type: 'conversation_analysis',
    conversationId: input.conversationId,
    contactId: conv.contact?.id,
    raw,
    feature: 'analyze',
  })

  let parsed: { summary?: unknown; sentiment?: unknown; lead_score?: unknown } = {}
  try {
    parsed = JSON.parse(raw.text)
  } catch {
    /* parsed stays empty → individual parsers fall back to defaults */
  }

  const summary = String(parsed.summary || raw.text.slice(0, 600)).trim()
  const sentiment = parseSentiment(JSON.stringify(parsed.sentiment ?? {}))
  const leadScore = parseLeadScore(JSON.stringify(parsed.lead_score ?? {}))

  // Persist three AiSuggestion rows for history/usage tracking.
  await Promise.all([
    prisma.aiSuggestion.create({
      data: { orgId: input.orgId, conversationId: input.conversationId, type: 'summary', content: summary, confidence: 0.8 },
    }),
    prisma.aiSuggestion.create({
      data: {
        orgId: input.orgId,
        conversationId: input.conversationId,
        type: 'sentiment',
        content: JSON.stringify(sentiment),
        confidence: sentiment.confidence,
      },
    }),
    prisma.aiSuggestion.create({
      data: {
        orgId: input.orgId,
        conversationId: input.conversationId,
        type: 'lead_score',
        content: JSON.stringify(leadScore),
        confidence: 0.8,
      },
    }),
  ])

  // Persist AI insights directly to Contact columns (the SSOT).
  if (conv.contact?.id) {
    await persistAiInsightsToContact({
      contactId: conv.contact.id,
      conversationId: input.conversationId,
      summary,
      sentiment,
      leadScore,
    }).catch(() => undefined)
  }

  return { summary, sentiment, leadScore, fromCache: false }
}

/**
 * Write AI analysis results directly to Contact columns. This is the
 * single source of truth — the frontend reads these fields on page load
 * without any extra API calls.
 */
async function persistAiInsightsToContact(args: {
  contactId: string
  conversationId: string
  summary: string
  sentiment: SentimentResult
  leadScore: LeadScoreResult
}): Promise<void> {
  await prisma.contact.update({
    where: { id: args.contactId },
    data: {
      aiSummary: args.summary,
      aiSentimentLabel: args.sentiment.label,
      aiSentimentConfidence: args.sentiment.confidence,
      aiSentimentReason: args.sentiment.reason,
      aiIntent: args.leadScore.intent,
      leadScore: args.leadScore.score,
      aiPainPoints: args.leadScore.painPoints,
      aiCompetitors: args.leadScore.competitors,
      aiSignals: args.leadScore.signals,
      aiAnalyzedAt: new Date(),
      aiConversationId: args.conversationId,
    },
  })
}

export async function scoreLeadFromConversation(input: {
  orgId: string
  conversationId: string
}): Promise<LeadScoreResult> {
  const [cfg, conv] = await Promise.all([
    getAiConfig(input.orgId),
    loadConversation(input.conversationId, input.orgId),
  ])
  if (!cfg.enabled) throw new Error('AI is disabled for this organization')
  await ensureQuota(input.orgId, cfg.maxDaily)

  const { provider, model } = getEffectiveConfigForTask(cfg, 'lead_score')
  const apiKey = await getProviderApiKey(input.orgId, provider)
  if (!apiKey) throw new Error(`AI provider key for "${provider}" is not configured`)

  const customerName = conv.contact?.fullName || 'customer'
  const userPrompt = buildContextBlock(conv.messages, customerName)
  const language = detectLanguage(userPrompt)

  const raw = await dispatchProvider(
    provider,
    apiKey,
    model,
    buildLeadScoringPrompt(language),
    userPrompt,
    { jsonMode: true, maxTokens: 800 },
  )

  await logUsage({
    orgId: input.orgId,
    provider,
    model,
    type: 'lead_score',
    conversationId: input.conversationId,
    contactId: conv.contact?.id,
    raw,
    feature: 'analyze',
  })

  const result = parseLeadScore(raw.text)
  if (conv.contact?.id) {
    await prisma.contact
      .update({ where: { id: conv.contact.id }, data: { leadScore: result.score } })
      .catch(() => undefined)
  }
  return result
}
