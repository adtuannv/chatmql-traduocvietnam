/**
 * chat-order-report.tsx — Khối báo cáo "Hiệu quả Chat → Đơn hàng" (màn Tổng quan).
 *
 * Theo bàn giao `tong-quan-BAN-GIAO.md`, có một điều chỉnh so bản gốc:
 *  - Chỉ số 01 đổi từ "Số người đã kết bạn (trong kỳ)" → "Số liên hệ" = TỔNG
 *    liên hệ trong danh bạ hiện có, KHÔNG lọc theo kỳ. Zalo không cấp thời
 *    điểm kết bạn thật cho từng liên hệ (chỉ có lúc hệ thống ĐỒNG BỘ danh bạ),
 *    nên "kết bạn mới trong kỳ" là số bịa — một lần đồng bộ lại từng khiến
 *    báo cáo hiện "154 người kết bạn trong một ngày". Số liên hệ không có
 *    badge trend vì là ảnh chụp hiện tại (current = previous, so sánh vô nghĩa).
 *  - 10 chỉ số chia 2 nhóm (① Tương tác & Nhắn tin / ② Chuyển đổi đơn hàng),
 *    số thứ tự 01–12 theo nghiệp vụ (09, 10 chưa dùng).
 *  - Bộ lọc kỳ: Ngày / Tuần / Tháng (mặc định) / Kỳ (so sánh) ▾ / Tùy chỉnh ▾.
 *    Ở chế độ so sánh, mỗi thẻ hiện badge trend ▲/▼ % so kỳ trước.
 *  - Phễu Kết bạn → Nhắn tin → Đơn + tách đơn AI vs Nhân viên.
 *  - Biểu đồ Tin nhắn theo ngày (7 ngày, GET /dashboard/message-volume) và
 *    Tags theo hội thoại (thay Pipeline cũ).
 *
 * API chỉ trả số đếm gốc — mọi tỉ lệ và trend tính tại đây, định dạng vi-VN
 * (13.316 · 7,06 · 25,0% · doanh số VND → "1,31 tỷ"/"xxx tr").
 * orders/revenue/aiOrders = null → thẻ hiện "—" + dòng chú thích amber
 * (meta.salesNote); phễu và khối AI/NV tự ẩn phần đơn hàng.
 */
import { useState } from 'react'
import dayjs from 'dayjs'
import {
  ArrowDown, Bot, CalendarRange, ChevronDown, Handshake, MessageCircle, Moon,
  ShoppingCart, TrendingDown, TrendingUp, Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loading, ErrorState } from '@/components/shared/feedback'
import { useMessageVolume } from '@/hooks/use-analytics'
import { useZaloAccounts } from '@/hooks/use-integrations'
import { CHANNEL_GROUPS, groupOfPlatform, type ChannelGroupId } from '@/lib/channel-groups'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  useChatReport,
  type ChatReportCompare,
  type ChatReportMetrics,
  type ChatReportMode,
} from '@/hooks/use-chat-report'
import { cn, formatNumber } from '@/lib/utils'

// ── Định dạng vi-VN ─────────────────────────────────────────────────

/** 7,06 — hai số thập phân, dấu phẩy. */
function fmtDec2(n: number): string {
  return n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 25,0% — một số thập phân. Mẫu = 0 → "—" (không chia cho 0). */
function fmtPct1(numer: number, denom: number): string {
  if (!denom) return '—'
  return `${((numer / denom) * 100).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

/** VND nguyên → "1,31 tỷ" (≥ 1.000 triệu) hoặc "302 tr". */
function fmtRevenue(vnd: number): string {
  const trieu = vnd / 1_000_000
  if (trieu >= 1000) {
    return `${(trieu / 1000).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tỷ`
  }
  return `${formatNumber(Math.round(trieu))} tr`
}

/** % an toàn dạng số (cho width thanh tỉ lệ). */
function pctNum(numer: number, denom: number): number {
  if (!denom) return 0
  return Math.max(0, Math.min(100, (numer / denom) * 100))
}

// ── Trend so kỳ trước ───────────────────────────────────────────────

type MetricKey =
  | 'friends' | 'msgIn' | 'msgPerFriend' | 'afterHours' | 'afterHoursPct'
  | 'orders' | 'convRate' | 'revenue' | 'aiOrders' | 'aiPct'

/** 10 giá trị raw để so kỳ (đúng hàm raws() của mock bàn giao). */
function raws(d: ChatReportMetrics): Partial<Record<MetricKey, number>> {
  const r: Partial<Record<MetricKey, number>> = {
    friends: d.friends,
    msgIn: d.msgIn,
    afterHours: d.afterHours,
  }
  if (d.friends > 0) r.msgPerFriend = d.msgIn / d.friends
  if (d.msgIn > 0) r.afterHoursPct = d.afterHours / d.msgIn
  if (d.orders != null) {
    r.orders = d.orders
    if (d.msgIn > 0) r.convRate = d.orders / d.msgIn
  }
  if (d.revenue != null) r.revenue = d.revenue
  if (d.aiOrders != null) {
    r.aiOrders = d.aiOrders
    if (d.orders) r.aiPct = d.aiOrders / d.orders
  }
  return r
}

/** % thay đổi so kỳ trước — null khi thiếu dữ liệu hoặc kỳ trước = 0. */
function trendOf(
  key: MetricKey,
  cur?: Partial<Record<MetricKey, number>>,
  prev?: Partial<Record<MetricKey, number>>,
): number | null {
  const c = cur?.[key]
  const p = prev?.[key]
  if (c == null || p == null || !p) return null
  return ((c - p) / p) * 100
}

function TrendBadge({ change }: { change: number | null }) {
  if (change == null) return null
  const up = change >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span
      className={cn(
        'mt-1 inline-flex items-center gap-1 text-xs font-semibold',
        up ? 'text-success' : 'text-destructive',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {up ? '+' : '−'}
      {Math.abs(change).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
      % so kỳ trước
    </span>
  )
}

// ── Thẻ chỉ số ──────────────────────────────────────────────────────

function MetricCard({
  num, label, value, sub, icon: Icon, trend, barPct, accent = 'primary',
}: {
  num: string
  label: string
  value: string
  sub?: string
  icon?: typeof Handshake
  trend: number | null
  barPct?: number | null
  accent?: 'primary' | 'success' | 'warning' | 'destructive'
}) {
  const accentBorder = {
    primary: 'border-l-primary',
    success: 'border-l-success',
    warning: 'border-l-warning',
    destructive: 'border-l-destructive',
  }[accent]
  const accentIcon = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
  }[accent]
  const accentBar = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
  }[accent]

  return (
    <Card className={cn('relative border-l-4 p-4', accentBorder)}>
      <span className="absolute right-3 top-3 text-[11px] font-bold text-muted-foreground/50">{num}</span>
      <div className="flex items-center gap-2 pr-6 text-xs font-medium text-muted-foreground">
        {Icon && (
          <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', accentIcon)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      <TrendBadge change={trend} />
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
      {barPct != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full', accentBar)} style={{ width: `${barPct}%` }} />
        </div>
      )}
    </Card>
  )
}

// ── Bộ lọc kỳ ───────────────────────────────────────────────────────

const COMPARE_OPTIONS: { value: ChatReportCompare; label: string }[] = [
  { value: '7d', label: '7 ngày / 7 ngày trước' },
  { value: 'month', label: 'Tháng này / tháng trước' },
  { value: 'quarter', label: 'Quý này / quý trước' },
  { value: 'year', label: 'Năm nay / năm trước' },
]

function PeriodFilter({ mode, onChange }: { mode: ChatReportMode; onChange: (m: ChatReportMode) => void }) {
  const [customOpen, setCustomOpen] = useState(false)
  const [from, setFrom] = useState(dayjs().subtract(29, 'day').format('YYYY-MM-DD'))
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'))

  const segs: { key: 'day' | 'week' | 'month'; label: string }[] = [
    { key: 'day', label: 'Ngày' },
    { key: 'week', label: 'Tuần' },
    { key: 'month', label: 'Tháng' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-md border">
        {segs.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange({ kind: 'period', period: s.key })}
            className={cn(
              'px-3 py-1.5 text-xs font-semibold transition-colors',
              mode.kind === 'period' && mode.period === s.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={mode.kind === 'compare' ? 'default' : 'outline'} size="sm">
            Kỳ (so sánh)
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[230px]">
          {COMPARE_OPTIONS.map((o) => (
            <DropdownMenuItem
              key={o.value}
              className={cn(
                mode.kind === 'compare' && mode.compare === o.value && 'bg-primary/10 font-semibold text-primary',
              )}
              onSelect={() => onChange({ kind: 'compare', compare: o.value })}
            >
              {o.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu open={customOpen} onOpenChange={setCustomOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant={mode.kind === 'custom' ? 'default' : 'outline'} size="sm">
            <CalendarRange className="h-3.5 w-3.5" />
            Tùy chỉnh
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[250px] p-3">
          <div className="space-y-2">
            <div>
              <Label className="text-xs text-muted-foreground">Từ ngày</Label>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Đến ngày</Label>
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-1" />
            </div>
            <Button
              className="w-full"
              size="sm"
              disabled={!from || !to || from > to}
              onClick={() => {
                onChange({ kind: 'custom', from, to })
                setCustomOpen(false)
              }}
            >
              Áp dụng
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ── Biểu đồ tin nhắn theo ngày (div thuần, màu theo token) ──────────

const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

function MessageVolumeChart({ scope }: { scope?: { channel?: string; accountId?: string } }) {
  const { data, isLoading } = useMessageVolume(scope)
  if (isLoading) return <Loading />
  const days = data?.data ?? []
  const max = Math.max(1, ...days.map((d) => Math.max(d.sent, d.received)))
  const total = days.reduce((s, d) => s + d.sent + d.received, 0)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-sm">Tin nhắn theo ngày</CardTitle>
          <CardDescription className="mt-0.5 text-xs">
            7 ngày gần nhất · Tổng {formatNumber(total)} tin
          </CardDescription>
        </div>
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-primary" />
            Đã gửi
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-primary/35" />
            Đã nhận
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex h-44 items-end justify-between gap-2 pt-2">
          {days.map((d) => (
            <div key={d.date} className="flex h-full flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full flex-1 items-end justify-center gap-1">
                <div
                  className="w-2.5 rounded-t-sm bg-primary"
                  style={{ height: `${Math.round((d.sent / max) * 100)}%` }}
                  title={`Đã gửi: ${formatNumber(d.sent)}`}
                />
                <div
                  className="w-2.5 rounded-t-sm bg-primary/35"
                  style={{ height: `${Math.round((d.received / max) * 100)}%` }}
                  title={`Đã nhận: ${formatNumber(d.received)}`}
                />
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground">
                {DAY_LABELS[dayjs(d.date).day()]}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Khối chính ──────────────────────────────────────────────────────

const ALL_SCOPE = '__all__'

export function ChatOrderReport() {
  const [mode, setMode] = useState<ChatReportMode>({ kind: 'period', period: 'month' })
  // Phạm vi: nhóm kênh tương tác + tài khoản cụ thể — để số liệu đúng nơi cần xem.
  const [channel, setChannel] = useState<string>(ALL_SCOPE)
  const [accountId, setAccountId] = useState<string>(ALL_SCOPE)
  const accountsQ = useZaloAccounts()
  const accounts = (accountsQ.data ?? []).filter(
    (a) => channel === ALL_SCOPE || groupOfPlatform(a.platform) === (channel as ChannelGroupId),
  )
  const scope = {
    channel: channel === ALL_SCOPE ? undefined : channel,
    accountId: accountId === ALL_SCOPE ? undefined : accountId,
  }
  const { data, isLoading, isError } = useChatReport(mode, scope)

  if (isError) return <ErrorState message="Không tải được báo cáo Chat → Đơn hàng" />

  const cur = data?.current
  const prev = data?.previous
  const curRaws = cur ? raws(cur) : undefined
  const prevRaws = prev ? raws(prev) : undefined
  const t = (k: MetricKey) => trendOf(k, curRaws, prevRaws)

  const hasOrders = cur != null && cur.orders != null
  const staffOrders = hasOrders && cur.aiOrders != null ? (cur.orders ?? 0) - cur.aiOrders : null
  const aiSharePct = hasOrders && cur.orders ? pctNum(cur.aiOrders ?? 0, cur.orders) : 0
  const tags = data?.tags ?? []
  const maxTag = Math.max(1, ...tags.map((x) => x.count))

  return (
    <div className="space-y-4">
      {/* Tiêu đề + bộ lọc kỳ */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="border-l-4 border-primary pl-3 text-base font-bold">
          Báo cáo hiệu quả Chat → Đơn hàng
        </h2>
        <span className="text-xs text-muted-foreground">Kỳ: {data?.label ?? '…'}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Kênh tương tác — đổi kênh thì reset tài khoản để không lệch phạm vi */}
          <Select
            value={channel}
            onValueChange={(v) => { setChannel(v); setAccountId(ALL_SCOPE) }}
          >
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SCOPE}>Tất cả kênh</SelectItem>
              {CHANNEL_GROUPS.filter((g) => g.id !== 'other').map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
              ))}
              <SelectItem value="other">Khác (Web chat…)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SCOPE}>Tất cả tài khoản</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.displayName || 'Không tên'}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PeriodFilter mode={mode} onChange={setMode} />
        </div>
      </div>

      {data?.meta.scopeNote && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          {data.meta.scopeNote}
        </p>
      )}

      {isLoading || !cur ? (
        <Loading />
      ) : (
        <>
          {/* ① Tương tác & Nhắn tin */}
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            ① Tương tác &amp; Nhắn tin
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <MetricCard num="01" label="Số liên hệ" icon={Users} accent="primary"
              value={formatNumber(cur.friends)} sub="tổng liên hệ trong danh bạ" trend={null} />
            <MetricCard num="02" label="Số tin nhắn đến" icon={MessageCircle} accent="primary"
              value={formatNumber(cur.msgIn)} sub="tin khách gửi vào" trend={t('msgIn')} />
            <MetricCard num="06" label="Tỉ trọng tin nhắn / liên hệ" icon={TrendingUp} accent="primary"
              value={cur.friends ? fmtDec2(cur.msgIn / cur.friends) : '—'}
              sub="lượt nhắn / liên hệ trong danh bạ" trend={t('msgPerFriend')} />
            <MetricCard num="07" label="Nhắn tin đến ngoài giờ" icon={Moon} accent="warning"
              value={formatNumber(cur.afterHours)}
              sub={`ngoài khung ${data?.meta.afterHoursWindow ?? '08:00–18:00'}`} trend={t('afterHours')} />
            <MetricCard num="08" label="Tỉ trọng nhắn tin ngoài giờ" icon={Moon} accent="warning"
              value={fmtPct1(cur.afterHours, cur.msgIn)} sub="trên tổng tin nhắn đến"
              trend={t('afterHoursPct')} barPct={pctNum(cur.afterHours, cur.msgIn)} />
          </div>

          {/* ② Chuyển đổi đơn hàng */}
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            ② Chuyển đổi đơn hàng
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <MetricCard num="03" label="Đơn hàng từ tin nhắn" icon={ShoppingCart} accent="success"
              value={cur.orders != null ? formatNumber(cur.orders) : '—'}
              sub="đơn chốt qua chat" trend={t('orders')} />
            <MetricCard num="04" label="Tỉ lệ đơn / tin nhắn đến" icon={ShoppingCart} accent="success"
              value={cur.orders != null ? fmtPct1(cur.orders, cur.msgIn) : '—'}
              sub={cur.orders != null ? `${formatNumber(cur.orders)} đơn / ${formatNumber(cur.msgIn)} tin` : undefined}
              trend={t('convRate')}
              barPct={cur.orders != null ? Math.min(100, pctNum(cur.orders, cur.msgIn) * 5) : null} />
            <MetricCard num="05" label="Doanh số từ tin nhắn" icon={TrendingUp} accent="success"
              value={cur.revenue != null ? fmtRevenue(cur.revenue) : '—'}
              sub={
                cur.revenue != null && cur.orders
                  ? `TB ${formatNumber(Math.round(cur.revenue / cur.orders))}đ / đơn`
                  : undefined
              }
              trend={t('revenue')} />
            <MetricCard num="11" label="Đơn hàng đến từ AI" icon={Bot} accent="primary"
              value={cur.aiOrders != null ? formatNumber(cur.aiOrders) : '—'}
              sub="AI tư vấn & chốt tự động" trend={t('aiOrders')} />
            <MetricCard num="12" label="Tỉ trọng đơn AI chốt" icon={Bot} accent="primary"
              value={cur.aiOrders != null && cur.orders ? fmtPct1(cur.aiOrders, cur.orders) : '—'}
              sub={
                cur.aiOrders != null && cur.orders != null
                  ? `${formatNumber(cur.aiOrders)} / ${formatNumber(cur.orders)} đơn từ chat`
                  : undefined
              }
              trend={t('aiPct')} barPct={cur.aiOrders != null && cur.orders ? aiSharePct : null} />
          </div>

          {data?.meta.salesNote && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              {data.meta.salesNote}
            </p>
          )}

          {/* Phễu + AI vs Nhân viên */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Phễu chuyển đổi</CardTitle>
                <CardDescription className="text-xs">Liên hệ → Nhắn tin → Đơn hàng</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-3 rounded-lg bg-primary p-3 text-primary-foreground">
                  <Users className="h-5 w-5" />
                  <div>
                    <p className="text-xs font-medium opacity-90">Liên hệ</p>
                    <p className="text-lg font-bold tabular-nums">{formatNumber(cur.friends)}</p>
                  </div>
                </div>
                <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                  <ArrowDown className="h-3 w-3" />
                  {fmtPct1(cur.chatters, cur.friends)} có nhắn tin
                </p>
                <div className="flex items-center gap-3 rounded-lg bg-primary/80 p-3 text-primary-foreground">
                  <Users className="h-5 w-5" />
                  <div>
                    <p className="text-xs font-medium opacity-90">Người có nhắn tin</p>
                    <p className="text-lg font-bold tabular-nums">{formatNumber(cur.chatters)}</p>
                  </div>
                </div>
                {hasOrders ? (
                  <>
                    <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                      <ArrowDown className="h-3 w-3" />
                      {fmtPct1(cur.orders ?? 0, cur.chatters)} ra đơn
                    </p>
                    <div className="flex items-center gap-3 rounded-lg bg-success p-3 text-success-foreground">
                      <ShoppingCart className="h-5 w-5" />
                      <div className="flex-1">
                        <p className="text-xs font-medium opacity-90">Đơn hàng chốt</p>
                        <p className="text-lg font-bold tabular-nums">{formatNumber(cur.orders ?? 0)}</p>
                      </div>
                      {cur.revenue != null && (
                        <span className="rounded-full bg-success-foreground/20 px-3 py-1 text-xs font-bold">
                          {fmtRevenue(cur.revenue)}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="rounded-lg bg-muted p-3 text-center text-xs text-muted-foreground">
                    Chưa có dữ liệu đơn hàng trong kỳ này
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Đơn hàng: AI vs Nhân viên</CardTitle>
                <CardDescription className="text-xs">Nguồn chốt đơn qua chat</CardDescription>
              </CardHeader>
              <CardContent>
                {hasOrders && staffOrders != null && (cur.orders ?? 0) > 0 ? (
                  <>
                    <div className="mb-3 flex h-4 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${aiSharePct}%` }} />
                      <div className="h-full bg-success" style={{ width: `${100 - aiSharePct}%` }} />
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
                        AI chốt tự động
                        <b className="ml-auto tabular-nums">{formatNumber(cur.aiOrders ?? 0)}</b>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm bg-success" />
                        Nhân viên chốt
                        <b className="ml-auto tabular-nums">{formatNumber(staffOrders)}</b>
                      </div>
                    </div>
                    <p className="mt-3 rounded-md bg-muted p-2.5 text-xs leading-relaxed text-muted-foreground">
                      <Bot className="mr-1 inline h-3.5 w-3.5" />
                      AI đang đảm nhận <b>{fmtPct1(cur.aiOrders ?? 0, cur.orders ?? 0)}</b> lượng đơn chốt
                      qua chat trong kỳ.
                    </p>
                  </>
                ) : (
                  <p className="rounded-lg bg-muted p-3 text-center text-xs text-muted-foreground">
                    Chưa có dữ liệu đơn hàng để tách nguồn AI / Nhân viên
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Biểu đồ */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
            <MessageVolumeChart scope={scope} />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Tags theo hội thoại</CardTitle>
                <CardDescription className="text-xs">
                  Nhãn gắn trên hội thoại có tương tác trong kỳ
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {tags.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Chưa có hội thoại gắn tag trong kỳ này
                  </p>
                ) : (
                  tags.map((tag) => (
                    <div key={tag.name} className="flex items-center gap-2.5">
                      {/* Chip dùng đúng màu của tag (dữ liệu từ danh sách tag của org) */}
                      <span
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{ color: tag.color, backgroundColor: tag.bg }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                        {tag.name}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(4, (tag.count / maxTag) * 100)}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-xs font-bold tabular-nums">
                        {formatNumber(tag.count)}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
