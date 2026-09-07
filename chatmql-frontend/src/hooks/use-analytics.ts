import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useApiQuery } from '@/hooks/use-api'

// ── Khoảng thời gian ────────────────────────────────────────────────
export type RangeKey = 'today' | '7d' | '30d'

export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày qua' },
  { value: '30d', label: '30 ngày qua' },
]

/** Chuyển RangeKey → { from, to } dạng ISO (YYYY-MM-DD). */
export function rangeToParams(range: RangeKey): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  if (range === 'today') from.setHours(0, 0, 0, 0)
  else if (range === '7d') from.setDate(from.getDate() - 6)
  else from.setDate(from.getDate() - 29)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: iso(from), to: iso(to) }
}

// ── Kiểu dữ liệu API ────────────────────────────────────────────────
export interface KpiSummary {
  totalContacts: number
  convertedContacts: number
  conversionRate: string
  totalMessages: number
  totalConversations: number
}

export interface FunnelStage {
  stage: string
  label: string
  color: string
  count: number
  rate: number
  dropOffCount: number
  dropOffRate: number
}
export interface FunnelResult {
  stages: FunnelStage[]
  totalContacts: number
  totalConverted: number
  conversionRate: number
  avgConversionDays: number | null
  churnedCount: number
}

export interface ResponseTimeResult {
  daily: { date: string; avgSeconds: number }[]
  overall: number | null
  byUser: { userId: string; fullName: string; avgSeconds: number | null }[]
}

export interface TeamMember {
  userId: string
  fullName: string
  messagesSent: number
  contactsConverted: number
  appointmentsCompleted: number
  avgResponseTime: number | null
}
export interface TeamResult {
  users: TeamMember[]
}

export interface MessageVolumeResult {
  data: { date: string; sent: number; received: number }[]
}

export interface SourceRow {
  source: string
  _count: { _all: number }
}

export interface SavedReport {
  id: string
  name: string
  type: string
  config: Record<string, unknown>
  createdBy: string
  createdAt: string
  lastRunAt?: string | null
}

// ── Query hooks (Tổng quan / Phân tích) ─────────────────────────────
export function useKpiSummary(range: RangeKey) {
  return useApiQuery<KpiSummary>(
    ['analytics-kpi-summary', range],
    '/analytics/kpi-summary',
    rangeToParams(range),
  )
}

export function useConversionFunnel(range: RangeKey) {
  return useApiQuery<FunnelResult>(
    ['analytics-funnel', range],
    '/analytics/conversion-funnel',
    rangeToParams(range),
  )
}

export function useResponseTime(range: RangeKey) {
  return useApiQuery<ResponseTimeResult>(
    ['analytics-response-time', range],
    '/analytics/response-time',
    rangeToParams(range),
  )
}

export function useTeamPerformance(range: RangeKey) {
  return useApiQuery<TeamResult>(
    ['analytics-team', range],
    '/analytics/team-performance',
    rangeToParams(range),
  )
}

export function useMessageVolume(params?: { channel?: string; accountId?: string }) {
  // Cùng phạm vi với báo cáo Chat → Đơn: lọc theo kênh/tài khoản tương tác.
  const p = params?.accountId
    ? { accountId: params.accountId }
    : params?.channel
      ? { channel: params.channel }
      : undefined
  return useApiQuery<MessageVolumeResult>(['dashboard-message-volume', p ?? {}], '/dashboard/message-volume', p)
}

export function useSources() {
  return useApiQuery<SourceRow[]>(['dashboard-sources'], '/dashboard/sources')
}

// ── Saved reports ───────────────────────────────────────────────────
export function useSavedReports() {
  return useApiQuery<{ data: SavedReport[] }>(['saved-reports'], '/saved-reports')
}

export function useCreateSavedReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { name: string; type: string; config?: Record<string, unknown> }) => {
      const { data } = await api.post<SavedReport>('/saved-reports', body)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports'] }),
  })
}

export function useDeleteSavedReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/saved-reports/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports'] }),
  })
}

export interface RunReportResult {
  type: string
  ranAt: string
  data: unknown
  note?: string
}
export function useRunSavedReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<RunReportResult>(`/saved-reports/${id}/run`, {})
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-reports'] }),
  })
}

// ── Tiện ích định dạng ──────────────────────────────────────────────
/** Định dạng giây → "1 phút 20 giây" / "45 giây". */
export function formatSeconds(s: number | null | undefined): string {
  if (s == null) return '—'
  const sec = Math.round(s)
  if (sec < 60) return `${sec} giây`
  const m = Math.floor(sec / 60)
  const rem = sec % 60
  return rem > 0 ? `${m} phút ${rem} giây` : `${m} phút`
}
