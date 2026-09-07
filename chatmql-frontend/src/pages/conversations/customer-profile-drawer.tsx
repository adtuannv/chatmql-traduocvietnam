/**
 * customer-profile-drawer.tsx — Ngăn kéo "Chi tiết khách hàng" trượt từ phải.
 *
 * Port từ `window.openCustomerProfileDrawer` trong order-ui-bridge.js. Gộp hai
 * nguồn: contact bên ChatMQL (email, tên Zalo, nguồn) và hồ sơ CRM (mã KH, GMV,
 * lịch hẹn, đơn hàng) — backend đã ghép sẵn qua GET /orders/customer-profile.
 *
 * 7 tab: Thông tin CRM · Lịch sử mua hàng · Sản phẩm đã mua · Tích điểm ·
 * Ưu đãi · Dòng thời gian · Ghi chú. Dữ liệu tab nào chỉ gọi khi mở tab đó.
 */
import { useEffect, useMemo, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { Clock, Plus, Search, X } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DialogOverlay, DialogPortal } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/misc'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState, ErrorState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { cn, initials } from '@/lib/utils'
import {
  ACTIVITY_LABELS, ACTIVITY_TYPES, formatCombinedVip, formatDateTimeVi, formatDateVi, formatVnd,
  orderStatusVariant, toLocalInputValue,
  useCustomerActivity, useCustomerPoints, useCustomerProducts, useCustomerProfile,
  useCustomerPromotions, useUpdateCustomerSchedule,
  type ActivityType, type CrmCustomer, type CrmOrder, type CustomerProfile, type Promotion,
} from '@/hooks/use-orders'
import {
  noteToneVariant, useConversationNotes, useCreateQuickNote, useNoteStatuses,
} from '@/hooks/use-quick-notes'

type DrawerTab = 'crm' | 'orders' | 'products' | 'points' | 'promos' | 'timeline' | 'notes'

export function CustomerProfileDrawer({
  open, onOpenChange, convId, phone, name,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  convId: string
  phone?: string
  name?: string
}) {
  const [tab, setTab] = useState<DrawerTab>('crm')
  const profileQ = useCustomerProfile(open ? convId : undefined)

  // Mở lại drawer thì về tab đầu; đổi hội thoại cũng vậy.
  useEffect(() => { if (open) setTab('crm') }, [open, convId])

  const profile = profileQ.data?.status === 'ok' ? profileQ.data.profile : null
  const crm = profile?.crm
  const displayName = crm?.full_name || profile?.chatmql?.crmName || profile?.chatmql?.zaloName || name || 'Khách hàng'
  const displayPhone = profile?.phone || phone || ''

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-50 flex w-[min(940px,94vw)] flex-col border-l bg-background shadow-2xl outline-none animate-fade-in"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b px-5 py-3.5">
            <Avatar className="h-11 w-11">
              <AvatarFallback className="text-[15px]">{initials(displayName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-bold">Chi tiết khách hàng</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 truncate text-xs text-muted-foreground">
                {profileQ.isLoading
                  ? 'Đang tải hồ sơ…'
                  : <>
                      {displayName}{displayPhone ? ` · ${displayPhone}` : ''}
                      {crm?.customer_code && <> · <span className="font-mono">{crm.customer_code}</span></>}
                    </>}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" className="ml-auto" title="Đóng"><X /></Button>
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            {profileQ.isLoading && <Loading label="Đang tải hồ sơ…" />}
            {profileQ.isError && <ErrorState message={apiError(profileQ.error)} />}
            {profileQ.data?.status === 'no_phone' && (
              <EmptyState
                title="Chưa xem được hồ sơ"
                description={profileQ.data.message}
              />
            )}
            {profile && (
              <DrawerBody
                profile={profile}
                convId={convId}
                tab={tab}
                onTabChange={setTab}
              />
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  )
}

// ══════════════════════════════════════════════════════════════════════
function DrawerBody({
  profile, convId, tab, onTabChange,
}: {
  profile: CustomerProfile
  convId: string
  tab: DrawerTab
  onTabChange: (t: DrawerTab) => void
}) {
  const crm: CrmCustomer = profile.crm ?? {}
  const orders = profile.orders ?? []
  const phone = profile.phone

  // Nạp lười: chỉ gọi mạng khi nhân viên mở đúng tab.
  const productsQ = useCustomerProducts(tab === 'products' ? phone : undefined)
  const pointsQ = useCustomerPoints(tab === 'points' ? phone : undefined)
  const promosQ = useCustomerPromotions(tab === 'promos' ? phone : undefined)
  const notesQ = useConversationNotes(tab === 'notes' ? convId : undefined)

  const tabs: Array<{ id: DrawerTab; label: string }> = [
    { id: 'crm', label: 'Thông tin CRM' },
    { id: 'orders', label: `Lịch sử mua hàng (${orders.length})` },
    { id: 'products', label: `Sản phẩm đã mua${productsQ.data ? ` (${productsQ.data.total})` : ''}` },
    { id: 'points', label: 'Tích điểm' },
    { id: 'promos', label: 'Ưu đãi' },
    { id: 'timeline', label: 'Dòng thời gian' },
    { id: 'notes', label: `Ghi chú${notesQ.data ? ` (${notesQ.data.total})` : ''}` },
  ]

  return (
    <div className="pt-4">
      {/* Số liệu mua hàng */}
      <div className="mb-3.5 grid grid-cols-3 gap-2">
        <Stat label="Tổng chi tiêu" value={formatVnd(crm.gmv_total)} cls="text-success" />
        <Stat label="Số đơn" value={String(crm.order_count ?? orders.length)} />
        <Stat label="Giá trị TB/đơn" value={formatVnd(crm.aov)} />
      </div>

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as DrawerTab)}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0 border-b rounded-none">
          {tabs.map((t) => (
            <TabsTrigger
              key={t.id} value={t.id}
              className="-mb-px rounded-none border-b-2 border-transparent px-2.5 py-2 text-[12.5px] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-bold data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="crm" className="mt-3.5">
          <CrmInfoTab profile={profile} />
        </TabsContent>
        <TabsContent value="orders" className="mt-3.5">
          <OrdersTab orders={orders} />
        </TabsContent>
        <TabsContent value="products" className="mt-3.5">
          {productsQ.isLoading ? <Loading className="py-6" />
            : productsQ.isError ? <ErrorState message="Không tải được danh sách sản phẩm." />
            : !productsQ.data?.total ? <Muted>Khách chưa mua sản phẩm nào.</Muted>
            : (
              <>
                <p className="mb-2 text-[11.5px] text-muted-foreground">
                  Gộp từ {productsQ.data.order_count} đơn trong lịch sử mua hàng.
                </p>
                <Table
                  head={['Sản phẩm', 'SL', 'Số đơn', 'Mua gần nhất']}
                  rows={productsQ.data.products.map((p) => [
                    <div key="n">
                      <div className="font-semibold">
                        {p.name || p.code}
                        {p.is_gift && <span className="ml-1 text-[10.5px] font-semibold text-warning">🎁 quà tặng</span>}
                      </div>
                      <div className="font-mono text-[10.5px] text-muted-foreground">
                        {p.code}{p.unit ? ` · ${p.unit}` : ''}
                      </div>
                    </div>,
                    <span key="q" className="font-bold tabular-nums">{p.quantity}</span>,
                    <span key="o" className="text-muted-foreground tabular-nums">{p.order_count}</span>,
                    <span key="d" className="whitespace-nowrap text-muted-foreground">{formatDateVi(p.last_bought_at) ?? '—'}</span>,
                  ])}
                  align={['left', 'right', 'right', 'left']}
                />
              </>
            )}
        </TabsContent>
        <TabsContent value="points" className="mt-3.5">
          {pointsQ.isLoading ? <Loading className="py-6" />
            : pointsQ.isError ? <ErrorState message="Không tải được sổ cái điểm." />
            : !pointsQ.data?.entry_count ? <Muted>Khách chưa có giao dịch tích điểm nào.</Muted>
            : (
              <>
                {pointsQ.data.balance_mismatch && (
                  <div className="mb-2.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11.5px] leading-relaxed text-warning-foreground">
                    <b>Số dư cần đối soát.</b> Sổ cái ghi <b>{pointsQ.data.balance}</b> điểm nhưng cộng dồn các
                    giao dịch ra <b>{pointsQ.data.computed_balance}</b>. Chưa nên dùng điểm của khách này để trừ
                    tiền cho tới khi kế toán xác nhận.
                  </div>
                )}
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <Stat label="Tổng đã tích" value={`+${pointsQ.data.total_earned}`} cls="text-success" />
                  <Stat label="Tổng đã tiêu" value={`-${pointsQ.data.total_spent}`} cls="text-warning" />
                  <Stat label="Điểm còn lại" value={String(pointsQ.data.balance)} cls={pointsQ.data.balance_mismatch ? 'text-warning' : undefined} />
                </div>
                {pointsQ.data.rank && (
                  <p className="mb-2.5 text-xs text-muted-foreground">
                    Hạng: <b className="text-foreground">{pointsQ.data.rank}</b>
                    {pointsQ.data.rank_reward ? ` · ${pointsQ.data.rank_reward}` : ''}
                  </p>
                )}
                <Table
                  head={['Thời gian', 'Diễn giải', 'Điểm', 'Còn lại']}
                  rows={pointsQ.data.entries.map((e) => [
                    <span key="t" className="whitespace-nowrap text-muted-foreground">{formatDateVi(e.at) ?? '—'}</span>,
                    <div key="c">
                      {e.category}
                      {e.ref && <span className="block font-mono text-[10.5px] text-muted-foreground">{e.ref}</span>}
                    </div>,
                    <span key="d" className={cn('whitespace-nowrap font-bold', e.delta >= 0 ? 'text-success' : 'text-warning')}>
                      {e.delta >= 0 ? '+' : ''}{e.delta}
                    </span>,
                    <span key="b" className="whitespace-nowrap text-muted-foreground">{e.balance_after ?? '—'}</span>,
                  ])}
                  align={['left', 'left', 'right', 'right']}
                />
              </>
            )}
        </TabsContent>
        <TabsContent value="promos" className="mt-3.5">
          {promosQ.isLoading ? <Loading className="py-6" />
            : promosQ.isError ? <ErrorState message="Không tải được ưu đãi." />
            : promosQ.data && <PromosTab promotions={promosQ.data.promotions} />}
        </TabsContent>
        <TabsContent value="timeline" className="mt-3.5">
          <TimelineTab convId={tab === 'timeline' ? convId : undefined} />
        </TabsContent>
        <TabsContent value="notes" className="mt-3.5">
          <NotesTab convId={convId} contactId={profile.chatmql?.id} query={notesQ} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Mảnh dùng chung ──────────────────────────────────────────────────
function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border bg-card px-2.5 py-2">
      <div className="mb-0.5 text-[10.5px] text-muted-foreground">{label}</div>
      <div className={cn('text-[13.5px] font-bold', cls)}>{value}</div>
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[12.5px] text-muted-foreground">{children}</p>
}

function Table({
  head, rows, align,
}: {
  head: string[]
  rows: React.ReactNode[][]
  align?: Array<'left' | 'right'>
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-muted/60">
            {head.map((h, i) => (
              <th key={h} className={cn('whitespace-nowrap px-2 py-1.5 text-[11px] font-semibold text-muted-foreground', align?.[i] === 'right' ? 'text-right' : 'text-left')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r} className="border-t">
              {cells.map((c, i) => (
                <td key={i} className={cn('px-2 py-1.5 align-top', align?.[i] === 'right' && 'text-right')}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  const has = value !== null && value !== undefined && String(value).trim() !== ''
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1.5 text-[12.5px] last:border-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('break-words text-right', has ? 'font-semibold' : 'text-muted-foreground/60')}>
        {has ? String(value) : 'Chưa có'}
      </span>
    </div>
  )
}

// ── Tab Thông tin CRM (kèm lịch hẹn sửa được) ────────────────────────
function CrmInfoTab({ profile }: { profile: CustomerProfile }) {
  const crm: CrmCustomer = profile.crm ?? {}
  const cm = profile.chatmql
  const update = useUpdateCustomerSchedule()

  const [salesAt, setSalesAt] = useState('')
  const [careAt, setCareAt] = useState('')
  const [apptType, setApptType] = useState('')
  useEffect(() => {
    setSalesAt(toLocalInputValue(crm.next_sales_at))
    setCareAt(toLocalInputValue(crm.next_care_at))
    setApptType(crm.appointment_type || '')
  }, [crm.next_sales_at, crm.next_care_at, crm.appointment_type])

  const saveSchedule = () =>
    update.mutate(
      {
        phone: profile.phone,
        // Ô trống → chuỗi rỗng = xoá lịch (backend phân biệt với "không gửi").
        nextSalesAt: salesAt ? new Date(salesAt).toISOString() : '',
        nextCareAt: careAt ? new Date(careAt).toISOString() : '',
        appointmentType: apptType,
      },
      {
        onSuccess: () => toast.success('Đã cập nhật lịch vào CRM'),
        onError: (err) => toast.error(apiError(err)),
      },
    )

  const block = (title: string, value?: string | null) => (
    <div>
      <div className="mb-1 text-xs font-bold">{title}</div>
      <div className={cn('whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-[12.5px] leading-relaxed', !value && 'text-muted-foreground/60')}>
        {value || 'Chưa có thông tin'}
      </div>
    </div>
  )

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border bg-muted/30 px-3.5 py-3">
        <div className="mb-1.5 text-[11px] font-bold tracking-wide text-muted-foreground">THÔNG TIN CƠ BẢN</div>
        <InfoRow label="Mã khách hàng" value={crm.customer_code} />
        <InfoRow label="Tên CRM (tên thật)" value={crm.full_name} />
        <InfoRow label="Tên hiển thị Zalo" value={cm?.zaloName} />
        <InfoRow label="Số điện thoại" value={profile.phone} />
        <InfoRow label="SĐT liên hệ khác" value={crm.phone2} />
        <InfoRow label="Email" value={cm?.email} />
        <InfoRow label="Nghề nghiệp" value={crm.occupation} />
        <InfoRow label="Giới tính" value={crm.gender} />
        <InfoRow label="Ngày sinh" value={formatDateVi(crm.birthday)} />
        <InfoRow label="Nguồn khách hàng" value={crm.referral_source || cm?.source} />
        <InfoRow label="Cấp Vip" value={formatCombinedVip(crm)} />
        <InfoRow label="Nhóm KH" value={crm.nhom_kh || crm.priority_level} />
        <InfoRow label="Người phụ trách" value={crm.staff_in_charge} />
        <InfoRow label="Tần suất mua" value={crm.purchase_frequency} />
        <InfoRow label="Lead score" value={cm?.leadScore != null ? `${cm.leadScore}/100` : null} />
        <InfoRow label="Địa chỉ" value={crm.address || cm?.address} />
        <InfoRow label="Địa chỉ 2" value={crm.address2} />
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border px-3.5 py-3">
          <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> LỊCH & NHẮC
          </div>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Lịch bán hàng kế tiếp</label>
              <Input type="datetime-local" value={salesAt} onChange={(e) => setSalesAt(e.target.value)} className="h-8 text-xs" />
              <div className="mt-1 text-[11px] text-muted-foreground">
                {crm.next_sales_at ? `Đang đặt: ${formatDateTimeVi(crm.next_sales_at)}` : 'Chưa đặt lịch bán hàng'}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Lịch chăm sóc kế tiếp</label>
              <Input type="datetime-local" value={careAt} onChange={(e) => setCareAt(e.target.value)} className="h-8 text-xs" />
              <div className="mt-1 text-[11px] text-muted-foreground">
                {crm.next_care_at ? `Đang đặt: ${formatDateTimeVi(crm.next_care_at)}` : 'Chưa đặt lịch chăm sóc'}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Loại hẹn</label>
              <Input value={apptType} onChange={(e) => setApptType(e.target.value)} placeholder="VD: Chăm sóc, Bán hàng" className="h-8 text-xs" />
            </div>
            <Button size="sm" onClick={saveSchedule} disabled={update.isPending}>
              <Clock /> {update.isPending ? 'Đang lưu…' : 'Cập nhật lịch'}
            </Button>
            <p className="border-t pt-2 text-[11px] leading-relaxed text-muted-foreground">
              Lịch được lưu vào hồ sơ khách bên CRM, dùng chung với đội chăm sóc.
              Xoá trống ô rồi bấm cập nhật để huỷ lịch.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {block('📦 Đặc thù sản phẩm / gu trà', crm.thich_dung_hang)}
          {block('🧠 Nhu cầu sử dụng', crm.nhu_cau_sd)}
          {block('📄 Ghi chú hồ sơ', crm.profile_note)}
        </div>
      </div>
    </div>
  )
}

// ── Tab Lịch sử mua hàng ─────────────────────────────────────────────
function OrdersTab({ orders }: { orders: CrmOrder[] }) {
  if (!orders.length) return <Muted>Khách chưa có đơn hàng nào trong CRM.</Muted>
  return (
    <>
      <Table
        head={['Thời gian', 'Mã HĐ', 'Số tiền', 'Trạng thái', 'Nhân viên']}
        align={['left', 'left', 'right', 'left', 'left']}
        rows={orders.map((o) => [
          <span key="t" className="whitespace-nowrap text-muted-foreground">{formatDateVi(o.created_at) ?? '—'}</span>,
          <span key="c" className="font-mono font-semibold">{o.order_code}</span>,
          <span key="m" className="whitespace-nowrap font-bold text-success">{formatVnd(o.total_amount)}</span>,
          <Badge key="s" variant={orderStatusVariant(o.status)} className="whitespace-nowrap px-2 py-0 text-[10.5px]">{o.status || '—'}</Badge>,
          <span key="u" className="whitespace-nowrap text-muted-foreground">{o.seller || '—'}</span>,
        ])}
      />
      <p className="mt-2 text-[11px] text-muted-foreground">Gộp từ {orders.length} đơn trong CRM.</p>
    </>
  )
}

// ── Tab Ưu đãi ───────────────────────────────────────────────────────
function PromosTab({ promotions }: { promotions: Promotion[] }) {
  const own = promotions.filter((p) => p.source === 'customer')
  const sys = promotions.filter((p) => p.source === 'system')

  const card = (p: Promotion) => {
    const state = p.used
      ? { label: 'Đã dùng', variant: 'secondary' as const }
      : p.eligible
        ? { label: 'Đủ điều kiện', variant: 'success' as const }
        : { label: 'Chưa đủ điều kiện', variant: 'warning' as const }
    return (
      <div key={p.id} className="mb-2 rounded-lg border bg-card px-3 py-2.5">
        <div className="mb-1 flex items-start justify-between gap-2">
          <span className="text-[13px] font-bold">{p.name}</span>
          <Badge variant={state.variant} className="shrink-0 px-2 py-0 text-[10.5px]">{state.label}</Badge>
        </div>
        {p.description && <p className="mb-1 text-xs text-muted-foreground">{p.description}</p>}
        <div className="flex flex-wrap gap-3 text-[11.5px] text-muted-foreground">
          {p.code && <span>🏷️ <b className="font-mono text-foreground">{p.code}</b></span>}
          {p.conditions_text.length > 0 && <span>✅ {p.conditions_text.join(' · ')}</span>}
          <span>📅 {p.to ? `Đến ${formatDateVi(p.to)}` : 'Không giới hạn'}</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="text-xs font-bold">Ưu đãi của khách hàng</div>
      <div className="mb-2 text-[11.5px] text-muted-foreground">Gắn riêng với khách này — theo hạng, số điểm và lịch sử mua.</div>
      {own.length ? own.map(card) : <p className="pb-3 text-xs text-muted-foreground/60">Chưa có ưu đãi riêng nào.</p>}
      <div className="mt-3 text-xs font-bold">Ưu đãi chung từ hệ thống</div>
      <div className="mb-2 text-[11.5px] text-muted-foreground">Chương trình đang chạy cho toàn hệ thống, khách nào cũng dùng được.</div>
      {sys.length ? sys.map(card) : <p className="text-xs text-muted-foreground/60">Chưa có chương trình nào đang chạy.</p>}
    </div>
  )
}

// ── Tab Dòng thời gian ───────────────────────────────────────────────
function TimelineTab({ convId }: { convId: string | undefined }) {
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [types, setTypes] = useState<ActivityType[]>([])
  useEffect(() => { const t = setTimeout(() => setQ(input.trim()), 450); return () => clearTimeout(t) }, [input])

  const actQ = useCustomerActivity({ conversationId: convId, q, types })
  const counts = actQ.data?.counts ?? {}

  const toggleType = (t: ActivityType) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))

  return (
    <div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Tìm trong hoạt động…" className="h-8 pl-8 text-xs" />
      </div>
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {ACTIVITY_TYPES.map((t) => {
          const n = counts[t] || 0
          const on = types.includes(t)
          return (
            <button
              key={t} type="button" disabled={!n} onClick={() => toggleType(t)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium transition-colors disabled:cursor-default disabled:opacity-40',
                on ? 'border-primary bg-primary/10 font-bold text-primary' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {ACTIVITY_LABELS[t].icon} {ACTIVITY_LABELS[t].label}{n ? ` ${n}` : ''}
            </button>
          )
        })}
      </div>

      {actQ.isLoading ? <Loading className="py-6" />
        : actQ.isError ? <ErrorState message={apiError(actQ.error)} />
        : !actQ.data?.items.length ? (
          <Muted>{q || types.length ? 'Không có hoạt động nào khớp bộ lọc.' : 'Chưa có hoạt động nào.'}</Muted>
        ) : (
          <>
            <div className="mb-1 text-[11px] text-muted-foreground">{actQ.data.total} hoạt động</div>
            {actQ.data.items.map((i) => {
              const m = ACTIVITY_LABELS[i.type] ?? { icon: '•', label: i.type }
              const status = typeof i.meta?.status === 'string' ? i.meta.status : null
              return (
                <div key={i.id} className="flex gap-2.5 border-b border-border/60 py-2 last:border-0">
                  <div className="w-6 shrink-0 text-center text-sm">{m.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] font-semibold text-primary">{i.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTimeVi(i.at) ?? ''}</span>
                    </div>
                    {i.detail && (
                      <div className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{i.detail}</div>
                    )}
                    {status && <Badge variant="secondary" className="mt-1 px-1.5 py-0 text-[10.5px]">{status}</Badge>}
                  </div>
                </div>
              )
            })}
          </>
        )}
    </div>
  )
}

// ── Tab Ghi chú ──────────────────────────────────────────────────────
const NO_STATUS = '__none__'

function NotesTab({
  convId, contactId, query,
}: {
  convId: string
  contactId?: string
  query: ReturnType<typeof useConversationNotes>
}) {
  const statusesQ = useNoteStatuses()
  const create = useCreateQuickNote()
  const [content, setContent] = useState('')
  const [status, setStatus] = useState(NO_STATUS)
  const statuses = statusesQ.data?.statuses ?? []
  const meta = useMemo(() => new Map(statuses.map((s) => [s.value, s])), [statuses])

  const add = () => {
    const text = content.trim()
    if (!text) { toast.error('Chưa nhập nội dung ghi chú.'); return }
    create.mutate(
      { conversationId: convId, contactId, content: text, status: status === NO_STATUS ? undefined : status },
      {
        onSuccess: () => { toast.success('Đã thêm ghi chú'); setContent(''); setStatus(NO_STATUS) },
        onError: (err) => toast.error(apiError(err)),
      },
    )
  }

  return (
    <div>
      <div className="mb-3.5 rounded-lg border bg-muted/30 px-3.5 py-3">
        <div className="mb-2 text-[12.5px] font-bold">📝 Thêm ghi chú mới</div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="mb-2 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_STATUS}>— Ghi chú thường (không gắn trạng thái) —</SelectItem>
            {statuses.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Textarea
          rows={3} value={content} onChange={(e) => setContent(e.target.value)}
          placeholder="Nội dung trao đổi với khách…" className="text-[12.5px]"
        />
        <Button size="sm" className="mt-2" onClick={add} disabled={create.isPending}>
          <Plus /> {create.isPending ? 'Đang lưu…' : 'Thêm ghi chú'}
        </Button>
      </div>

      {query.isLoading ? <Loading className="py-6" />
        : query.isError ? <ErrorState message={apiError(query.error)} />
        : !query.data?.notes.length ? <Muted>Chưa có ghi chú nào.</Muted>
        : (
          <div className="space-y-2">
            {query.data.notes.map((n) => {
              const st = n.status ? meta.get(n.status) : undefined
              return (
                <div key={n.id} className="rounded-lg border bg-card px-3 py-2.5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {st && <Badge variant={noteToneVariant(st.tone)} className="px-2 py-0 text-[10.5px]">{st.label}</Badge>}
                      <span className="truncate text-[11.5px] text-muted-foreground">{n.createdBy?.fullName || 'Nhân viên'}</span>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTimeVi(n.createdAt) ?? ''}</span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">{n.content}</div>
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}
