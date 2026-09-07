/**
 * use-ai-improve.ts — Học từ lịch sử tin nhắn + đề xuất cải thiện prompt chờ duyệt.
 *
 * Backend đã có sẵn hai nhóm route (learn-history-routes.ts, master-routes.ts)
 * nhưng bản eCDP gốc không có màn hình nào gọi tới — hook này phục vụ trang
 * "Cải thiện AI" (`/ai/improve`). Toàn bộ thao tác đều giới hạn owner/admin
 * phía backend; giao diện chỉ là lớp trải nghiệm.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

// ── Kiểu dữ liệu (bám AiLogicProposal trong prisma/schema.prisma) ────

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied'

export interface LogicProposal {
  id: string
  source: string // feedback | consolidation | master_session | learn_history | learn_history_file
  targetType: string // logic_doc | knowledge_entry | thread_memory | prompt_version
  targetSubtype?: string | null // persona | playbook | handoff_rules | index
  targetId?: string | null
  currentValue?: string | null
  proposedValue: string
  rationale: string
  status: ProposalStatus
  createdByAi: boolean
  reviewedBy?: string | null
  appliedRef?: string | null
  createdAt: string
}

export interface LearnChannel {
  id: string
  name: string | null
  conversations: number
}

export interface LearnResult {
  success: boolean
  proposalId: string
  rationale: string
  sampled: number
  considered?: number
  status: 'pending'
}

// ── Nhãn tiếng Việt ─────────────────────────────────────────────────

export const PROPOSAL_SOURCE_LABELS: Record<string, string> = {
  feedback: 'Từ phản hồi nhân viên',
  consolidation: 'Gộp phản hồi định kỳ',
  master_session: 'Phiên AI Master',
  learn_history: 'Học từ lịch sử tin nhắn',
  learn_history_file: 'Học từ tệp chat',
}

export const PROPOSAL_TARGET_LABELS: Record<string, string> = {
  logic_doc: 'Tài liệu logic',
  knowledge_entry: 'Kho tri thức',
  thread_memory: 'Trí nhớ hội thoại',
  prompt_version: 'Prompt',
}

export const PROPOSAL_SUBTYPE_LABELS: Record<string, string> = {
  persona: 'Persona',
  playbook: 'Playbook',
  handoff_rules: 'Luật chuyển nhân viên',
  index: 'Mục lục',
  criteria: 'Tiêu chí',
}

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Đã từ chối',
  applied: 'Đã áp dụng',
}

export const improveKeys = {
  proposals: (status?: string) => ['ai', 'improve', 'proposals', status ?? 'all'] as const,
  channels: ['ai', 'improve', 'channels'] as const,
}

// ── Đề xuất chờ duyệt ───────────────────────────────────────────────

export function useLogicProposals(status?: ProposalStatus) {
  return useQuery({
    queryKey: improveKeys.proposals(status),
    queryFn: async () =>
      (await api.get<{ items: LogicProposal[] }>('/ai/master/proposals', {
        params: { status, limit: 100 },
      })).data,
  })
}

export function useApplyProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/ai/master/proposals/${id}/apply`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai', 'improve', 'proposals'] })
      // Áp dụng đề xuất thay đổi tài liệu logic → các màn đang hiển thị tài liệu phải tải lại.
      qc.invalidateQueries({ queryKey: ['ai'] })
    },
  })
}

export function useRejectProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/ai/master/proposals/${id}/reject`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'improve', 'proposals'] }),
  })
}

// ── Học từ lịch sử ──────────────────────────────────────────────────

export function useLearnChannels() {
  return useQuery({
    queryKey: improveKeys.channels,
    queryFn: async () => (await api.get<{ channels: LearnChannel[] }>('/ai/learn-history/channels')).data,
    staleTime: 60_000,
  })
}

/** Phân tích hội thoại trong hệ thống (chọn kênh, số ngày, ưu tiên hội thoại có đơn). */
export function useAnalyzeHistory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { channelId?: string; days: number; preferOrders: boolean }) =>
      (await api.post<LearnResult>('/ai/learn-history/analyze', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'improve', 'proposals'] }),
  })
}

/** Phân tích tệp xuất chat đầy đủ (.txt / .json). Bẫy đã ghi nhận: multipart phải đặt header. */
export function useAnalyzeHistoryFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return (
        await api.post<LearnResult>('/ai/learn-history/analyze-file', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      ).data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'improve', 'proposals'] }),
  })
}
