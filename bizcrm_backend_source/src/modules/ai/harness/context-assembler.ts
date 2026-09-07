/**
 * context-assembler.ts — Builds a HarnessContext for a conversation turn.
 *
 * Layers:
 *   L0  AiLogicDoc markdown (persona, playbook, handoff_rules, etc.)
 *   L1  KB RAG snippets — keyword retrieval (M3; embeddings deferred to M4)
 *   L2  Contact fact sheet (compact — no raw DB rows in prompt)
 *   L3  Thread/contact memory facts (M3)
 *   L5  Recent ~12 messages (bounded 4 000 chars)
 *   L6  Current turn text
 *
 * Each layer is char-capped to keep total input within model budget.
 */
import { prisma } from '../../../shared/prisma-client.js'
import { getActiveLogicContext } from '../logic-doc-service.js'
import { getAlwaysScenarios, retrieveRelevantScenarios } from '../scenario-service.js'
import { retrieveKb } from '../../knowledge/kb-service.js'
import { retrieveKbSemantic } from '../../knowledge/embedding-service.js'
import { retrieveProductSemantic } from '../../products/product-embedding.js'
import { retrieveProductDocs } from '../../product-docs/product-docs-service.js'
import { getThreadMemory } from '../../knowledge/memory-service.js'
import { getToolsConfig, type ToolsConfig, type ToolConfig } from '../tools-config-service.js'
import type { HarnessContext, ContactProfile, KbSnippet, ProductSnippet, ProductDocSnippet, MemoryFact, ScenarioSnippet, StaffNoteSnippet } from './harness-types.js'
import { recordStep } from '../observability/trace-recorder.js'
// Ngân sách ký tự theo model (base/large) — xem budgets.ts vì sao có 2 bậc.
// Thay cho các hằng BUDGET_L*_CHARS cứng trước đây; bậc `base` giữ đúng các số cũ.
import { getContextBudgets, truncate, type ContextBudgets } from './budgets.js'

// Default KB retrieval topK (overridden by AiConfig.ragTopK when available)
const DEFAULT_RAG_TOP_K = 5

// ── Resolve conversation meta (contactId, ragTopK) ────────────────────────────

async function loadConvMeta(
  orgId: string,
  convId: string,
): Promise<{ contactId: string | null; ragTopK: number }> {
  const conv = await prisma.conversation.findFirst({
    where: { id: convId, orgId }, // org-scoped (defense-in-depth against cross-tenant)
    select: { contactId: true },
  })
  const config = await prisma.aiConfig.findUnique({
    where: { orgId },
    select: { ragTopK: true },
  })
  return {
    contactId: conv?.contactId ?? null,
    ragTopK: config?.ragTopK ?? DEFAULT_RAG_TOP_K,
  }
}

// ── L2: Contact fact sheet ────────────────────────────────────────────────────

async function loadContactProfile(contactId: string): Promise<ContactProfile | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      fullName: true,
      lifecycleStage: true,
      leadScore: true,
      aiSentimentLabel: true,
      aiIntent: true,
      aiSummary: true,
      tags: true,
    },
  })
  if (!contact) return null

  return {
    fullName: contact.fullName ?? 'Unknown',
    lifecycleStage: contact.lifecycleStage ?? null,
    leadScore: contact.leadScore ?? null,
    aiSentimentLabel: contact.aiSentimentLabel ?? null,
    aiIntent: contact.aiIntent ?? null,
    aiSummary: contact.aiSummary ? truncate(contact.aiSummary, 400) : null,
    tags: Array.isArray(contact.tags) ? (contact.tags as string[]) : [],
  }
}

// ── L3: Thread memory ─────────────────────────────────────────────────────────

async function loadThreadMemory(orgId: string, contactId: string, maxChars: number): Promise<MemoryFact[]> {
  const facts = await getThreadMemory(orgId, contactId)

  // Cap total chars across all facts
  let total = 0
  const kept: MemoryFact[] = []
  for (const f of facts) {
    total += f.content.length
    if (total > maxChars) break
    kept.push({ id: f.id, kind: f.kind, content: f.content })
  }
  return kept
}

// ── L3b: Staff notes (CRM internal notes) ────────────────────────────────────

async function loadStaffNotes(orgId: string, convId: string, contactId: string | null | undefined, maxChars: number): Promise<StaffNoteSnippet[]> {
  try {
    const notes = await prisma.note.findMany({
      where: {
        orgId,
        OR: [
          { conversationId: convId },
          ...(contactId ? [{ contactId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { content: true, status: true, createdAt: true },
    })

    let total = 0
    const kept: StaffNoteSnippet[] = []
    for (const n of notes) {
      const text = n.content.trim()
      if (!text) continue
      total += text.length
      if (total > maxChars) break
      kept.push({
        content: text,
        status: n.status,
        createdAt: n.createdAt ? n.createdAt.toISOString() : null,
      })
    }
    return kept
  } catch {
    return []
  }
}

// ── L1: KB RAG (semantic with keyword fallback) ───────────────────────────────

async function loadKbSnippets(
  orgId: string,
  query: string,
  topK: number,
  tools: ToolsConfig,
  maxChars: number,
  minScore?: number,
): Promise<KbSnippet[]> {
  // One knowledge tool (search_knowledge) searches ALL KB formats (FAQ + articles).
  const jobs: Promise<KbSnippet[]>[] = []
  if (tools.search_knowledge.enabled) {
    const ids = tools.search_knowledge.guardrail.categoryIds
    const fb = (o: string, q: string, k: number) => retrieveKb(o, q, k, { categoryIds: ids })
    jobs.push(retrieveKbSemantic(orgId, query, topK, fb, { categoryIds: ids, minScore }))
  }
  if (jobs.length === 0) return []

  // Merge + dedupe by id, then cap total chars.
  const seen = new Set<string>()
  const merged: KbSnippet[] = []
  for (const s of (await Promise.all(jobs)).flat()) {
    if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) }
  }
  let total = 0
  const kept: KbSnippet[] = []
  for (const s of merged) {
    total += s.title.length + s.content.length + 5
    if (total > maxChars) break
    kept.push(s)
  }
  return kept
}

// ── L0b: Scenarios (modular logic skills) ─────────────────────────────────────

/**
 * Always-on scenarios + the auto scenarios semantically relevant to this turn,
 * merged (dedupe by id) and char-capped. Loaded in BOTH pipeline and agent mode
 * — scenarios are logic, not data RAG, so they apply regardless of skipRag.
 */
async function loadScenarios(orgId: string, turnText: string, topK: number, maxChars: number, minScore?: number): Promise<ScenarioSnippet[]> {
  const [always, relevant] = await Promise.all([
    getAlwaysScenarios(orgId),
    retrieveRelevantScenarios(orgId, turnText, topK, minScore),
  ])
  const seen = new Set<string>()
  let total = 0
  const kept: ScenarioSnippet[] = []
  for (const s of [...always, ...relevant]) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    total += s.name.length + s.content.length + 5
    if (total > maxChars) break
    kept.push(s)
  }
  return kept
}

// ── L1b: Product RAG (semantic) ───────────────────────────────────────────────

async function loadProductSnippets(orgId: string, query: string, topK: number, tool: ToolConfig, maxChars: number, minScore?: number): Promise<ProductSnippet[]> {
  if (!tool.enabled) return []
  const rows = await retrieveProductSemantic(orgId, query, topK, { categoryIds: tool.guardrail.categoryIds, minScore })
  let total = 0
  const kept: ProductSnippet[] = []
  for (const r of rows) {
    const size = r.name.length + (r.description?.length ?? 0) + 20
    total += size
    if (total > maxChars) break
    kept.push({
      id: r.id, name: r.name, price: r.price, priceMax: r.priceMax, priceType: r.priceType,
      currency: r.currency, description: r.description, score: r.score ?? null,
    })
  }
  return kept
}

// ── L5: Recent messages ────────────────────────────────────────────────────────

async function loadRecentMessages(
  convId: string,
  maxChars: number,
  before?: Date,
): Promise<Array<{ role: 'customer' | 'agent'; text: string }>> {
  // `before` = mốc của tin đầu tiên trong lượt đang xử lý. Không lọc thì tin
  // khách vừa gửi nằm cả trong "Conversation History" lẫn khối CUSTOMER —
  // model thấy hai lần, dễ trả lời lại câu cũ.
  const rows = await prisma.message.findMany({
    where: {
      conversationId: convId, isDeleted: false, contentType: 'text',
      ...(before ? { sentAt: { lt: before } } : {}),
    },
    orderBy: { sentAt: 'desc' },
    take: 12,
    select: { senderType: true, content: true },
  })

  // Reverse to chronological order
  const msgs = rows.reverse().map((m) => ({
    role: (m.senderType === 'contact' ? 'customer' : 'agent') as 'customer' | 'agent',
    text: (m.content ?? '').trim(),
  })).filter((m) => m.text.length > 0)

  // Apply char budget: walk backwards until budget exceeded
  let total = 0
  const kept: Array<{ role: 'customer' | 'agent'; text: string }> = []
  for (let i = msgs.length - 1; i >= 0; i--) {
    total += msgs[i].text.length
    if (total > maxChars) break
    kept.unshift(msgs[i])
  }
  return kept
}

// ── Public assembler ──────────────────────────────────────────────────────────

export async function assembleContext(
  orgId: string,
  convId: string,
  turnText: string,
  aiReplyRunId?: string,
  opts: { skipRag?: boolean; minScore?: number; budgets?: ContextBudgets; historyBefore?: Date } = {},
): Promise<HarnessContext> {
  // Ngân sách ký tự theo model sinh trả lời — caller (reply-generator) truyền
  // budgets khớp model thực dùng; không truyền → bậc `base` an toàn chi phí.
  const budgets = opts.budgets ?? getContextBudgets(null)

  // Resolve conversation meta + the per-function tool config (enable + guardrail).
  const [{ contactId, ragTopK }, tools] = await Promise.all([
    loadConvMeta(orgId, convId),
    getToolsConfig(orgId),
  ])

  // In agent mode (skipRag) the generator fetches KB/products via tool calls,
  // so we don't pre-fetch them here (avoids double retrieval).
  // Parallelize all layer loads (each KB/product tool gated by its own config)
  const [logic, scenarios, contact, threadMemory, staffNotes, kbSnippets, products, productDocs, recentMessages] = await Promise.all([
    getActiveLogicContext(orgId),                                                          // L0
    loadScenarios(orgId, turnText, ragTopK, budgets.l0bScenarios, opts.minScore),          // L0b
    contactId ? loadContactProfile(contactId) : Promise.resolve(null),                    // L2
    contactId ? loadThreadMemory(orgId, contactId, budgets.l3Memory) : Promise.resolve([]), // L3
    loadStaffNotes(orgId, convId, contactId, budgets.l3bStaffNotes),                        // L3b
    opts.skipRag ? Promise.resolve([] as KbSnippet[]) : loadKbSnippets(orgId, turnText, ragTopK, tools, budgets.l1Kb, opts.minScore),          // L1
    opts.skipRag ? Promise.resolve([] as ProductSnippet[]) : loadProductSnippets(orgId, turnText, ragTopK, tools.search_products, budgets.products, opts.minScore), // L1b
    // L1c — tài liệu bán hàng theo mã SP. Nạp cả ở chế độ agent: đây là tri thức
    // ChatMQL tự soạn, không nằm trong công cụ tra cứu nào của mô hình.
    retrieveProductDocs(orgId, turnText, 5).catch(() => [] as ProductDocSnippet[]),          // L1c
    loadRecentMessages(convId, budgets.l5Messages, opts.historyBefore),                     // L5
  ])

  // Char-cap L0 docs individually so no single doc dominates.
  // Tỷ lệ giữ như trước: persona/index/handoff/mechanism = l0Total/4 → budgets.index|persona,
  // playbook/criteria = l0Total/2 → budgets.playbook (criteria dùng chung mức playbook).
  const cappedLogic = {
    index: logic.index ? truncate(logic.index, budgets.index) : null,
    persona: logic.persona ? truncate(logic.persona, budgets.persona) : null,
    playbook: logic.playbook ? truncate(logic.playbook, budgets.playbook) : null,
    handoff_rules: logic.handoff_rules ? truncate(logic.handoff_rules, budgets.index) : null,
    mechanism: logic.mechanism ? truncate(logic.mechanism, budgets.index) : null,
    criteria: logic.criteria ? truncate(logic.criteria, budgets.playbook) : null,
  }

  // Cap contact profile summary
  if (contact?.aiSummary) {
    contact.aiSummary = truncate(contact.aiSummary, budgets.l2Contact)
  }

  const assembled: HarnessContext = {
    orgId,
    convId,
    logic: cappedLogic,
    scenarios,
    kbSnippets,
    products,
    productDocs,
    contact,
    threadMemory,
    staffNotes,
    recentMessages,
    turnText: truncate(turnText, budgets.l6Turn),
  }

  // Fire-and-forget trace — MUST NOT block caller
  recordStep({
    orgId,
    conversationId: convId,
    aiReplyRunId,
    step: 'assemble',
    payload: {
      // ── Nội dung AI thực sự "nhìn thấy" (để hiểu AI dựa vào gì) ──
      tin_khach: assembled.turnText,
      hoi_thoai_gan: recentMessages.map((m) => `${m.role === 'customer' ? 'Khách' : 'NV/AI'}: ${m.text}`),
      khach_hang: contact
        ? { ten: contact.fullName, giai_doan: contact.lifecycleStage, cam_xuc: contact.aiSentimentLabel, y_dinh: contact.aiIntent, tags: contact.tags }
        : null,
      tri_thuc_KB_dung: kbSnippets.map((s) => ({ tieu_de: s.title, diem: s.score ?? null })),
      san_pham_dung: products.map((p) => ({ ten: p.name, diem: p.score ?? null })),
      tai_lieu_ban_hang_dung: productDocs.map((d) => ({ ma: d.productCode, ten: d.name })),
      // ── Công cụ (function) đang bật + guardrail từng cái ([] = không giới hạn) ──
      cong_cu: {
        search_products: { bat: tools.search_products.enabled, gioi_han_danh_muc: tools.search_products.guardrail.categoryIds },
        search_knowledge: { bat: tools.search_knowledge.enabled, gioi_han_danh_muc: tools.search_knowledge.guardrail.categoryIds },
      },
      ghi_nho_khach: threadMemory.map((f) => f.content),
      ghi_chu_nhan_vien: staffNotes?.map((n) => n.content) ?? [],
      logic_ap_dung: {
        persona: cappedLogic.persona ?? null,
        playbook: cappedLogic.playbook ?? null,
        handoff_rules: cappedLogic.handoff_rules ?? null,
        criteria: cappedLogic.criteria ?? null,
      },
      // ── Kịch bản (skill) đang áp dụng: always + auto khớp ngữ cảnh ──
      kich_ban_ap_dung: scenarios.map((s) => ({ ten: s.name, che_do: s.loadMode, do_lien_quan: s.score })),
      // ── Kích thước từng lớp (debug) ──
      _sizes: {
        L0_logic: {
          index: cappedLogic.index?.length ?? 0,
          persona: cappedLogic.persona?.length ?? 0,
          playbook: cappedLogic.playbook?.length ?? 0,
          handoff_rules: cappedLogic.handoff_rules?.length ?? 0,
          mechanism: cappedLogic.mechanism?.length ?? 0,
        },
        L0b_scenarios: scenarios.length,
        L1_kb: kbSnippets.length,
        L1b_products: products.length,
        L3_memory: threadMemory.length,
        L5_messages: recentMessages.length,
        L6_turn_chars: assembled.turnText.length,
      },
    },
  })

  return assembled
}
