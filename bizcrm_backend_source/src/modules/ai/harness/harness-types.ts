/**
 * harness-types.ts — Shared type definitions for the AI auto-reply harness (M1).
 * Two-pass engine: router (pass 1) → generator (pass 2).
 */

/** L0 logic documents assembled from AiLogicDoc rows. */
export interface LogicContext {
  index: string | null
  persona: string | null
  playbook: string | null
  handoff_rules: string | null
  mechanism: string | null
  criteria: string | null
}

/** Contact fact sheet for L2. */
export interface ContactProfile {
  fullName: string
  lifecycleStage: string | null
  leadScore: number | null
  aiSentimentLabel: string | null
  aiIntent: string | null
  tags: string[]
  /** Compact summary of known pain points / interests (optional). */
  aiSummary: string | null
}

/** KB snippet from L1 RAG retrieval. */
export interface KbSnippet {
  id: string
  title: string
  content: string
  type: string
  /** Cosine similarity 0..1 for semantic hits; null for keyword-only matches. */
  score?: number | null
}

/**
 * L1c — tài liệu bán hàng do ChatMQL soạn cho một mã sản phẩm (ảnh/mô tả/video).
 * Nguồn tri thức sản phẩm CHÍNH sau khi bảng products nội bộ ngừng dùng.
 */
export interface ProductDocSnippet {
  productCode: string
  name: string | null
  description: string | null
  imageCount: number
  videoCount: number
}

/** L1b — product retrieved via semantic search, injected for accurate sales/quote replies. */
export interface ProductSnippet {
  id: string
  name: string
  price: number | null
  priceMax: number | null
  priceType: string // fixed | range | contact | free | description
  currency: string
  description: string | null
  /** Cosine similarity 0..1 for semantic hits; null for keyword-only matches. */
  score?: number | null
}

/** Thread memory fact from L3 injection. */
export interface MemoryFact {
  id: string
  kind: string
  content: string
}

/**
 * L0b — a modular logic SCENARIO (skill). `always` scenarios are loaded every
 * turn; `auto` scenarios are loaded only when semantically relevant to the turn
 * (selection reuses the RAG threshold). `score` is the relevance for auto hits.
 */
export interface ScenarioSnippet {
  id: string
  name: string
  content: string
  loadMode: 'always' | 'auto'
  score?: number | null
}

/** Full context assembled by context-assembler.ts, passed to each LLM pass. */
export interface HarnessContext {
  orgId: string
  convId: string
  /** L0 — logic docs */
  logic: LogicContext
  /** L0b — modular logic scenarios (always-loaded + relevant auto-loaded). */
  scenarios: ScenarioSnippet[]
  /** L1 — KB RAG snippets (keyword retrieval; empty if no query or no matches). */
  kbSnippets: KbSnippet[]
  /** L1b — product RAG snippets (semantic; empty if none). */
  products: ProductSnippet[]
  /** L1c — tài liệu bán hàng theo mã sản phẩm. */
  productDocs: ProductDocSnippet[]
  /** L2 — contact fact sheet (null if no contact yet). */
  contact: ContactProfile | null
  /** L3 — thread/contact memory facts (active facts for this contact). */
  threadMemory: MemoryFact[]
  /** L3b — recent staff notes for this contact/conversation (bounded). */
  staffNotes?: StaffNoteSnippet[]
  /** L5 — recent conversation transcript (bounded). */
  recentMessages: Array<{ role: 'customer' | 'agent'; text: string }>
  /** L6 — the current customer turn (debounced). */
  turnText: string
}

/** Staff note snippet from internal CRM notes. */
export interface StaffNoteSnippet {
  content: string
  status?: string | null
  createdAt?: string | null
}

/**
 * Decision returned by the router (pass 1).
 * Structured-action fallback (M1): router returns JSON — native tool-calling is M2.
 */
export interface RouterDecision {
  shouldReply: boolean
  intents?: string[]
  /** RAG query for KB retrieval (M3 — seam only). */
  ragQuery?: string
  /** Whether the router believes KB retrieval would improve quality. */
  needsKnowledge?: boolean
  /** Handoff decision (structured-action — tool-calling in M2). */
  handoff?: {
    should: boolean
    reason?: string
  }
}

/** Result returned by runHarness. */
/** Ảnh sản phẩm AI muốn gửi kèm câu trả lời. */
export interface ReplyImage {
  productId: string
  productName: string
  /** URL do máy chủ phân giải từ catalog — không phải do mô hình sinh ra. */
  imageUrl: string
  caption?: string
}

export interface HarnessResult {
  /** Generated reply text, or null (no reply / handoff / skipped). */
  reply: string | null
  handoff?: { should: boolean; reason?: string }
  routerDecision: RouterDecision
  /** AiReplyRun row id for linking AiUsage rows. */
  runId: string
  /** Ảnh gửi kèm; orchestrator gửi sau khi phần chữ đã ra kênh. */
  images?: ReplyImage[]
  /**
   * Lỗi HẠ TẦNG (router chết, model lỗi, hết quota, trả lời rỗng…). Khác với
   * "AI quyết định không trả lời" — cái đó reply=null nhưng KHÔNG có error.
   * Orchestrator dựa vào trường này để không tiến con trỏ và chuyển người.
   */
  error?: string
}

/** Tuỳ chọn cho một lượt chạy harness. */
export interface HarnessOptions {
  /** Huỷ mọi lệnh gọi model khi hết ngân sách thời gian của lượt. */
  signal?: AbortSignal
  /** Chỉ lấy lịch sử TRƯỚC mốc này — tránh tin đang xử lý xuất hiện 2 lần. */
  historyBefore?: Date
  /** Ép dùng một Agent cụ thể thay vì bot gán theo kênh (trình mô phỏng / demo theo bot). */
  forceBotId?: string
}
