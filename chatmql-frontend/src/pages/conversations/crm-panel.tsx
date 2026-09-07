/**
 * crm-panel.tsx — Cột phải màn Hội thoại phiên bản Trà Dược (TDVN).
 *
 * Port từ script chèn DOM `order-ui-bridge.js` (renderCustomerCard,
 * renderNotesPanel, renderOrderPanel, renderSalesDocsSidebar) sang React.
 *
 * Bố cục:
 *   ┌ Header dính: avatar · tên · mã KH · SĐT
 *   ├ Thanh tab: Thông tin | Tạo đơn | Sản phẩm  (Ghi chú nhanh vào bằng nút)
 *   └ Nội dung tab
 *       • Thông tin   — số liệu CRM, lưới trường, thiệp sinh nhật, 2 nút dính đáy
 *       • Ghi chú nhanh — ghi chú theo hội thoại + trạng thái tương tác
 *       • Tạo đơn     — `orderSlot` (form do cha truyền) + đơn gần đây
 *       • Sản phẩm    — thẻ hàng ngang, gửi khách link Mini App
 *       • Tài liệu bán hàng — kho tài liệu ĐÃ DUYỆT, chọn nhiều, gửi vào chat
 *
 * Khách chưa có SĐT (backend trả 400) là tình trạng bình thường, KHÔNG toast
 * lỗi — hướng dẫn nhân viên sang tab Tạo đơn nhập số.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft, Cake, History, NotebookPen, RefreshCw, Save, ShoppingCart, Sparkles, Users,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/misc'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { EmptyState, ErrorState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { cn, initials } from '@/lib/utils'
import {
  refreshGroupMembers, useGroupMembers, type ConversationDetail, type GroupMember,
} from '@/hooks/use-conversations'
import {
  formatCombinedVip, formatDateVi, formatVnd, orderStatusVariant,
  useCustomerOrders, useCustomerPoints, useCustomerProfile,
  type CrmCustomer, type CrmOrder, type CustomerProfile,
} from '@/hooks/use-orders'
import {
  noteToneVariant, useConversationNotes, useCreateQuickNote, useNoteStatuses,
} from '@/hooks/use-quick-notes'
import { ProductTab } from './product-tab'
import { CustomerProfileDrawer } from './customer-profile-drawer'
import { Customer360Dialog } from './customer-360-dialog'

export type CrmTab = 'info' | 'notes' | 'order' | 'products'

/**
 * Ghi chú nhanh KHÔNG nằm ở đây: bốn tab làm thanh tab chật và chữ bị cắt.
 * Lối vào là nút hình ghi chú cạnh nút đồng bộ trong tab Thông tin.
 */
const TABS: Array<{ id: CrmTab; label: string }> = [
  { id: 'info', label: 'Thông tin' },
  { id: 'order', label: 'Tạo đơn' },
  { id: 'products', label: 'Sản phẩm' },
]

const UNNAMED = 'Khách chưa định danh'

// ══════════════════════════════════════════════════════════════════════
export function CrmPanel({
  convId, conv, activeTab, onTabChange, orderSlot,
}: {
  convId: string
  conv?: ConversationDetail
  activeTab: CrmTab
  onTabChange: (t: CrmTab) => void
  orderSlot: React.ReactNode
}) {
  // Nhóm Zalo hoặc hội thoại chưa gắn contact — không có "một khách" để tra CRM.
  const isGroup = !!conv && (conv.threadType === 'group' || !conv.contact)

  // Hook luôn ở đầu, trước mọi return sớm (bẫy #6).
  const profileQ = useCustomerProfile(isGroup ? undefined : convId)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [c360Open, setC360Open] = useState(false)

  const profile = profileQ.data?.status === 'ok' ? profileQ.data.profile : null
  const crm = profile?.crm ?? null
  const phone = profile?.phone || conv?.contact?.phone || ''
  const name =
    crm?.full_name ||
    profile?.chatmql?.crmName ||
    (profileQ.data?.status === 'no_phone' ? profileQ.data.contact?.name : null) ||
    conv?.contact?.fullName ||
    conv?.displayName ||
    UNNAMED

  const headerMeta = isGroup
    ? 'Hội thoại nhóm'
    : profileQ.data?.status === 'no_phone'
      ? 'Chưa liên kết hồ sơ CRM'
      : `${crm?.customer_code ? `${crm.customer_code} · ` : ''}SĐT: ${phone || '—'}`

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* ── Header dính + thanh tab ── */}
      <div className="sticky top-0 z-20 border-b bg-card shadow-sm">
        <div className="flex h-[62px] items-center gap-2.5 px-4">
          <Avatar className="h-[38px] w-[38px]">
            {conv?.contact?.avatarUrl && <AvatarImage src={conv.contact.avatarUrl} alt={name} />}
            <AvatarFallback className="text-[13px]">{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-bold">{name}</div>
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{headerMeta}</div>
          </div>
        </div>
        <div data-tour="crm-tabs" className="flex items-center gap-3 px-3.5">
          {TABS.map((t) => (
            <div key={t.id} className="contents">
              <button
                type="button"
                onClick={() => onTabChange(t.id)}
                className={cn(
                  '-mb-px whitespace-nowrap border-b-2 border-transparent py-2.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground',
                  activeTab === t.id && 'border-primary font-semibold text-primary',
                )}
              >
                {t.label}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Nội dung tab ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'info' && (
          isGroup ? (
            <GroupMembersPanel convId={convId} />
          ) : (
            <InfoTab
              query={profileQ}
              name={name}
              onGoOrder={() => onTabChange('order')}
              onGoNotes={() => onTabChange('notes')}
              onOpenProfile={() => setDrawerOpen(true)}
              onOpenC360={() => setC360Open(true)}
            />
          )
        )}
        {activeTab === 'notes' && (
          <div>
            {/* Ghi chú không còn ở thanh tab nên phải có đường quay lại. */}
            <div className="border-b px-3 py-2">
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onTabChange('info')}>
                <ArrowLeft className="h-3.5 w-3.5" /> Thông tin khách
              </Button>
            </div>
            <QuickNotesTab convId={convId} contactId={conv?.contact?.id} />
          </div>
        )}
        {activeTab === 'order' && (
          <div>
            {orderSlot}
            <RecentOrders phone={isGroup ? '' : phone} />
          </div>
        )}
        {activeTab === 'products' && <ProductTab convId={convId} />}
      </div>

      <CustomerProfileDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        convId={convId}
        phone={phone}
        name={name}
      />
      <Customer360Dialog open={c360Open} onOpenChange={setC360Open} convId={convId} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Tab "Thông tin"
// ══════════════════════════════════════════════════════════════════════
function InfoTab({
  query, name, onGoOrder, onGoNotes, onOpenProfile, onOpenC360,
}: {
  query: ReturnType<typeof useCustomerProfile>
  name: string
  onGoOrder: () => void
  onGoNotes: () => void
  onOpenProfile: () => void
  onOpenC360: () => void
}) {
  if (query.isLoading) return <Loading label="Đang tải thông tin khách…" />
  if (query.isError) return <ErrorState message={`Không tải được thông tin khách: ${apiError(query.error)}`} />
  if (!query.data) return null

  if (query.data.status === 'no_phone') {
    return (
      <div className="space-y-3 p-4">
        <div className="rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          ☎️ <b className="text-foreground">Khách này chưa có số điện thoại.</b>
          <br />
          Hồ sơ CRM tra theo số điện thoại, nên chưa có số thì chưa hiện được lịch sử mua hàng,
          điểm tích luỹ và ưu đãi.
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Nhập số ở tab <b className="text-foreground">Tạo đơn</b> rồi lên đơn — hệ thống sẽ tự lưu
          số vào hồ sơ khách, lần sau mở lại là có đủ thông tin.
        </p>
        <Button className="w-full" onClick={onGoOrder}>
          <ShoppingCart /> Sang tab Tạo đơn
        </Button>
      </div>
    )
  }

  return (
    <CrmInfo
      profile={query.data.profile}
      name={name}
      refreshing={query.isFetching}
      onRefresh={() => query.refetch()}
      onGoNotes={onGoNotes}
      onOpenProfile={onOpenProfile}
      onOpenC360={onOpenC360}
    />
  )
}

function CrmInfo({
  profile, name, refreshing, onRefresh, onGoNotes, onOpenProfile, onOpenC360,
}: {
  profile: CustomerProfile
  name: string
  refreshing: boolean
  onRefresh: () => void
  onGoNotes: () => void
  onOpenProfile: () => void
  onOpenC360: () => void
}) {
  const crm: CrmCustomer = profile.crm ?? {}
  const chat = profile.chatmql
  const phone = profile.phone
  const pointsQ = useCustomerPoints(phone)

  const notesCount = useMemo(
    () => (crm.profile_note || '').split('\n').filter((l) => /ngày \d/.test(l)).length,
    [crm.profile_note],
  )
  const points = pointsQ.data ? String(pointsQ.data.balance ?? 0) : '—'
  const vipRank = formatCombinedVip(crm)

  const fields: Array<{ label: string; value: string | null | undefined; full?: boolean; cls?: string }> = [
    { label: 'Mã khách hàng', value: crm.customer_code },
    { label: 'Số điện thoại', value: phone },
    { label: 'SĐT liên hệ khác', value: crm.phone2 },
    { label: 'Người phụ trách', value: crm.staff_in_charge, cls: 'text-primary' },
    { label: 'Điểm', value: points, cls: 'text-success' },
    { label: 'Tổng chi tiêu', value: crm.gmv_total != null ? formatVnd(crm.gmv_total) : null },
    { label: 'Nghề nghiệp', value: crm.occupation },
    { label: 'Nhóm KH', value: crm.nhom_kh || crm.priority_level },
    { label: 'Giới tính', value: crm.gender },
    { label: 'Ngày sinh', value: formatDateVi(crm.birthday) },
    { label: 'Email', value: chat?.email },
    { label: 'Lead score', value: chat?.leadScore != null ? `${chat.leadScore}/100` : null },
    { label: 'Nguồn khách hàng', value: crm.referral_source || chat?.source, full: true },
    { label: 'Gu trà / thích dùng hàng', value: crm.thich_dung_hang, full: true },
    { label: 'Nhu cầu sử dụng', value: crm.nhu_cau_sd, full: true },
    { label: 'Tần suất mua', value: crm.purchase_frequency, full: true },
    { label: 'Địa chỉ', value: crm.address, full: true },
    { label: 'Địa chỉ 2', value: crm.address2, full: true },
  ]

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pb-4 pt-3.5">
        <div data-tour="crm-head" className="mb-2.5 flex items-center gap-2">
          <span className="shrink-0 text-[11.5px] font-bold tracking-wide text-muted-foreground">THÔNG TIN TỪ CRM</span>
          {/* Hạng hội viên quyết định cách xưng hô và mức ưu đãi, nên đặt ngay
              cạnh tiêu đề thay vì nằm lẫn trong lưới hai chục trường. */}
          {vipRank && vipRank !== '—' && (
            <Badge variant="secondary" className="h-[18px] shrink-0 px-1.5 text-[10px] font-bold tracking-wide">
              {vipRank}
            </Badge>
          )}
          <div className="ml-auto flex shrink-0 items-center">
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              title={`Ghi chú nhanh${notesCount ? ` (${notesCount})` : ''}`} onClick={onGoNotes}
            >
              <NotebookPen className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-7 w-7"
              title="Đồng bộ lại từ CRM" onClick={onRefresh} disabled={refreshing}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* 4 ô số liệu */}
        <div data-tour="crm-stats" className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
          <StatTile label="Lịch bán hàng" value={formatDateVi(crm.next_sales_at) ?? '—'} />
          <StatTile label="Lịch chăm sóc" value={formatDateVi(crm.next_care_at) ?? '—'} />
          <StatTile label="Số đơn" value={String(crm.order_count ?? profile.orders.length ?? 0)} />
          <StatTile label="Ghi chú" value={String(notesCount)} />
        </div>

        {/* Lưới trường CRM */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          {fields.map((f) => (
            <div key={f.label} className={cn('min-w-0', f.full && 'col-span-2')}>
              <span className="block text-[11px] font-semibold text-muted-foreground">{f.label}</span>
              <b className={cn('mt-px block break-words text-[12.5px] font-semibold', f.cls)}>
                {f.value?.toString().trim() || '—'}
              </b>
            </div>
          ))}
        </div>
      </div>

      <BirthdayCard birthday={crm.birthday} name={name} />

      {/* Nút dính đáy */}
      <div data-tour="crm-actions" className="sticky bottom-0 z-10 mt-auto flex flex-col gap-2 border-t bg-card px-3.5 py-2.5 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <Button variant="outline" className="h-[38px] w-full" onClick={onOpenProfile}>
          <History /> Xem hồ sơ lịch sử mua hàng
        </Button>
        <Button className="h-10 w-full font-bold" onClick={onOpenC360}>
          <Sparkles /> Phân tích khách hàng (AI)
        </Button>
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-3 py-2">
      <span className="block text-[11px] font-semibold text-muted-foreground">{label}</span>
      <b className="mt-0.5 block text-[13.5px]">{value}</b>
    </div>
  )
}

/**
 * Thiệp sinh nhật — chỉ hiện khi sinh nhật rơi vào 30 ngày tới. Bỏ qua 01/01
 * vì đó là giá trị CRM điền mặc định khi không biết ngày thật.
 */
function BirthdayCard({ birthday, name }: { birthday?: string | null; name: string }) {
  const info = useMemo(() => {
    if (!birthday) return null
    const b = new Date(birthday)
    if (Number.isNaN(b.getTime())) return null
    const mm = b.getMonth()
    const dd = b.getDate()
    if (mm === 0 && dd === 1) return null
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const next = new Date(now.getFullYear(), mm, dd)
    if (next < today) next.setFullYear(now.getFullYear() + 1)
    const days = Math.round((next.getTime() - today.getTime()) / 86_400_000)
    if (days > 30) return null
    return { days, label: `${String(dd).padStart(2, '0')}/${String(mm + 1).padStart(2, '0')}` }
  }, [birthday])

  if (!info) return null
  return (
    <div className="mx-4 mb-4 overflow-hidden rounded-xl border shadow-sm">
      <div className="flex items-center gap-3 bg-gradient-to-br from-warning/80 via-destructive/60 to-primary/80 px-4 py-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-primary-foreground/70 bg-background/30 text-xl">
          <Cake className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-primary-foreground drop-shadow">{name}</div>
          <div className="text-xs font-semibold text-primary-foreground/90">
            🎂 {info.label} · {info.days === 0 ? 'hôm nay' : `còn ${info.days} ngày`}
          </div>
        </div>
      </div>
      <div className="bg-warning/10 px-4 py-2.5 text-xs font-medium text-warning-foreground">
        Gợi ý: gửi lời chúc kèm ưu đãi sinh nhật cho khách.
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Tab "Ghi chú nhanh"
// ══════════════════════════════════════════════════════════════════════
const NO_STATUS = '__none__'

function QuickNotesTab({ convId, contactId }: { convId: string; contactId?: string | null }) {
  const notesQ = useConversationNotes(convId)
  const statusesQ = useNoteStatuses()
  const create = useCreateQuickNote()
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<string>(NO_STATUS)

  // Đổi hội thoại thì bỏ nháp cũ — tránh lưu nhầm ghi chú của khách trước.
  useEffect(() => { setContent(''); setStatus(NO_STATUS) }, [convId])

  const statuses = statusesQ.data?.statuses ?? []
  const statusMeta = (v?: string | null) => statuses.find((s) => s.value === v)

  const save = () => {
    const text = content.trim()
    if (!text) { toast.error('Chưa nhập nội dung ghi chú.'); return }
    create.mutate(
      { conversationId: convId, contactId: contactId || undefined, content: text, status: status === NO_STATUS ? undefined : status },
      {
        onSuccess: () => { toast.success('Đã lưu ghi chú'); setContent(''); setStatus(NO_STATUS) },
        onError: (err) => toast.error(apiError(err)),
      },
    )
  }

  return (
    <div className="space-y-3 px-4 py-3.5">
      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-muted-foreground">Nội dung ghi chú</label>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Khách quan tâm gì, hẹn gọi lại lúc nào…"
          className="min-h-[72px] text-[12.5px]"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-muted-foreground">Trạng thái tương tác</label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_STATUS}>Ghi chú thường</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button className="w-full" onClick={save} disabled={create.isPending}>
        <Save /> {create.isPending ? 'Đang lưu…' : 'Lưu ghi chú'}
      </Button>

      <div className="space-y-2 pt-1">
        {notesQ.isLoading && <Loading className="py-6" />}
        {notesQ.isError && <ErrorState message={apiError(notesQ.error)} />}
        {notesQ.data && notesQ.data.notes.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">Chưa có ghi chú nào cho khách này.</p>
        )}
        {notesQ.data?.notes.map((n) => {
          const meta = statusMeta(n.status)
          return (
            <div key={n.id} className="rounded-lg border bg-card px-3 py-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <Badge variant={noteToneVariant(meta?.tone)} className="px-2 py-0 text-[10.5px]">
                  {meta?.label || n.status || 'Ghi chú'}
                </Badge>
                <span className="truncate text-[11px] text-muted-foreground">
                  {formatDateVi(n.createdAt)}{n.createdBy?.fullName ? ` · ${n.createdBy.fullName}` : ''}
                </span>
              </div>
              <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">{n.content}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Tab "Tạo đơn" — phần "ĐƠN GẦN ĐÂY"
// ══════════════════════════════════════════════════════════════════════
function RecentOrders({ phone }: { phone: string }) {
  const q = useCustomerOrders(phone || undefined)
  const orders: CrmOrder[] = q.data?.orders ?? []
  const gmv = orders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0)

  return (
    <div className="mt-3.5 border-t px-4 pb-4 pt-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11.5px] font-bold tracking-wide text-muted-foreground">ĐƠN GẦN ĐÂY</span>
        {orders.length > 0 && <span className="text-[11.5px] font-bold text-success">{formatVnd(gmv)}</span>}
      </div>

      {!phone ? (
        <p className="py-3 text-center text-xs text-muted-foreground">
          Khách chưa có số điện thoại — chưa tra được lịch sử đơn
        </p>
      ) : q.isLoading ? (
        <Loading className="py-4" />
      ) : q.isError ? (
        <p className="py-3 text-center text-xs text-destructive">Không tải được đơn: {apiError(q.error)}</p>
      ) : orders.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Chưa có đơn hàng nào</p>
      ) : (
        <div className="space-y-1.5">
          <div className="text-[11px] text-muted-foreground">📦 Lịch sử đơn hàng ({orders.length})</div>
          {orders.slice(0, 6).map((o) => {
            const items = o.items?.length
              ? o.items.map((i) => `${i.name} (x${i.quantity})`).join(', ')
              : 'Đơn hàng trà'
            return (
              <div key={o.order_code} className="rounded-lg border bg-card px-3 py-2 text-xs">
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="font-bold">#{o.order_code}</span>
                  <Badge variant={orderStatusVariant(o.status)} className="px-2 py-0 text-[10.5px]">
                    {o.status || 'Chờ xử lý'}
                  </Badge>
                </div>
                <div className="mb-0.5 truncate text-[11px] text-muted-foreground" title={items}>🍵 {items}</div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>📅 {formatDateVi(o.created_at) ?? ''}</span>
                  <span className="font-bold text-success">{formatVnd(o.total_amount)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Tab "Thông tin" cho HỘI THOẠI NHÓM: nhóm không gắn một khách CRM cụ thể
// nên thay hồ sơ bằng danh sách thành viên (GET /conversations/:id/group-info,
// trưởng nhóm xếp trước). Nút ⟳ ép đồng bộ lại từ Zalo (refresh=1, bỏ cache).
// ══════════════════════════════════════════════════════════════════════
function GroupMembersPanel({ convId }: { convId: string }) {
  const qc = useQueryClient()
  const membersQ = useGroupMembers(convId, true)
  const [syncing, setSyncing] = useState(false)
  const members = membersQ.data ?? []

  const resync = async () => {
    setSyncing(true)
    try {
      await refreshGroupMembers(convId)
      await qc.invalidateQueries({ queryKey: ['conversation', convId, 'group-members'] })
      toast.success('Đã đồng bộ lại thành viên nhóm từ Zalo')
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> THÀNH VIÊN NHÓM{members.length > 0 ? ` (${members.length})` : ''}
        </p>
        <button
          type="button"
          onClick={resync}
          disabled={syncing}
          title="Đồng bộ lại danh sách từ Zalo"
          aria-label="Đồng bộ lại thành viên nhóm"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
        </button>
      </div>

      {membersQ.isLoading ? (
        <Loading className="py-8" />
      ) : membersQ.isError ? (
        <ErrorState message={apiError(membersQ.error)} />
      ) : members.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          Chưa lấy được danh sách thành viên — bấm ⟳ để đồng bộ từ Zalo (cần tài khoản đang kết nối).
        </p>
      ) : (
        <div className="space-y-1">
          {members.map((m: GroupMember) => (
            <div key={m.uid} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
              <Avatar className="h-8 w-8 shrink-0">
                {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.name} />}
                <AvatarFallback className="text-xs">{initials(m.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm" title={m.name}>{m.name}</span>
              {m.isAdmin && (
                <Badge variant="warning" className="shrink-0 px-1.5 py-0 text-[10px]">Trưởng nhóm</Badge>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Nhóm không gắn với một khách CRM cụ thể nên không có hồ sơ, điểm hay lịch sử mua.
      </p>
    </div>
  )
}
