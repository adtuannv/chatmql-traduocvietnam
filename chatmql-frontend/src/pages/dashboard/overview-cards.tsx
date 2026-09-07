/**
 * overview-cards.tsx — Khối "Kinh doanh" trên Dashboard từ GET /dashboard/overview.
 *
 * Port từ `order-ui-bridge.js` (renderDashboard / dashCard / dashBars):
 * KPI doanh thu (CRM) + hội thoại, cột doanh thu 14 ngày, nhân sự bán hàng,
 * trạng thái đơn. Nhân viên (member) chỉ thấy phần của mình; chủ/quản trị/quản
 * lý thấy toàn công ty — backend đã trả sẵn `sales.org` / `sales.mine` và `role`.
 */
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, CalendarRange, CircleDollarSign, Inbox, MailOpen, MessageSquare,
  MessageSquareWarning, RefreshCw, TrendingUp, UserCheck, Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/shared/stat-card'
import { Loading, ErrorState } from '@/components/shared/feedback'
import { api, apiError } from '@/lib/api-client'
import { cn, formatNumber } from '@/lib/utils'

// ── Kiểu dữ liệu (khớp dashboard-routes.ts + crm-order-client.ts) ───

export interface SalesPeriod { orders: number; gmv: number; aov: number }
export interface SalesScope {
  today: SalesPeriod
  yesterday: SalesPeriod
  week: SalesPeriod
  month: SalesPeriod
  daily: Array<{ date: string; orders: number; gmv: number }>
  by_status: Array<{ status: string; orders: number }>
  customers: number
  by_staff?: Array<{ name: string; orders: number; gmv: number }>
  staff_name?: string
}
export interface DashboardOverview {
  conversations: {
    unrepliedConversations: number
    unreadConversations: number
    unreadMessages: number
    messagesToday: number
  }
  me: { repliesToday: number; unrepliedAssigned: number }
  contacts: { total: number; newThisWeek: number }
  appointmentsToday: number
  sales: { org: SalesScope; mine: SalesScope | null } | null
  salesError: string | null
  defaultScope: 'org' | 'mine'
  role: string
}

export const dashboardOverviewKey = ['dashboard', 'overview'] as const

export function useDashboardOverview() {
  return useQuery<DashboardOverview>({
    queryKey: dashboardOverviewKey,
    queryFn: async () => (await api.get<DashboardOverview>('/dashboard/overview')).data,
    refetchInterval: 60_000,
  })
}

/** Rút gọn tiền: 1,2 tỷ · 350 tr · 12.000đ */
export function formatMoneyShort(v: number | null | undefined): string {
  const n = Number(v) || 0
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2).replace(/\.?0+$/, '')} tỷ`
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} tr`
  return `${formatNumber(n)}đ`
}

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export function OverviewCards() {
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboardOverview()

  if (isLoading) return <Loading label="Đang tải số liệu..." />
  if (isError || !data) return <ErrorState message={apiError(error)} />

  const isBoss = data.defaultScope === 'org' || ['owner', 'admin', 'manager'].includes(data.role)
  const s = data.sales ? (isBoss ? data.sales.org : data.sales.mine || data.sales.org) : null
  const scopeLabel = isBoss ? 'toàn công ty' : 'của tôi'
  const c = data.conversations

  const gap = s ? s.today.gmv - s.yesterday.gmv : 0
  const trend = !s
    ? ''
    : gap === 0
      ? 'bằng hôm qua'
      : gap > 0
        ? `▲ ${formatMoneyShort(gap)} so với hôm qua`
        : `▼ ${formatMoneyShort(-gap)} so với hôm qua`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-base font-semibold">Kinh doanh</h2>
        <span className="text-xs text-muted-foreground">Số liệu {scopeLabel} · lấy trực tiếp từ CRM</span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn(isFetching && 'animate-spin')} /> Làm mới
        </Button>
      </div>

      {s ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Doanh thu hôm nay"
            value={formatMoneyShort(s.today.gmv)}
            icon={CircleDollarSign}
            tone="success"
            hint={`${formatNumber(s.today.orders)} đơn · ${trend}`}
          />
          <StatCard
            label="Doanh thu 7 ngày"
            value={formatMoneyShort(s.week.gmv)}
            icon={TrendingUp}
            tone="success"
            hint={`${formatNumber(s.week.orders)} đơn · TB ${formatMoneyShort(s.week.aov)}/đơn`}
          />
          <StatCard
            label="Doanh thu tháng này"
            value={formatMoneyShort(s.month.gmv)}
            icon={CalendarRange}
            tone="success"
            hint={`${formatNumber(s.month.orders)} đơn`}
          />
          <StatCard
            label={isBoss ? 'Khách hàng CRM' : 'Khách tôi phụ trách'}
            value={s.customers}
            icon={Users}
            hint={isBoss ? `${formatNumber(data.contacts.newThisWeek)} liên hệ mới trong 7 ngày` : 'đang được giao cho tôi'}
          />
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>Chưa lấy được số liệu bán hàng từ CRM: {data.salesError || 'không rõ'}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Hội thoại chờ trả lời"
          value={c.unrepliedConversations}
          icon={MessageSquareWarning}
          tone="warning"
          hint="khách nhắn nhưng chưa ai trả lời"
        />
        <StatCard
          label="Hội thoại chưa đọc"
          value={c.unreadConversations}
          icon={MailOpen}
          tone="warning"
          hint={`${formatNumber(c.unreadMessages)} tin nhắn chưa xem`}
        />
        <StatCard label="Tin nhắn hôm nay" value={c.messagesToday} icon={MessageSquare} hint="cả gửi và nhận" />
        <StatCard
          label="Việc của tôi hôm nay"
          value={data.me.repliesToday}
          icon={UserCheck}
          hint={`${formatNumber(data.me.unrepliedAssigned)} hội thoại được gán còn chờ`}
        />
      </div>

      {s && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Doanh thu 14 ngày</CardTitle>
            </CardHeader>
            <CardContent>
              <DailyBars daily={s.daily} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              {isBoss && (
                <div>
                  <p className="mb-2 text-sm font-semibold">Nhân sự bán hàng · 7 ngày</p>
                  {s.by_staff?.length ? (
                    <ul className="divide-y">
                      {s.by_staff.slice(0, 6).map((st) => (
                        <li key={st.name} className="flex items-center gap-2 py-1.5 text-sm">
                          <span className="min-w-0 flex-1 truncate">{st.name}</span>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatNumber(st.orders)} đơn
                          </span>
                          <span className="whitespace-nowrap font-semibold text-success">
                            {formatMoneyShort(st.gmv)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">Chưa có đơn nào trong 7 ngày.</p>
                  )}
                </div>
              )}
              <div>
                <p className="mb-2 text-sm font-semibold">Trạng thái đơn {scopeLabel} · 30 ngày</p>
                {s.by_status.length ? (
                  <ul className="space-y-1">
                    {s.by_status.map((st) => (
                      <li key={st.status} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{st.status}</span>
                        <b className="tabular-nums">{formatNumber(st.orders)}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Inbox className="h-4 w-4" /> Chưa có đơn nào trong 30 ngày.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

/** Cột doanh thu theo ngày — div thuần, màu qua token. */
function DailyBars({ daily }: { daily: SalesScope['daily'] }) {
  if (!daily?.length) return <p className="text-sm text-muted-foreground">Chưa có dữ liệu.</p>
  const max = Math.max(1, ...daily.map((d) => d.gmv))
  return (
    <div className="flex items-end gap-1">
      {daily.map((d) => {
        const pct = Math.round((d.gmv / max) * 100)
        return (
          <div
            key={d.date}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
            title={`${fmtDay(d.date)}: ${formatNumber(d.orders)} đơn · ${formatMoneyShort(d.gmv)}`}
          >
            <div className="flex h-[70px] w-full items-end">
              <div
                className={cn('w-full rounded-t-sm transition-all', d.gmv > 0 ? 'bg-primary' : 'bg-muted')}
                style={{ height: `${Math.max(pct, d.gmv > 0 ? 4 : 2)}%` }}
              />
            </div>
            <span className="whitespace-nowrap text-[9px] text-muted-foreground">{fmtDay(d.date)}</span>
          </div>
        )
      })}
    </div>
  )
}
