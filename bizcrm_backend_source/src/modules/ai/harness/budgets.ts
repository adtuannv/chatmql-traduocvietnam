/**
 * budgets.ts — Ngân sách ký tự cho từng lớp ngữ cảnh (HarnessContext), THEO MODEL.
 *
 * Vì sao có 2 bậc (tier)?
 *   - `base`: model context nhỏ / chi phí token đắt → giữ đúng các con số cũ
 *     để kiểm soát chi phí và không tràn context window.
 *   - `large`: model long-context (GPT-4o/4.1/5, o3/o4, Claude, Gemini, MiniMax,
 *     DeepSeek, Qwen...) chịu được prompt dài với chi phí chấp nhận được →
 *     nới ngân sách ~4× để KHÔNG cắt xén tài liệu train (persona, playbook,
 *     tài liệu logic) — cắt ngầm làm AI "quên" phần huấn luyện mà người soạn
 *     không hề hay biết.
 *
 * Người soạn tài liệu xem được ngân sách hiệu lực qua GET /api/v1/ai/context-budgets
 * (FE hiển thị bộ đếm ký tự + cảnh báo vượt ngân sách ngay trong editor).
 */

export interface ContextBudgets {
  /** L0 — tổng tài liệu logic (chỉ để tham chiếu/hiển thị; từng doc dùng các field dưới) */
  l0Total: number
  /** L0 — tài liệu persona (và personaPrompt riêng của bot) */
  persona: number
  /** L0 — tài liệu playbook (và playbookPrompt riêng của bot); criteria dùng chung mức này */
  playbook: number
  /** L0 — các doc còn lại: index, handoff_rules, mechanism (mỗi doc) */
  index: number
  /** L0b — tổng kịch bản (scenario) nạp vào một lượt */
  l0bScenarios: number
  /** L1 — tổng snippet tri thức (KB RAG) */
  l1Kb: number
  /** L2 — hồ sơ khách hàng (aiSummary) */
  l2Contact: number
  /** L3 — tổng ghi nhớ hội thoại (memory facts) */
  l3Memory: number
  /** L3b — ghi chú nhân viên gắn vào hội thoại/khách */
  l3bStaffNotes: number
  /** L5 — tổng tin nhắn gần đây */
  l5Messages: number
  /** L6 — tin nhắn của lượt hiện tại */
  l6Turn: number
  /** L1b — tổng snippet sản phẩm (product RAG) */
  products: number
}

// Bậc `base` = GIỮ NGUYÊN các con số cứng trước đây trong context-assembler.ts
// (đổi số ở đây là đổi hành vi cắt prompt cho model nhỏ — cân nhắc chi phí).
const BASE_BUDGETS: ContextBudgets = {
  l0Total: 2_000,
  persona: 500,      // = l0Total / 4
  playbook: 1_000,   // = l0Total / 2
  index: 500,        // = l0Total / 4 (mỗi doc index/handoff_rules/mechanism)
  l0bScenarios: 2_500,
  l1Kb: 2_000,
  l2Contact: 800,
  l3Memory: 800,
  l3bStaffNotes: 800,
  l5Messages: 4_000,
  l6Turn: 1_000,
  products: 1_500,
}

// Bậc `large` ≈ 4× base: model long-context không cần "cắt cụt" tài liệu train.
const LARGE_BUDGETS: ContextBudgets = {
  l0Total: 8_000,
  persona: 8_000,
  playbook: 8_000,
  index: 1_000,
  l0bScenarios: 6_000,
  l1Kb: 6_000,
  l2Contact: 1_600,
  l3Memory: 1_600,
  l3bStaffNotes: 1_600,
  l5Messages: 10_000,
  l6Turn: 2_000,
  products: 4_000,
}

export type BudgetTier = 'base' | 'large'

// Các họ model long-context đã biết (so khớp substring, không phân biệt hoa thường).
const LONG_CONTEXT_FAMILIES = [
  'gpt-4o', 'gpt-4.1', 'gpt-5', 'o3', 'o4',
  'claude', 'gemini', 'minimax', 'deepseek', 'qwen',
]

/**
 * Chọn bậc ngân sách cho model. Env AI_CONTEXT_BUDGET_TIER=base|large thắng
 * mọi auto-detect (dùng khi vận hành muốn ép một bậc cho toàn hệ thống).
 */
export function resolveBudgetTier(model?: string | null): BudgetTier {
  // Đọc process.env trực tiếp (như các chỗ đọc env khác trong codebase) —
  // không qua config.ts để tránh đụng file dùng chung.
  const forced = (process.env.AI_CONTEXT_BUDGET_TIER ?? '').trim().toLowerCase()
  if (forced === 'base' || forced === 'large') return forced

  const m = (model ?? '').toLowerCase()
  if (m && LONG_CONTEXT_FAMILIES.some((f) => m.includes(f))) return 'large'
  return 'base'
}

/** Ngân sách hiệu lực cho model (null/unknown → bậc `base` an toàn chi phí). */
export function getContextBudgets(model?: string | null): ContextBudgets {
  return resolveBudgetTier(model) === 'large' ? { ...LARGE_BUDGETS } : { ...BASE_BUDGETS }
}

/** Cắt chuỗi theo ngân sách, thêm '…' khi bị cắt (dùng chung cho mọi lớp). */
export function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s
  return s.slice(0, maxChars) + '…'
}
