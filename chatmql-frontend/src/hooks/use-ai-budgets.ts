/**
 * use-ai-budgets.ts — Ngân sách ký tự của prompt AI (GET /ai/context-budgets).
 *
 * Backend cắt tài liệu train (persona/playbook/tài liệu logic...) theo ngân sách
 * ký tự phụ thuộc model sinh trả lời (bậc base/large). Hook này cho editor hiện
 * bộ đếm + cảnh báo "phần vượt sẽ BỊ CẮT" để người soạn không bị cắt ngầm.
 *
 * File riêng (không đụng use-ai.ts) — chỉ dùng lại api client + useApiQuery.
 */
import { useApiQuery } from '@/hooks/use-api'

export interface ContextBudgets {
  l0Total: number
  persona: number
  playbook: number
  index: number
  l0bScenarios: number
  l1Kb: number
  l2Contact: number
  l3Memory: number
  l5Messages: number
  l6Turn: number
  products: number
}

export interface ContextBudgetsResponse {
  budgets: ContextBudgets
  tier: 'base' | 'large'
  model: string | null
}

export function useContextBudgets() {
  return useApiQuery<ContextBudgetsResponse>(
    ['ai', 'context-budgets'],
    '/ai/context-budgets',
    undefined,
    // Ngân sách chỉ đổi khi đổi model/env — cache lâu, không cần refetch liên tục.
    { staleTime: 30 * 60 * 1000 },
  )
}

/**
 * Ngân sách cho MỘT tài liệu logic theo type — khớp đúng cách backend cắt
 * (context-assembler.ts): persona → budgets.persona; playbook và criteria cùng
 * mức l0Total/2 → budgets.playbook; các doc còn lại (index/handoff_rules/
 * mechanism) → budgets.index.
 */
export function budgetForDocType(b: ContextBudgets, docType: string): number {
  if (docType === 'persona') return b.persona
  if (docType === 'playbook' || docType === 'criteria') return b.playbook
  return b.index
}

/**
 * Chuỗi bộ đếm dưới textarea: "X / Y ký tự vào prompt"; vượt ngân sách →
 * over=true để tô text-destructive, kèm cảnh báo phần vượt sẽ bị cắt.
 * `shared=true` cho ngân sách DÙNG CHUNG nhiều tài liệu (KB, kịch bản) —
 * wording trung thực: nêu tổng ngân sách thay vì giả vờ là hạn mức riêng.
 */
export function budgetCounterText(
  length: number,
  limit: number,
  opts: { shared?: boolean; sharedLabel?: string } = {},
): { text: string; over: boolean } {
  const nf = (n: number) => n.toLocaleString('vi-VN')
  if (opts.shared) {
    const label = opts.sharedLabel ?? 'Tổng nội dung vào prompt'
    return length > limit
      ? { over: true, text: `${nf(length)} ký tự — ${label} tối đa ${nf(limit)} ký tự, phần vượt sẽ BỊ CẮT khi đưa vào prompt` }
      : { over: false, text: `${nf(length)} ký tự · ${label} tối đa ${nf(limit)} ký tự` }
  }
  return length > limit
    ? { over: true, text: `${nf(length)} / ${nf(limit)} ký tự — Vượt ${nf(length - limit)} ký tự — phần vượt sẽ BỊ CẮT khi đưa vào prompt` }
    : { over: false, text: `${nf(length)} / ${nf(limit)} ký tự vào prompt` }
}
