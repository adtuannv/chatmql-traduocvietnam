import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { BadgeProps } from '@/components/ui/badge'
import { LIFECYCLE_STAGES, STAGE_LABELS } from '@/hooks/use-contacts'

/**
 * Hook CDP — bám sát backend:
 *   cdp-property-routes   → /cdp/properties, /cdp/property-groups
 *   cdp-segment-routes    → /cdp/segments
 *   cdp-preset-routes     → /cdp/presets
 *   cdp-dictionary-routes → /cdp/dictionary   (trả MẢNG, không bọc object)
 *   cdp-event-routes      → /cdp/events, /cdp/events/stats
 *   cdp-lifecycle-routes  → /contacts/:id/lifecycle
 *   dashboard-routes      → /dashboard/pipeline (đếm khách theo giai đoạn)
 */

// ── Tiện ích lỗi ─────────────────────────────────────────────────────
export function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}
export function isForbidden(err: unknown): boolean {
  return httpStatus(err) === 403
}

// ── Thuộc tính tuỳ chỉnh ─────────────────────────────────────────────
export const FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'single_select', 'multi_select'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Văn bản',
  number: 'Số',
  date: 'Ngày',
  boolean: 'Có/Không',
  single_select: 'Chọn một',
  multi_select: 'Chọn nhiều',
}

export function fieldTypeVariant(t?: string | null): BadgeProps['variant'] {
  switch (t) {
    case 'number':
      return 'warning'
    case 'date':
      return 'success'
    case 'boolean':
      return 'destructive'
    case 'single_select':
    case 'multi_select':
      return 'default'
    default:
      return 'secondary'
  }
}

export const DEFAULT_GROUP_NAME = 'Chung'

export interface PropertyOption {
  value: string
  label: string
  color?: string
}

export interface CustomProperty {
  id: string
  name: string
  fieldKey: string
  fieldType: string
  options: PropertyOption[]
  isRequired: boolean
  groupName: string | null
  sortOrder: number
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface PropertyInput {
  name: string
  fieldType: string
  options?: PropertyOption[]
  isRequired?: boolean
  groupName?: string
  description?: string
  sortOrder?: number
}

export interface PropertyGroup {
  name: string
  count: number
}

export function useCdpProperties(group?: string) {
  return useQuery<{ properties: CustomProperty[] }>({
    queryKey: ['cdp', 'properties', { group }],
    queryFn: async () => {
      const { data } = await api.get('/cdp/properties', { params: group ? { group } : undefined })
      return data
    },
  })
}

export function usePropertyGroups() {
  return useQuery<{ groups: PropertyGroup[] }>({
    queryKey: ['cdp', 'property-groups'],
    queryFn: async () => (await api.get('/cdp/property-groups')).data,
  })
}

function invalidateProperties(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['cdp', 'properties'] })
  qc.invalidateQueries({ queryKey: ['cdp', 'property-groups'] })
  qc.invalidateQueries({ queryKey: ['cdp', 'presets', 'status'] })
}

export function useCreateProperty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: PropertyInput) =>
      (await api.post<{ property: CustomProperty }>('/cdp/properties', input)).data.property,
    onSuccess: () => invalidateProperties(qc),
  })
}

export function useUpdateProperty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; data: Partial<PropertyInput> }) =>
      (await api.put<{ property: CustomProperty }>(`/cdp/properties/${vars.id}`, vars.data)).data.property,
    onSuccess: () => invalidateProperties(qc),
  })
}

export function useDeleteProperty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/cdp/properties/${id}`)).data,
    onSuccess: () => invalidateProperties(qc),
  })
}

export function useRenamePropertyGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { oldName: string; newName: string }) =>
      (await api.put<{ updated: number }>('/cdp/property-groups/rename', vars)).data,
    onSuccess: () => invalidateProperties(qc),
  })
}

export function useReorderProperties() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (items: { id: string; groupName?: string; sortOrder: number }[]) =>
      (await api.put<{ updated: number }>('/cdp/property-groups/reorder', { items })).data,
    onSuccess: () => invalidateProperties(qc),
  })
}

// ── Segment ──────────────────────────────────────────────────────────
export type SegmentConditionType = 'contact' | 'property' | 'event' | 'lifecycle'

export interface SegmentCondition {
  type: SegmentConditionType
  field: string
  operator: string
  value: string | number
}

export interface SegmentConditionGroup {
  logic: 'AND' | 'OR'
  conditions: SegmentCondition[]
}

export interface Segment {
  id: string
  name: string
  description: string | null
  conditions: SegmentConditionGroup[]
  contactCount: number
  lastCalculatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SegmentInput {
  name: string
  description?: string
  conditions: SegmentConditionGroup[]
}

export const CONDITION_TYPE_LABELS: Record<SegmentConditionType, string> = {
  contact: 'Thông tin KH',
  property: 'Trường CDP',
  event: 'Sự kiện',
  lifecycle: 'Vòng đời',
}

/** Cột có sẵn trên Contact mà backend cho phép lọc (evaluateSegment → where[field]). */
export const CONTACT_FIELDS: { value: string; label: string; numeric?: boolean }[] = [
  { value: 'fullName', label: 'Tên' },
  { value: 'phone', label: 'Số điện thoại' },
  { value: 'email', label: 'Email' },
  { value: 'source', label: 'Nguồn' },
  { value: 'lifecycleStage', label: 'Giai đoạn' },
  { value: 'leadScore', label: 'Điểm lead', numeric: true },
]

export const SEGMENT_OPERATORS: { value: string; label: string; types: SegmentConditionType[]; noValue?: boolean }[] = [
  { value: 'equals', label: 'Bằng', types: ['contact', 'property', 'lifecycle'] },
  { value: 'not_equals', label: 'Khác', types: ['contact', 'property'] },
  { value: 'contains', label: 'Chứa', types: ['contact', 'property'] },
  { value: 'gt', label: 'Lớn hơn (>)', types: ['contact', 'property'] },
  { value: 'gte', label: 'Lớn hơn hoặc bằng (≥)', types: ['contact', 'property'] },
  { value: 'lt', label: 'Nhỏ hơn (<)', types: ['contact', 'property'] },
  { value: 'lte', label: 'Nhỏ hơn hoặc bằng (≤)', types: ['contact', 'property'] },
  { value: 'is_null', label: 'Trống', types: ['contact'], noValue: true },
  { value: 'is_not_null', label: 'Có giá trị', types: ['contact'], noValue: true },
  { value: 'has_event', label: 'Đã xảy ra', types: ['event'], noValue: true },
  { value: 'event_count_gte', label: 'Số lần ≥', types: ['event'] },
]

export function operatorsFor(type: SegmentConditionType) {
  return SEGMENT_OPERATORS.filter((o) => o.types.includes(type))
}

export function operatorLabel(op: string): string {
  return SEGMENT_OPERATORS.find((o) => o.value === op)?.label ?? op
}

export function emptyCondition(): SegmentCondition {
  return { type: 'contact', field: 'source', operator: 'equals', value: '' }
}

export function emptyGroup(): SegmentConditionGroup {
  return { logic: 'AND', conditions: [emptyCondition()] }
}

export function useSegments() {
  return useQuery<{ segments: Segment[] }>({
    queryKey: ['cdp', 'segments'],
    queryFn: async () => (await api.get('/cdp/segments')).data,
  })
}

export function useCreateSegment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SegmentInput) =>
      (await api.post<{ segment: Segment }>('/cdp/segments', input)).data.segment,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cdp', 'segments'] }),
  })
}

export function useUpdateSegment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; data: Partial<SegmentInput> }) =>
      (await api.put<{ segment: Segment }>(`/cdp/segments/${vars.id}`, vars.data)).data.segment,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cdp', 'segments'] }),
  })
}

export function useDeleteSegment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/cdp/segments/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cdp', 'segments'] }),
  })
}

export function useRecalculateSegment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<{ contactCount: number; lastCalculatedAt: string }>(`/cdp/segments/${id}/calculate`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cdp', 'segments'] }),
  })
}

export interface SegmentContact {
  id: string
  fullName: string | null
  phone: string | null
  email: string | null
  lifecycleStage: string
  leadScore: number
  avatarUrl: string | null
}

export function useSegmentContacts(id: string | null, limit = 20, offset = 0) {
  return useQuery<{ contacts: SegmentContact[]; total: number }>({
    queryKey: ['cdp', 'segments', id, 'contacts', { limit, offset }],
    queryFn: async () =>
      (await api.get(`/cdp/segments/${id}/contacts`, { params: { limit, offset } })).data,
    enabled: !!id,
  })
}

// ── Preset ───────────────────────────────────────────────────────────
export interface PresetSummary {
  key: string
  name: string
  description: string
  icon: string
  groupName: string
  counts: { properties: number; events: number; automations: number }
}

export interface PresetStatus {
  installed: boolean
  propsInstalled: number
  eventsInstalled: number
}

export interface PresetDetail {
  key: string
  name: string
  description: string
  icon: string
  groupName: string
  properties: { name: string; fieldKey: string; fieldType: string; description?: string }[]
  events: { eventName: string; displayName: string; description?: string }[]
  automations: { name: string; description?: string; trigger: string }[]
}

export interface PresetApplyResult {
  created: { props: number; events: number; automations: number }
  skipped: { props: number; events: number }
}

export function usePresets() {
  return useQuery<{ presets: PresetSummary[] }>({
    queryKey: ['cdp', 'presets'],
    queryFn: async () => (await api.get('/cdp/presets')).data,
    staleTime: 5 * 60_000,
  })
}

export function usePresetStatus() {
  return useQuery<{ status: Record<string, PresetStatus> }>({
    queryKey: ['cdp', 'presets', 'status'],
    queryFn: async () => (await api.get('/cdp/presets/status')).data,
  })
}

export function usePresetDetail(key: string | null) {
  return useQuery<{ preset: PresetDetail }>({
    queryKey: ['cdp', 'presets', key],
    queryFn: async () => (await api.get(`/cdp/presets/${key}`)).data,
    enabled: !!key,
  })
}

function invalidateAfterPreset(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['cdp'] })
  qc.invalidateQueries({ queryKey: ['automation'] })
}

export function useApplyPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      key: string
      selectedProperties?: string[]
      selectedEvents?: string[]
      selectedAutomations?: string[]
    }) => {
      const { key, ...body } = vars
      return (await api.post<PresetApplyResult>(`/cdp/presets/${key}/apply`, body)).data
    },
    onSuccess: () => invalidateAfterPreset(qc),
  })
}

export function useUninstallPreset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (key: string) =>
      (await api.delete<{ success: boolean; deleted: { props: number; events: number; automations: number } }>(
        `/cdp/presets/${key}/uninstall`,
      )).data,
    onSuccess: () => invalidateAfterPreset(qc),
  })
}

// ── Từ điển sự kiện (event definitions) ──────────────────────────────
export interface EventDefinition {
  id: string
  eventName: string
  displayName: string
  description: string | null
  schema: Record<string, unknown>
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface EventDefinitionInput {
  eventName: string
  displayName: string
  description?: string
  schema?: Record<string, unknown>
  isActive?: boolean
}

export function useEventDefinitions() {
  return useQuery<EventDefinition[]>({
    queryKey: ['cdp', 'dictionary'],
    // Route này trả thẳng mảng (không bọc { definitions }).
    queryFn: async () => (await api.get<EventDefinition[]>('/cdp/dictionary')).data,
  })
}

function invalidateDictionary(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['cdp', 'dictionary'] })
  qc.invalidateQueries({ queryKey: ['cdp', 'presets', 'status'] })
}

export function useCreateEventDefinition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: EventDefinitionInput) =>
      (await api.post<EventDefinition>('/cdp/dictionary', input)).data,
    onSuccess: () => invalidateDictionary(qc),
  })
}

export function useUpdateEventDefinition() {
  const qc = useQueryClient()
  return useMutation({
    // Backend ghi đè đủ 4 trường displayName/description/schema/isActive → luôn gửi đủ.
    mutationFn: async (vars: { id: string; data: Omit<EventDefinitionInput, 'eventName'> }) =>
      (await api.put<EventDefinition>(`/cdp/dictionary/${vars.id}`, vars.data)).data,
    onSuccess: () => invalidateDictionary(qc),
  })
}

export function useDeleteEventDefinition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/cdp/dictionary/${id}`)).data,
    onSuccess: () => invalidateDictionary(qc),
  })
}

// ── Sự kiện đã ghi nhận ──────────────────────────────────────────────
export interface CdpEvent {
  id: string
  contactId: string
  eventName: string
  properties: Record<string, unknown>
  source: string | null
  sessionId: string | null
  timestamp: string
  createdAt: string
  contact?: { id: string; fullName: string | null; avatarUrl: string | null } | null
}

export interface CdpEventQuery {
  contactId?: string
  eventName?: string
  from?: string
  to?: string
  source?: string
  limit?: number
  offset?: number
}

export function useCdpEvents(params: CdpEventQuery) {
  return useQuery<{ events: CdpEvent[]; total: number }>({
    queryKey: ['cdp', 'events', params],
    queryFn: async () => (await api.get('/cdp/events', { params })).data,
    placeholderData: (prev) => prev,
  })
}

export interface EventStats {
  totalEvents: number
  byEventName: { name: string; count: number }[]
  period: string
}

export function useCdpEventStats(days = 30, contactId?: string) {
  return useQuery<EventStats>({
    queryKey: ['cdp', 'events', 'stats', { days, contactId }],
    queryFn: async () => (await api.get('/cdp/events/stats', { params: { days, contactId } })).data,
  })
}

export function useTrackEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      contactId: string
      eventName: string
      properties?: Record<string, unknown>
      source?: string
    }) => (await api.post<{ event: CdpEvent }>('/cdp/events', input)).data.event,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cdp', 'events'] }),
  })
}

// ── Vòng đời ─────────────────────────────────────────────────────────
export { LIFECYCLE_STAGES, STAGE_LABELS }

export interface PipelineRow {
  status: string
  lifecycleStage: string
  _count: { _all: number }
}

/** Đếm khách hàng theo giai đoạn (dashboard-routes, mọi vai trò đều xem được). */
export function useLifecyclePipeline() {
  return useQuery<PipelineRow[]>({
    queryKey: ['cdp', 'lifecycle', 'pipeline'],
    queryFn: async () => (await api.get('/dashboard/pipeline')).data,
  })
}

/**
 * Chuyển đổi giai đoạn gần đây — backend không có endpoint log toàn tổ chức,
 * nhưng lifecycle-service ghi CdpEvent `lifecycle_change` cho mỗi lần đổi.
 */
export function useRecentLifecycleChanges(limit = 30) {
  return useCdpEvents({ eventName: 'lifecycle_change', limit })
}

export interface LifecycleLog {
  id: string
  contactId: string
  fromStage: string | null
  toStage: string
  changedBy: string | null
  reason: string | null
  createdAt: string
}

export function useContactLifecycle(contactId: string | null) {
  return useQuery<{
    currentStage: string
    stages: readonly string[]
    stageLabels: Record<string, string>
    history: LifecycleLog[]
  }>({
    queryKey: ['cdp', 'lifecycle', 'contact', contactId],
    queryFn: async () => (await api.get(`/contacts/${contactId}/lifecycle`)).data,
    enabled: !!contactId,
  })
}

export function useChangeLifecycleStage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { contactId: string; toStage: string; reason?: string }) =>
      (
        await api.post<{ log: LifecycleLog }>(`/contacts/${vars.contactId}/lifecycle`, {
          toStage: vars.toStage,
          reason: vars.reason,
        })
      ).data.log,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['cdp', 'lifecycle'] })
      qc.invalidateQueries({ queryKey: ['cdp', 'events'] })
      qc.invalidateQueries({ queryKey: ['contact', vars.contactId] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
    },
  })
}
