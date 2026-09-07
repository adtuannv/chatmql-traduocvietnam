/**
 * use-chat-report.ts — Hook cho báo cáo "Hiệu quả Chat → Đơn hàng".
 *
 * GET /api/v1/reports/chat-to-order — API chỉ trả SỐ ĐẾM GỐC (revenue là VND
 * nguyên); mọi tỉ lệ (msgPerFriend, afterHoursPct, convRate, aiPct) và badge
 * trend so kỳ trước đều tính ở FE (xem chat-order-report.tsx).
 *
 * orders/revenue/aiOrders có thể là null: kỳ không có sự kiện lên đơn qua
 * ChatMQL và CRM cũng không phản hồi — khi đó FE hiện "—" + meta.salesNote.
 */
import { useApiQuery } from '@/hooks/use-api'

export interface ChatReportMetrics {
  friends: number
  msgIn: number
  afterHours: number
  chatters: number
  orders: number | null
  revenue: number | null
  aiOrders: number | null
}

export interface ChatReportTag {
  name: string
  color: string
  bg: string
  count: number
}

export interface ChatReportResult {
  label: string
  current: ChatReportMetrics
  previous?: ChatReportMetrics
  tags: ChatReportTag[]
  meta: {
    afterHoursWindow: string
    timezone: string
    salesNote?: string
    scopeNote?: string
  }
}

export type ChatReportPeriod = 'day' | 'week' | 'month' | 'custom'
export type ChatReportCompare = '7d' | 'month' | 'quarter' | 'year'

/** Chế độ đang chọn trên bộ lọc kỳ — đúng 3 nhánh của mock bàn giao. */
export type ChatReportMode =
  | { kind: 'period'; period: 'day' | 'week' | 'month' }
  | { kind: 'compare'; compare: ChatReportCompare }
  | { kind: 'custom'; from: string; to: string }

/** Phạm vi dữ liệu: nhóm kênh tương tác hoặc một tài khoản cụ thể (accountId thắng). */
export interface ChatReportScope {
  channel?: string // zalo_user | zalo_oa | facebook | ecommerce | other
  accountId?: string
}

function modeToParams(mode: ChatReportMode, scope?: ChatReportScope): Record<string, string> {
  const base: Record<string, string> =
    mode.kind === 'compare'
      ? { compare: mode.compare }
      : mode.kind === 'custom'
        ? { period: 'custom', from: mode.from, to: mode.to }
        : { period: mode.period }
  if (scope?.accountId) base.accountId = scope.accountId
  else if (scope?.channel) base.channel = scope.channel
  return base
}

export function useChatReport(mode: ChatReportMode, scope?: ChatReportScope) {
  const params = modeToParams(mode, scope)
  return useApiQuery<ChatReportResult>(['chat-report', params], '/reports/chat-to-order', params)
}
