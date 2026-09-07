import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/hooks/use-api'
import type { BadgeProps } from '@/components/ui/badge'

// ── Hằng số & nhãn tiếng Việt ────────────────────────────────────────
export const LIFECYCLE_STAGES = [
  'subscriber',
  'lead',
  'qualified',
  'opportunity',
  'customer',
  'evangelist',
  'churned',
] as const

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number]

export const STAGE_LABELS: Record<string, string> = {
  subscriber: 'Đăng ký',
  lead: 'Lead',
  qualified: 'Đủ điều kiện',
  opportunity: 'Cơ hội',
  customer: 'Khách hàng',
  evangelist: 'VIP/Đại sứ',
  churned: 'Rời bỏ',
}

export function stageLabel(stage?: string | null): string {
  if (!stage) return '—'
  return STAGE_LABELS[stage] ?? stage
}

export function stageBadgeVariant(stage?: string | null): BadgeProps['variant'] {
  switch (stage) {
    case 'customer':
    case 'evangelist':
      return 'success'
    case 'qualified':
    case 'opportunity':
      return 'warning'
    case 'churned':
      return 'destructive'
    case 'lead':
      return 'default'
    default:
      return 'secondary'
  }
}

export const SENTIMENT_LABELS: Record<string, string> = {
  positive: 'Tích cực',
  neutral: 'Trung lập',
  negative: 'Tiêu cực',
}

export function sentimentBadgeVariant(label?: string | null): BadgeProps['variant'] {
  switch (label) {
    case 'positive':
      return 'success'
    case 'negative':
      return 'destructive'
    default:
      return 'secondary'
  }
}

export const INTENT_LABELS: Record<string, string> = {
  hot: 'Nóng',
  warm: 'Ấm',
  cold: 'Lạnh',
}

export function intentBadgeVariant(intent?: string | null): BadgeProps['variant'] {
  switch (intent) {
    case 'hot':
      return 'destructive'
    case 'warm':
      return 'warning'
    default:
      return 'secondary'
  }
}

// ── Kiểu dữ liệu ─────────────────────────────────────────────────────
export interface ContactListItem {
  id: string
  fullName: string | null
  crmName: string | null
  phone: string | null
  email: string | null
  avatarUrl: string | null
  jobTitle: string | null
  source: string | null
  lifecycleStage: string
  leadScore: number
  tags: string[]
  createdAt: string
  lastActivity: string | null
  aiSentimentLabel: string | null
  aiIntent: string | null
  assignedUser: { fullName: string | null } | null
  company: { id: string; name: string } | null
  _count?: { conversations: number }
}

export interface ContactListResponse {
  contacts: ContactListItem[]
  total: number
  page: number
  limit: number
}

export interface ContactConversation {
  id: string
  displayName: string | null
  threadType: string | null
  lastMessageAt: string | null
  unreadCount: number
  channelAccount: { id: string; displayName: string | null } | null
  messages: { content: string | null; contentType: string | null; senderType: string | null; sentAt: string }[]
}

export interface ContactDetail extends ContactListItem {
  companyId: string | null
  notes: string | null
  zaloUid: string | null
  assignedUserId: string | null
  aiSummary: string | null
  aiSentimentConfidence: number | null
  aiSentimentReason: string | null
  aiPainPoints: string[]
  aiCompetitors: string[]
  aiSignals: string[]
  aiAnalyzedAt: string | null
  company: { id: string; name: string; industry?: string | null; website?: string | null } | null
  conversations: ContactConversation[]
}

export interface ContactUpdateInput {
  fullName?: string
  phone?: string
  email?: string
  jobTitle?: string
  /** 'YYYY-MM-DD' hoặc null để xoá. */
  birthday?: string | null
  source?: string
  lifecycleStage?: string
  notes?: string
  tags?: string[]
  companyId?: string | null
}

// ── Query hooks ──────────────────────────────────────────────────────
export interface ContactQueryParams {
  page?: number
  limit?: number
  search?: string
  lifecycleStage?: string
}

export function useContacts(params: ContactQueryParams) {
  return useApiQuery<ContactListResponse>(
    ['contacts', params],
    '/contacts',
    params as Record<string, unknown>,
    { placeholderData: (prev) => prev },
  )
}

export function useContact(id: string | undefined) {
  return useQuery<ContactDetail>({
    queryKey: ['contact', id],
    queryFn: async () => {
      const { data } = await api.get<ContactDetail>(`/contacts/${id}`)
      return data
    },
    enabled: !!id,
  })
}

// ── Mutation hooks ───────────────────────────────────────────────────
export function useUpdateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; data: ContactUpdateInput }) => {
      // Backend TDVN: bảng Contact không có cột `birthday` — Prisma sẽ ném lỗi
      // 500 nếu gửi kèm. Bỏ trường này trước khi PUT (các trường còn lại khớp).
      const { birthday: _birthday, ...body } = vars.data
      const { data } = await api.put(`/contacts/${vars.id}`, body)
      return data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['contact', vars.id] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

export function useCreateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: ContactUpdateInput) => {
      const res = await api.post('/contacts', data)
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  })
}

export function useDeleteContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/contacts/${id}`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  })
}

// ── Ghi chú (Notes) ──────────────────────────────────────────────────
export interface Note {
  id: string
  content: string
  isPinned: boolean
  createdAt: string
  contactId: string | null
  createdBy: { id: string; fullName: string | null; avatarUrl: string | null } | null
}

export function useNotes(contactId: string | undefined) {
  return useQuery<{ notes: Note[]; total: number }>({
    queryKey: ['notes', { contactId }],
    queryFn: async () => {
      const { data } = await api.get('/notes', { params: { contactId } })
      return data
    },
    enabled: !!contactId,
  })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { contactId: string; content: string; isPinned?: boolean }) => {
      const { data } = await api.post('/notes', vars)
      return data
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ['notes', { contactId: vars.contactId }] }),
  })
}

export function useUpdateNote(contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; content?: string; isPinned?: boolean }) => {
      const { id, ...body } = vars
      const { data } = await api.put(`/notes/${id}`, body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', { contactId }] }),
  })
}

export function useToggleNotePin(contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch(`/notes/${id}/pin`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', { contactId }] }),
  })
}

export function useDeleteNote(contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/notes/${id}`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', { contactId }] }),
  })
}

// ── Lịch hẹn (Appointments) ──────────────────────────────────────────
export const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  call: 'Gọi điện',
  meeting: 'Gặp mặt',
  demo: 'Demo',
  visit: 'Thăm khách',
  other: 'Khác',
}

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Đã lên lịch',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
}

export function appointmentStatusVariant(status?: string | null): BadgeProps['variant'] {
  switch (status) {
    case 'completed':
      return 'success'
    case 'cancelled':
      return 'destructive'
    default:
      return 'default'
  }
}

export interface Appointment {
  id: string
  contactId: string | null
  appointmentDate: string
  appointmentTime: string | null
  type: string
  status: string
  notes: string | null
  contact?: { id: string; fullName: string | null; phone: string | null } | null
}

export function useAppointments(contactId: string | undefined) {
  return useQuery<{ appointments: Appointment[]; total: number }>({
    queryKey: ['appointments', { contactId }],
    queryFn: async () => {
      const { data } = await api.get('/appointments', { params: { contactId } })
      return data
    },
    enabled: !!contactId,
  })
}

export interface AppointmentInput {
  contactId?: string
  appointmentDate: string
  appointmentTime?: string
  type?: string
  status?: string
  notes?: string
}

export function useCreateAppointment(contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: AppointmentInput) => {
      const res = await api.post('/appointments', data)
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments', { contactId }] }),
  })
}

export function useUpdateAppointment(contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; data: Partial<AppointmentInput> }) => {
      const res = await api.put(`/appointments/${vars.id}`, vars.data)
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments', { contactId }] }),
  })
}

export function useDeleteAppointment(contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/appointments/${id}`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments', { contactId }] }),
  })
}

// ── Trùng lặp (Duplicates) ───────────────────────────────────────────
export interface DuplicateContact {
  id: string
  fullName: string | null
  phone: string | null
  email: string | null
  avatarUrl: string | null
  source: string | null
  lifecycleStage: string
  zaloUid: string | null
  leadScore: number
  createdAt: string
  lastActivity: string | null
  _count?: { conversations: number }
}

export interface DuplicateGroup {
  id: string
  matchType: string
  confidence: number
  resolved: boolean
  contactIds: string[]
  createdAt: string
  contacts: DuplicateContact[]
}

export function useDuplicateGroups() {
  return useQuery<{ groups: DuplicateGroup[]; total: number }>({
    queryKey: ['duplicate-groups'],
    queryFn: async () => {
      const { data } = await api.get('/contacts/duplicates', { params: { limit: 100 } })
      return data
    },
  })
}

export function useScanDuplicates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/contacts/duplicates/scan')
      return data as { ok: boolean; scanned: number; newGroups: number }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['duplicate-groups'] }),
  })
}

export function useMergeDuplicateGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { groupId: string; primaryContactId: string }) => {
      const { data } = await api.post(`/contacts/duplicates/${vars.groupId}/merge`, {
        primaryContactId: vars.primaryContactId,
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['duplicate-groups'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}

export function useDismissDuplicateGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (groupId: string) => {
      const { data } = await api.post(`/contacts/duplicates/${groupId}/dismiss`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['duplicate-groups'] }),
  })
}

// ── Trích số điện thoại ──────────────────────────────────────────────
export interface PhoneMatch {
  id: string
  fullName: string
  extractedPhone: string
}

export interface ExtractPhonesResult {
  ok: boolean
  dryRun: boolean
  scanned: number
  matched: number
  updated: number
  matches?: PhoneMatch[]
}

export function useExtractPhones() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { dryRun: boolean; excludeIds?: string[] }) => {
      const { data } = await api.post('/contacts/extract-phones', vars)
      return data as ExtractPhonesResult
    },
    onSuccess: (res) => {
      if (!res.dryRun) qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}
