/**
 * use-quick-notes.ts — Ghi chú nhanh theo HỘI THOẠI (tab "Ghi chú nhanh" cột phải).
 *
 * Khác `useNotes(contactId)` trong use-contacts.ts (ghi chú theo contact):
 * ở đây truy vấn theo conversationId và có kèm trạng thái tương tác
 * (no_contact / consulting / callback / …) lấy từ GET /notes/statuses.
 * Bám theo modules/contacts/note-routes.ts.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { BadgeProps } from '@/components/ui/badge'

export type NoteTone = 'muted' | 'info' | 'warning' | 'success' | 'danger'

export interface NoteStatus {
  value: string
  label: string
  tone: NoteTone
}

export interface QuickNote {
  id: string
  content: string
  status: string | null
  isPinned: boolean
  contactId: string | null
  conversationId: string | null
  createdAt: string
  createdBy?: { id: string; fullName: string | null; avatarUrl?: string | null } | null
}

export interface CreateQuickNoteInput {
  conversationId: string
  content: string
  /** Mã trạng thái từ /notes/statuses; bỏ trống = ghi chú thường. */
  status?: string
  contactId?: string
}

/** Màu Badge theo tone backend gửi kèm — đọc lướt là biết cuộc liên hệ đi tới đâu. */
export function noteToneVariant(tone?: NoteTone | null): BadgeProps['variant'] {
  switch (tone) {
    case 'success': return 'success'
    case 'warning': return 'warning'
    case 'danger': return 'destructive'
    case 'info': return 'default'
    default: return 'secondary'
  }
}

export const quickNoteKeys = {
  byConversation: (convId: string) => ['notes', { conversationId: convId }] as const,
  statuses: ['notes', 'statuses'] as const,
}

export function useConversationNotes(convId: string | undefined) {
  return useQuery<{ notes: QuickNote[]; total: number }>({
    queryKey: quickNoteKeys.byConversation(convId ?? ''),
    enabled: !!convId,
    queryFn: async () => (await api.get('/notes', { params: { conversationId: convId } })).data,
  })
}

export function useNoteStatuses() {
  return useQuery<{ statuses: NoteStatus[] }>({
    queryKey: quickNoteKeys.statuses,
    staleTime: Infinity,
    queryFn: async () => (await api.get('/notes/statuses')).data,
  })
}

export function useCreateQuickNote() {
  const qc = useQueryClient()
  return useMutation<QuickNote, unknown, CreateQuickNoteInput>({
    mutationFn: async (input) =>
      (await api.post<QuickNote>('/notes', {
        conversationId: input.conversationId,
        contactId: input.contactId || undefined,
        content: input.content.trim(),
        status: input.status || undefined,
      })).data,
    onSuccess: (_note, input) => {
      qc.invalidateQueries({ queryKey: quickNoteKeys.byConversation(input.conversationId) })
      if (input.contactId) qc.invalidateQueries({ queryKey: ['notes', { contactId: input.contactId }] })
      // Ghi chú mới cũng là một hoạt động trên dòng thời gian.
      qc.invalidateQueries({ queryKey: ['orders', 'customer-activity'] })
    },
  })
}
