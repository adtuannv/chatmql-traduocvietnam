/**
 * use-library.ts — Thư viện tài liệu bán hàng (kho nội dung ĐÃ DUYỆT để gửi cho khách).
 *
 * Backend chỉ trả status='active' và kiểm lại một lần nữa lúc gửi — giao diện
 * không cần lọc thêm. Bám theo modules/knowledge/library-routes.ts.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

/** Các loại backend nhận: image | content | video | all. */
export type LibraryKind = 'image' | 'content' | 'video' | 'all'

export interface LibraryItem {
  /** `prod:<productId>:<idx>` (ảnh sản phẩm) hoặc `kb:<entryId>` (kho tri thức). */
  id: string
  kind: 'image' | 'content' | 'video'
  title: string
  /** Chỉ có với mục từ kho tri thức. */
  content?: string | null
  thumbUrl?: string
  fullUrl?: string
  meta?: { sku?: string }
}

export interface LibraryGroup {
  id: string
  name: string
  items: LibraryItem[]
}

export interface LibraryItemsResponse {
  groups: LibraryGroup[]
}

export interface SendLibraryInput {
  conversationId: string
  itemIds: string[]
}

export interface SendLibraryResult {
  sent: number
  created: string[]
  skipped: Array<{ id: string; reason: string }>
}

export const LIBRARY_KIND_LABELS: Record<Exclude<LibraryKind, 'all'>, string> = {
  image: 'Hình ảnh',
  content: 'Content',
  video: 'Video',
}

export const libraryKeys = {
  all: ['library'] as const,
  items: (kind: LibraryKind, q?: string) => ['library', 'items', kind, q ?? ''] as const,
}

/** Tài liệu đã duyệt, gom theo nhóm (danh mục sản phẩm / danh mục kho tri thức). */
export function useLibraryItems(kind: LibraryKind, q?: string, enabled = true) {
  return useQuery<LibraryItemsResponse>({
    queryKey: libraryKeys.items(kind, q),
    enabled,
    staleTime: 60_000,
    queryFn: async () =>
      (await api.get<LibraryItemsResponse>('/library/items', { params: { kind, q: q?.trim() || undefined } })).data,
  })
}

/** Gửi các mục đã chọn vào hội thoại (tối đa 20 mục/lần). */
export function useSendLibraryItems() {
  const qc = useQueryClient()
  return useMutation<SendLibraryResult, unknown, SendLibraryInput>({
    mutationFn: async (input) => (await api.post<SendLibraryResult>('/library/send', input)).data,
    onSuccess: (_data, input) => {
      // Tin mới xuất hiện trong khung chat + tài nguyên đã trao đổi.
      qc.invalidateQueries({ queryKey: ['conversation-messages', input.conversationId] })
      qc.invalidateQueries({ queryKey: ['conversation-resources', input.conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['orders', 'conversation-library', input.conversationId] })
    },
  })
}
