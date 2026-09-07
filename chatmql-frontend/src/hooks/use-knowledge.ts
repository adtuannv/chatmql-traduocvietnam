import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { BadgeProps } from '@/components/ui/badge'

interface Envelope<T> {
  success: boolean
  data: T
}

// ── Nhãn tiếng Việt & hằng số ────────────────────────────────────────
// type: faq | description | policy | price | commitment | fact
export const KB_TYPES = ['faq', 'description', 'policy', 'price', 'commitment', 'fact'] as const
export type KbType = (typeof KB_TYPES)[number]

export const KB_TYPE_LABELS: Record<string, string> = {
  faq: 'Câu hỏi thường gặp',
  description: 'Mô tả / Giới thiệu',
  policy: 'Chính sách',
  price: 'Giá / Báo giá',
  commitment: 'Cam kết',
  fact: 'Thông tin',
}

// format: qa | article
export const KB_FORMATS = ['article', 'qa'] as const
export type KbFormat = (typeof KB_FORMATS)[number]

export const KB_FORMAT_LABELS: Record<string, string> = {
  article: 'Bài viết',
  qa: 'Hỏi - Đáp',
}

// risk: low | sensitive
export const KB_RISKS = ['low', 'sensitive'] as const
export type KbRisk = (typeof KB_RISKS)[number]

export const KB_RISK_LABELS: Record<string, string> = {
  low: 'Thông thường',
  sensitive: 'Nhạy cảm (cần duyệt)',
}

// status: active | pending | rejected | archived
export const KB_STATUS_LABELS: Record<string, string> = {
  active: 'Đang dùng',
  pending: 'Chờ duyệt',
  rejected: 'Từ chối',
  archived: 'Lưu trữ',
}

export function kbStatusVariant(status?: string | null): BadgeProps['variant'] {
  switch (status) {
    case 'active':
      return 'success'
    case 'pending':
      return 'warning'
    case 'rejected':
      return 'destructive'
    case 'archived':
      return 'outline'
    default:
      return 'secondary'
  }
}

// kind danh mục KB: knowledge | faq
export const KB_CATEGORY_KINDS = ['knowledge', 'faq'] as const
export type KbCategoryKind = (typeof KB_CATEGORY_KINDS)[number]

export const KB_CATEGORY_KIND_LABELS: Record<string, string> = {
  knowledge: 'Kiến thức (bài viết)',
  faq: 'Hỏi - Đáp (FAQ)',
}

/** Nhãn hiển thị cho entry: FAQ dùng title, bài viết lấy dòng đầu content. */
export function kbLabel(entry: Pick<KnowledgeEntry, 'title' | 'content'>): string {
  const t = entry.title?.trim()
  if (t) return t
  const firstLine = entry.content.trim().split('\n')[0]
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine || '(Không có nội dung)'
}

// ── Kiểu dữ liệu ─────────────────────────────────────────────────────
export interface KnowledgeEntry {
  id: string
  orgId: string
  type: string
  format: string
  categoryId: string | null
  productId: string | null
  title: string | null
  content: string
  keywords: string | null
  status: string
  risk: string
  source: string
  confidence: number | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeCategory {
  id: string
  parentId: string | null
  name: string
  slug: string
  description: string | null
  kind: string
  sortOrder: number
  entryCount: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeEntryInput {
  type: string
  title?: string | null
  content: string
  risk: string
  format?: string
  categoryId?: string | null
  productId?: string | null
  keywords?: string | null
  confidence?: number
  source?: string
}

export interface KnowledgeCategoryInput {
  name: string
  parentId?: string | null
  description?: string | null
  kind?: string
  sortOrder?: number
}

// ── Knowledge entries query/mutation ─────────────────────────────────
export interface KnowledgeQueryParams {
  status?: string
  categoryId?: string
  productId?: string
  type?: string
  format?: string
}

export function useKnowledgeEntries(params: KnowledgeQueryParams = {}) {
  return useQuery<KnowledgeEntry[]>({
    queryKey: ['knowledge', params],
    queryFn: async () => {
      const { data } = await api.get<Envelope<KnowledgeEntry[]>>('/knowledge', { params })
      return data.data
    },
    placeholderData: (prev) => prev,
  })
}

export function useCreateKnowledgeEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: KnowledgeEntryInput) => {
      const { data } = await api.post<Envelope<KnowledgeEntry>>('/knowledge', input)
      return data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge'] }),
  })
}

export function useUpdateKnowledgeEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; data: Partial<KnowledgeEntryInput> & { changeNote?: string } }) => {
      const { data } = await api.put<Envelope<KnowledgeEntry>>(`/knowledge/${vars.id}`, vars.data)
      return data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge'] }),
  })
}

export function useDeleteKnowledgeEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete<Envelope<{ deleted: boolean }>>(`/knowledge/${id}`)
      return data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge'] }),
  })
}

export function useApproveKnowledgeEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<Envelope<KnowledgeEntry>>(`/knowledge/${id}/approve`)
      return data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge'] }),
  })
}

export function useRejectKnowledgeEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<Envelope<KnowledgeEntry>>(`/knowledge/${id}/reject`)
      return data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge'] }),
  })
}

// ── Knowledge categories query/mutation ──────────────────────────────
export function useKnowledgeCategories() {
  return useQuery<KnowledgeCategory[]>({
    queryKey: ['knowledge-categories'],
    queryFn: async () => {
      const { data } = await api.get<Envelope<KnowledgeCategory[]>>('/knowledge-categories')
      return data.data
    },
  })
}

export function useCreateKnowledgeCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: KnowledgeCategoryInput) => {
      const { data } = await api.post<Envelope<KnowledgeCategory>>('/knowledge-categories', input)
      return data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-categories'] }),
  })
}

export function useUpdateKnowledgeCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; data: Partial<KnowledgeCategoryInput> }) => {
      const { data } = await api.patch<Envelope<KnowledgeCategory>>(
        `/knowledge-categories/${vars.id}`,
        vars.data,
      )
      return data.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-categories'] }),
  })
}

export function useDeleteKnowledgeCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete<Envelope<{ deleted: boolean }>>(`/knowledge-categories/${id}`)
      return data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-categories'] })
      qc.invalidateQueries({ queryKey: ['knowledge'] })
    },
  })
}
