import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { BadgeProps } from '@/components/ui/badge'

// ─── Trigger / Action / Condition metadata (nhãn tiếng Việt) ──────────

/** Danh sách trigger hợp lệ (khớp backend VALID_TRIGGERS_V2). */
export const TRIGGERS = [
  'message_received',
  'message_sent',
  'contact_created',
  'lifecycle_changed',
  'status_changed',
  'tag_added',
  'tag_removed',
  'property_changed',
  'event_tracked',
  'segment_entered',
  'segment_exited',
  'no_reply_24h',
  'conversation_idle',
  'appointment_upcoming',
  'birthday_detected',
  'user_follow_oa',
  'user_unfollow_oa',
  'order_completed',
] as const

export type TriggerType = (typeof TRIGGERS)[number]

export const TRIGGER_LABELS: Record<string, string> = {
  message_received: 'Nhận tin nhắn',
  message_sent: 'Gửi tin nhắn',
  contact_created: 'Tạo liên hệ mới',
  lifecycle_changed: 'Đổi giai đoạn vòng đời',
  status_changed: 'Đổi trạng thái',
  tag_added: 'Thêm nhãn',
  tag_removed: 'Gỡ nhãn',
  property_changed: 'Thay đổi thuộc tính',
  event_tracked: 'Ghi nhận sự kiện',
  segment_entered: 'Vào phân khúc',
  segment_exited: 'Rời phân khúc',
  no_reply_24h: 'Không trả lời 24h',
  conversation_idle: 'Hội thoại không hoạt động',
  appointment_upcoming: 'Sắp có lịch hẹn',
  birthday_detected: 'Phát hiện sinh nhật',
  user_follow_oa: 'Người dùng theo dõi OA',
  user_unfollow_oa: 'Người dùng bỏ theo dõi OA',
  order_completed: 'Hoàn tất đơn hàng',
}

export function triggerLabel(t?: string | null): string {
  if (!t) return '—'
  return TRIGGER_LABELS[t] ?? t
}

/** Loại hành động (action node). */
export const ACTION_TYPES = [
  'send_message',
  'send_template',
  'add_tag',
  'remove_tag',
  'change_status',
  'update_lifecycle',
  'assign_agent',
  'create_appointment',
  'update_property',
  'increment_property',
  'track_event',
  'send_notification',
  'send_zalo_zns',
  'ai_cdp',
] as const

export type ActionType = (typeof ACTION_TYPES)[number]

export const ACTION_LABELS: Record<string, string> = {
  send_message: 'Gửi tin nhắn',
  send_template: 'Gửi mẫu tin',
  add_tag: 'Thêm nhãn',
  remove_tag: 'Gỡ nhãn',
  change_status: 'Đổi trạng thái',
  update_lifecycle: 'Cập nhật vòng đời',
  assign_agent: 'Gán nhân viên',
  create_appointment: 'Tạo lịch hẹn',
  update_property: 'Cập nhật thuộc tính',
  increment_property: 'Tăng thuộc tính',
  track_event: 'Ghi nhận sự kiện',
  send_notification: 'Gửi thông báo',
  send_zalo_zns: 'Gửi Zalo ZNS',
  ai_cdp: 'Phân tích AI-CDP',
}

export function actionLabel(a?: string | null): string {
  if (!a) return '—'
  return ACTION_LABELS[a] ?? a
}

/** Toán tử điều kiện (khớp evaluator backend). */
export const CONDITION_OPS = [
  'eq',
  'neq',
  'contains',
  'gte',
  'lte',
  'exists',
  'not_exists',
] as const

export type ConditionOp = (typeof CONDITION_OPS)[number]

export const CONDITION_OP_LABELS: Record<string, string> = {
  eq: 'Bằng',
  neq: 'Khác',
  contains: 'Chứa',
  gte: 'Lớn hơn hoặc bằng',
  lte: 'Nhỏ hơn hoặc bằng',
  exists: 'Có giá trị',
  not_exists: 'Không có giá trị',
}

export const DELAY_UNITS = ['seconds', 'minutes', 'hours', 'days'] as const
export type DelayUnit = (typeof DELAY_UNITS)[number]
export const DELAY_UNIT_LABELS: Record<string, string> = {
  seconds: 'Giây',
  minutes: 'Phút',
  hours: 'Giờ',
  days: 'Ngày',
}

// ─── Kiểu dữ liệu flowConfig (DAG) ────────────────────────────────────

export interface XY {
  x: number
  y: number
}

/** position là mở rộng của eCDP để lưu vị trí canvas, backend giữ nguyên JSON. */
export interface FlowTrigger {
  id: string
  type: string
  label: string
  config: Record<string, unknown>
  position?: XY
}

export type FlowNodeKind = 'action' | 'condition' | 'delay' | 'note'

export interface FlowNode {
  id: string
  type: FlowNodeKind
  actionType?: string
  label: string
  config: Record<string, unknown>
  status: 'active' | 'wip' | 'disabled'
  position?: XY
  branches?: { true: string[]; false: string[] }
}

export interface FlowEdge {
  source: string
  target: string
  label?: string
}

export interface FlowConfig {
  version: string
  trigger: FlowTrigger
  nodes: FlowNode[]
  edges: FlowEdge[]
  metadata?: Record<string, unknown>
}

// ─── Kiểu dữ liệu rule ────────────────────────────────────────────────

export interface AutomationRule {
  id: string
  orgId: string
  name: string
  description: string | null
  trigger: string
  conditions: unknown[]
  actions: unknown[]
  enabled: boolean
  priority: number
  flowVersion: number
  flowConfig: FlowConfig | null
  runCount: number
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateRuleInput {
  name: string
  trigger: string
  description?: string
  priority?: number
  enabled?: boolean
  flowVersion?: number
  flowConfig?: FlowConfig
}

// ─── Query hooks ──────────────────────────────────────────────────────

export function useAutomationRules() {
  return useQuery<{ rules: AutomationRule[] }>({
    queryKey: ['automation-rules'],
    queryFn: async () => {
      const { data } = await api.get('/automation/rules')
      return data
    },
  })
}

/** Lấy 1 rule từ cache danh sách (backend không có endpoint GET :id). */
export function useAutomationRule(id: string | undefined) {
  return useQuery<AutomationRule | undefined>({
    queryKey: ['automation-rule', id],
    queryFn: async () => {
      const { data } = await api.get<{ rules: AutomationRule[] }>('/automation/rules')
      return data.rules.find((r) => r.id === id)
    },
    enabled: !!id,
  })
}

// ─── Mutation hooks ───────────────────────────────────────────────────

export function useCreateRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateRuleInput) => {
      const { data } = await api.post<AutomationRule>('/automation/rules', input)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-rules'] }),
  })
}

export function useUpdateRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: string; data: Partial<CreateRuleInput> & { flowConfig?: FlowConfig } }) => {
      const { data } = await api.put<AutomationRule>(`/automation/rules/${vars.id}`, vars.data)
      return data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['automation-rules'] })
      qc.invalidateQueries({ queryKey: ['automation-rule', vars.id] })
    },
  })
}

export function useDeleteRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/automation/rules/${id}`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-rules'] }),
  })
}

// ─── Tiện ích ─────────────────────────────────────────────────────────

export function ruleStatusVariant(enabled: boolean): BadgeProps['variant'] {
  return enabled ? 'success' : 'secondary'
}

/** Tạo flowConfig rỗng với 1 node trigger. */
export function emptyFlowConfig(trigger: string): FlowConfig {
  return {
    version: '2',
    trigger: {
      id: 'trigger',
      type: trigger,
      label: triggerLabel(trigger),
      config: {},
      position: { x: 80, y: 200 },
    },
    nodes: [],
    edges: [],
  }
}

let idCounter = 0
export function genNodeId(prefix = 'node'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}
