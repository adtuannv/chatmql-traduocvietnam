/**
 * assistant-service.ts — "AI Trợ lý" nội bộ: nhân viên hỏi đáp/tra cứu tự do
 * (sản phẩm, kiến thức công ty), KHÔNG gắn với một hội thoại/khách hàng cụ thể
 * và KHÔNG bao giờ gửi gì ra ngoài (Zalo/khách hàng). Tái dùng đúng nguồn dữ
 * liệu RAG (KB + sản phẩm) mà harness trả lời khách dùng, nhưng bỏ hẳn phần
 * ngữ cảnh hội thoại (persona/playbook/lịch sử chat/hồ sơ khách).
 */
import { getAiConfig, getProviderApiKey, ensureQuota, getEffectiveConfigForTask } from './ai-config-service.js'
import { dispatchProvider, logUsage } from './ai-service.js'
import { getToolsConfig } from './tools-config-service.js'
import { retrieveKb } from '../knowledge/kb-service.js'
import { retrieveKbSemantic } from '../knowledge/embedding-service.js'
import { retrieveProductSemantic } from '../products/product-embedding.js'
import { retrieveProductDocs } from '../product-docs/product-docs-service.js'
import { retrieveDocAssets } from '../doc-library/doc-library-service.js'
import { resolveBotById } from './ai-bot-service.js'
import { getContextBudgets, truncate } from './harness/budgets.js'

const TOP_K = 5
const MAX_KB_CHARS = 3000
const MAX_PRODUCT_CHARS = 1500
const MAX_DOC_CHARS = 2500
const MAX_HISTORY_TURNS = 6

export interface AssistantTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface AskAssistantResult {
  reply: string
  usedSources: { kb: number; products: number; docs: number }
}

async function loadKbContext(orgId: string, query: string): Promise<{ text: string; count: number }> {
  const tools = await getToolsConfig(orgId)
  if (!tools.search_knowledge.enabled) return { text: '', count: 0 }
  const ids = tools.search_knowledge.guardrail.categoryIds
  const fb = (o: string, q: string, k: number) => retrieveKb(o, q, k, { categoryIds: ids })
  const snippets = await retrieveKbSemantic(orgId, query, TOP_K, fb, { categoryIds: ids, minScore: 0.3 })

  let total = 0
  const kept: string[] = []
  for (const s of snippets) {
    const block = `- [${s.title}] ${s.content}`
    total += block.length
    if (total > MAX_KB_CHARS) break
    kept.push(block)
  }
  return { text: kept.join('\n'), count: kept.length }
}

async function loadProductContext(orgId: string, query: string): Promise<{ text: string; count: number }> {
  const tools = await getToolsConfig(orgId)
  if (!tools.search_products.enabled) return { text: '', count: 0 }
  const ids = tools.search_products.guardrail.categoryIds
  const rows = await retrieveProductSemantic(orgId, query, TOP_K, { categoryIds: ids, minScore: 0.3 })

  let total = 0
  const kept: string[] = []
  for (const r of rows) {
    const price = r.price != null ? `${r.price}${r.currency ? ` ${r.currency}` : ''}` : 'chưa có giá'
    const block = `- ${r.name} (${price})${r.description ? `: ${r.description}` : ''}`
    total += block.length
    if (total > MAX_PRODUCT_CHARS) break
    kept.push(block)
  }
  return { text: kept.join('\n'), count: kept.length }
}

async function loadDocContext(orgId: string, query: string): Promise<{ text: string; count: number }> {
  // Tài liệu bán hàng do công ty soạn — nguồn tri thức sản phẩm chính.
  const [docs, assets] = await Promise.all([
    retrieveProductDocs(orgId, query, 5).catch(() => []),
    retrieveDocAssets(orgId, query, 5).catch(() => []),
  ])
  let total = 0
  const kept: string[] = []
  for (const d of docs) {
    const media = [d.imageCount ? `${d.imageCount} ảnh` : '', d.videoCount ? `${d.videoCount} video` : '']
      .filter(Boolean).join(' · ')
    const block = `- [${d.productCode}] ${d.name ?? ''}${media ? ` (có ${media})` : ''}: ${d.description ?? ''}`
    total += block.length
    if (total > MAX_DOC_CHARS) break
    kept.push(block)
  }
  // Tài nguyên thư viện: chữ thì đưa vào, ảnh/video chỉ báo là CÓ để đề nghị gửi.
  for (const a of assets) {
    const body = a.textContent ?? a.description ?? ''
    const tag = a.sendable ? ' (gửi được cho khách)' : ''
    const block = `- [thư viện · ${a.kind}] ${a.title}${tag}: ${body}`
    total += block.length
    if (total > MAX_DOC_CHARS) break
    kept.push(block)
  }
  return { text: kept.join('\n'), count: kept.length }
}

function buildSystemPrompt(bot: { name: string; persona: string | null; playbook: string | null } | null): string {
  const base = [
    'Bạn là TRỢ LÝ AI NỘI BỘ, chỉ phục vụ NHÂN VIÊN của công ty tra cứu thông tin — không phải chatbot chăm sóc khách hàng.',
    'Trả lời ngắn gọn, đúng trọng tâm, bằng tiếng Việt.',
    'Chỉ dùng thông tin trong phần "Dữ liệu tham khảo" bên dưới (nếu có). Nếu không đủ dữ liệu để trả lời, nói rõ là chưa có thông tin — TUYỆT ĐỐI không bịa đặt.',
    'Đây là công cụ nội bộ: không soạn sẵn tin nhắn để gửi thẳng cho khách hàng, không thay mặt công ty cam kết điều gì với khách.',
  ]
  if (!bot) return base.join('\n')

  // Nhân viên chọn một Agent cụ thể (Đội AI) để hỏi — trả lời ĐÚNG theo persona/
  // playbook của Agent đó (như khi Agent này trả lời khách) nhưng vẫn giữ khung
  // an toàn ở trên: đây là hỏi đáp NỘI BỘ, không phải gửi thật cho khách.
  base.push(`Nhân viên đang chọn hỏi Agent "${bot.name}" — hãy trả lời theo đúng phong cách/kiến thức của Agent này:`)
  if (bot.persona) base.push(`[Tính cách & xưng hô của Agent]\n${bot.persona}`)
  if (bot.playbook) base.push(`[Kịch bản bán hàng của Agent]\n${bot.playbook}`)
  return base.join('\n\n')
}

function buildUserPrompt(
  message: string,
  history: AssistantTurn[],
  kb: { text: string; count: number },
  products: { text: string; count: number },
  docs: { text: string; count: number },
): string {
  const parts: string[] = []

  if (kb.count > 0 || products.count > 0 || docs.count > 0) {
    parts.push('### Dữ liệu tham khảo')
    if (products.count > 0) parts.push(`Sản phẩm liên quan:\n${products.text}`)
    if (docs.count > 0) parts.push(`Tài liệu bán hàng (do công ty soạn):\n${docs.text}`)
    if (kb.count > 0) parts.push(`Kiến thức công ty liên quan:\n${kb.text}`)
  }

  const recentHistory = history.slice(-MAX_HISTORY_TURNS)
  if (recentHistory.length > 0) {
    parts.push('### Lịch sử hỏi đáp gần đây')
    parts.push(
      recentHistory
        .map((t) => `${t.role === 'user' ? 'Nhân viên' : 'Trợ lý'}: ${t.text}`)
        .join('\n'),
    )
  }

  parts.push(`### Câu hỏi hiện tại\n${message}`)
  return parts.join('\n\n')
}

export async function askAssistant(input: {
  orgId: string
  userId: string
  message: string
  botId?: string | null
  history?: AssistantTurn[]
}): Promise<AskAssistantResult> {
  const message = input.message.trim()
  if (!message) throw new Error('message is required')

  const cfg = await getAiConfig(input.orgId)
  if (!cfg.enabled) throw new Error('AI is disabled for this organization')
  await ensureQuota(input.orgId, cfg.maxDaily)

  // Agent do nhân viên chọn ở màn chat (Đội AI) — chỉ ghi đè provider/model/
  // persona/playbook của bot đó, phần còn lại rơi về mặc định tổ chức, giống
  // hệt cách harness trả lời khách áp dụng bot override (reply-generator.ts).
  const bot = input.botId ? await resolveBotById(input.orgId, input.botId).catch(() => null) : null

  // Trợ lý nội bộ dùng chung hạn mức với tác vụ soạn gợi ý trả lời — không cần
  // thêm một task type riêng chỉ để chọn model.
  const baseCfg = getEffectiveConfigForTask(cfg, 'reply_draft')
  const provider = bot?.provider || baseCfg.provider
  const model = bot?.model || baseCfg.model
  const apiKey = await getProviderApiKey(input.orgId, provider)
  if (!apiKey) throw new Error(`AI provider key for "${provider}" is not configured`)

  const [kb, products, docs] = await Promise.all([
    loadKbContext(input.orgId, message),
    loadProductContext(input.orgId, message),
    loadDocContext(input.orgId, message),
  ])

  const budgets = getContextBudgets(model)
  const system = buildSystemPrompt(
    bot
      ? {
          name: bot.name,
          persona: bot.personaPrompt ? truncate(bot.personaPrompt, budgets.persona) : null,
          playbook: bot.playbookPrompt ? truncate(bot.playbookPrompt, budgets.playbook) : null,
        }
      : null,
  )
  const userPrompt = buildUserPrompt(message, input.history ?? [], kb, products, docs)

  const raw = await dispatchProvider(provider, apiKey, model, system, userPrompt, { maxTokens: 900 })

  await logUsage({
    orgId: input.orgId,
    provider,
    model,
    type: 'assistant_qa',
    feature: 'internal_assistant',
    raw,
  })

  return { reply: raw.text, usedSources: { kb: kb.count, products: products.count, docs: docs.count } }
}
