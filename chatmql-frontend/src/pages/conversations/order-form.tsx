/**
 * order-form.tsx — Form "Tạo đơn" TDVN, nằm trong cột phải màn Hội thoại (~365px).
 *
 * Port từ order-ui-bridge.js (`openChatMqlOrderModal`) sang React thuần:
 * - Dữ liệu qua hook `use-order-form.ts`, toán tiền qua `lib/order-calc.ts`.
 * - Body gửi POST /orders/create đúng `CreateOrderInput` của backend.
 * - Trường mockup có nhưng backend chưa nhận: hiện disabled + nhãn "chờ backend".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CreditCard,
  Gift,
  Info,
  Loader2,
  MapPin,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Tag,
  Trash2,
  Truck,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox, Textarea } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiError } from '@/lib/api-client'
import {
  CARRIER_FEES,
  CARRIER_INFO,
  CARRIER_LABELS,
  PAY_STATUS_LABELS,
  clampPoints,
  computeTotals,
  formatVnd,
  lineTotal,
  matchesQuery,
  parseVnNumber,
  type DiscountType,
  type OrderLine,
  type ShippingProvider,
  type TypeFeeDelivery,
} from '@/lib/order-calc'
import { cn, formatNumber } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import {
  ORDER_SOURCE_OPTIONS,
  ORDER_TYPE_OPTIONS,
  useApplyPromotion,
  useCatalog,
  useConversationContext,
  useCreateOrder,
  useCrmCustomer,
  useCustomerPoints,
  useFormLookups,
  usePromotions,
  useWards,
  type ApplyPromotionResult,
  type CatalogProduct,
  type CreateOrderBody,
  type CreateOrderResult,
} from '@/hooks/use-order-form'

// ── Hằng số ───────────────────────────────────────────────────────────

const RETURN_NOTE_TEXT = 'Đơn đổi trả: Thu hàng cũ đổi đơn mới & thu COD chênh lệch'
const PHONE_RE = /^(0|84)[35789]\d{8}$/
const CARRIERS: ShippingProvider[] = ['jt_express', 'vnpost', 'viettel_post', 'other']

function newRequestId(): string {
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizePhone(raw: string): string {
  return raw.replace(/[\s.\-]/g, '').trim()
}

// ── Props ─────────────────────────────────────────────────────────────

export interface OrderFormProps {
  convId: string
  onCreated?: (result: CreateOrderResult) => void
}

/** Bọc bằng `key={convId}` để đổi hội thoại là form dựng lại sạch từ đầu. */
export function OrderForm(props: OrderFormProps) {
  return <OrderFormInner key={props.convId} {...props} />
}

// ── Form chính ────────────────────────────────────────────────────────

function OrderFormInner({ convId, onCreated }: OrderFormProps) {
  const currentUser = useAuthStore((s) => s.user)

  // Khách hàng
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [addr, setAddr] = useState('')
  const [notes, setNotes] = useState('')
  const [lookupPhone, setLookupPhone] = useState('')

  // Thông tin đơn
  const [orderStatusId, setOrderStatusId] = useState<number | null>(null)
  const [warehouseId, setWarehouseId] = useState<number | null>(null)
  const [provinceId, setProvinceId] = useState<number | null>(null)
  const [wardId, setWardId] = useState<number | null>(null)
  const [orderSource, setOrderSource] = useState<string>('Zalo')
  const [orderType, setOrderType] = useState<string>('Bán lẻ')

  // Sản phẩm
  const [lines, setLines] = useState<OrderLine[]>([])

  // Vận chuyển
  const [shippingProvider, setShippingProvider] = useState<ShippingProvider>('jt_express')
  const [shippingFee, setShippingFee] = useState<number>(CARRIER_FEES.jt_express)
  const [typeFeeDelivery, setTypeFeeDelivery] = useState<TypeFeeDelivery>('CC_CASH')
  const [selfShipping, setSelfShipping] = useState(false)
  const [isFragile, setIsFragile] = useState(false)
  const [isExchange, setIsExchange] = useState(false)

  // Thanh toán
  const [discountType, setDiscountType] = useState<DiscountType>('pct')
  const [discountPercent, setDiscountPercent] = useState(0)
  const [discountAmount, setDiscountAmount] = useState(0)
  const [promoCode, setPromoCode] = useState('')
  const [promoApplied, setPromoApplied] = useState<ApplyPromotionResult | null>(null)
  const [usedPoints, setUsedPoints] = useState(0)
  const [depositAmount, setDepositAmount] = useState(0)

  const [requestId, setRequestId] = useState(newRequestId)

  // ── Dữ liệu ──
  const ctx = useConversationContext(convId)
  const lookups = useFormLookups()
  const wards = useWards(provinceId)
  const catalogQ = useCatalog(warehouseId)
  const crmQ = useCrmCustomer(lookupPhone)
  const promosQ = usePromotions(lookupPhone)
  const pointsQ = useCustomerPoints(lookupPhone)
  const applyPromo = useApplyPromotion()
  const createOrder = useCreateOrder()

  const catalog = useMemo(() => catalogQ.data ?? [], [catalogQ.data])
  const provinces = lookups.data?.provinces ?? []
  const statuses = lookups.data?.statuses ?? []
  const warehouses = lookups.data?.warehouses ?? []

  // Điền sẵn từ ngữ cảnh hội thoại — một lần, không đè lên thứ nhân viên đã gõ.
  const prefilled = useRef(false)
  useEffect(() => {
    const data = ctx.data
    if (!data || prefilled.current) return
    prefilled.current = true
    const c = data.contact
    setName((v) => v || c.name || '')
    setPhone((v) => v || c.phone || '')
    setAddr((v) => v || data.crm?.address || c.address || '')
    if (c.phone && PHONE_RE.test(normalizePhone(c.phone))) setLookupPhone(normalizePhone(c.phone))
    if (c.phoneSource === 'name') {
      toast.info('Số điện thoại được suy ra từ tên hội thoại — kiểm lại trước khi lên đơn.')
    }
  }, [ctx.data])

  // Mặc định: trạng thái đầu tiên, kho đầu tiên (như bridge).
  useEffect(() => {
    if (!lookups.data) return
    setOrderStatusId((v) => v ?? lookups.data.statuses[0]?.id ?? null)
    setWarehouseId((v) => v ?? lookups.data.warehouses[0]?.id ?? null)
  }, [lookups.data])

  // Gõ SĐT hợp lệ → tra CRM sau 600ms.
  useEffect(() => {
    const p = normalizePhone(phone)
    if (!PHONE_RE.test(p) || p === lookupPhone) return
    const t = setTimeout(() => setLookupPhone(p), 600)
    return () => clearTimeout(t)
  }, [phone, lookupPhone])

  // CRM tìm thấy khách → điền địa chỉ / tên nếu ô đang trống.
  useEffect(() => {
    const c = crmQ.data?.found ? crmQ.data.customer : null
    if (!c) return
    if (c.address) setAddr((v) => (v.trim() ? v : c.address || ''))
    if (c.full_name) setName((v) => (v.trim() ? v : c.full_name || ''))
  }, [crmQ.data])

  // Đổi kho → bỏ dòng không còn trong danh mục kho mới (tồn kho khác nhau theo kho).
  useEffect(() => {
    if (!catalog.length) return
    setLines((ls) => {
      const kept = ls.filter((l) => catalog.some((p) => p.code === l.code))
      return kept.length === ls.length ? ls : kept
    })
  }, [catalog])

  // Đơn vị vận chuyển → phí mặc định của hãng.
  function changeProvider(v: ShippingProvider) {
    setShippingProvider(v)
    setShippingFee(CARRIER_FEES[v])
  }

  // Đơn đổi trả → thêm/bớt dòng ghi chú chuẩn.
  function toggleExchange(checked: boolean) {
    setIsExchange(checked)
    setNotes((n) => {
      const kept = n.split('\n').filter((line) => line.trim() !== RETURN_NOTE_TEXT)
      if (!checked) return kept.join('\n').replace(/^\n+|\n+$/g, '')
      const base = kept.join('\n').replace(/\s+$/, '')
      return base ? `${base}\n${RETURN_NOTE_TEXT}` : RETURN_NOTE_TEXT
    })
  }

  // ── Sản phẩm ──
  function addProduct(p: CatalogProduct, asGift = false) {
    setLines((ls) => {
      const idx = ls.findIndex((l) => l.code === p.code && l.isGift === asGift)
      if (idx >= 0) return ls.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l))
      return [
        ...ls,
        {
          code: p.code,
          name: p.name,
          price: p.price,
          quantity: 1,
          isGift: asGift,
          unit: p.unit,
          weight: p.weight,
          inventory: p.inventory,
          vatNote: p.vat_note,
        },
      ]
    })
  }
  function updateLine(i: number, patch: Partial<OrderLine>) {
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, k) => k !== i))
  }

  // ── Tổng tiền ──
  const pointsBalance = pointsQ.data?.balance ?? null
  const totals = useMemo(
    () =>
      computeTotals({
        lines,
        discountType,
        discountPercent,
        discountAmount,
        promo: promoApplied,
        usedPoints,
        pointsBalance,
        shippingFee,
        selfShipping,
        typeFeeDelivery,
        depositAmount,
      }),
    [
      lines, discountType, discountPercent, discountAmount, promoApplied,
      usedPoints, pointsBalance, shippingFee, selfShipping, typeFeeDelivery, depositAmount,
    ],
  )

  // ── Mã ưu đãi ──
  function handlePromo() {
    if (promoApplied) {
      setPromoApplied(null)
      setPromoCode('')
      return
    }
    const code = promoCode.trim().toUpperCase()
    if (!code) {
      toast.warning('Nhập mã trước khi bấm áp dụng.')
      return
    }
    applyPromo.mutate(
      { code, phone: normalizePhone(phone) || undefined, orderSubtotal: totals.subtotal },
      {
        onSuccess: (r) => {
          if (!r.valid) {
            toast.error(r.message || 'Mã không dùng được')
            return
          }
          setPromoApplied(r)
          toast.success(r.message || `Đã áp dụng mã ${code}`)
        },
        onError: (err) => toast.error(apiError(err)),
      },
    )
  }

  const eligiblePromos = useMemo(
    () => (promosQ.data?.promotions ?? []).filter((p) => p.code && p.eligible && !p.used).slice(0, 6),
    [promosQ.data],
  )

  // ── Lên đơn ──
  function resetAfterCreate() {
    setLines([])
    setDiscountPercent(0)
    setDiscountAmount(0)
    setUsedPoints(0)
    setDepositAmount(0)
    setPromoApplied(null)
    setPromoCode('')
    setIsExchange(false)
    setIsFragile(false)
    setNotes('')
    setRequestId(newRequestId())
  }

  function submit() {
    const custName = name.trim()
    const custPhone = normalizePhone(phone)
    const custAddr = addr.trim()

    const missing: string[] = []
    if (!custName) missing.push('Tên khách hàng')
    if (!custPhone) missing.push('Số điện thoại')
    if (!custAddr) missing.push('Địa chỉ chi tiết')
    if (missing.length) {
      toast.error(`Chưa thể lên đơn — còn thiếu: ${missing.join(', ')}`)
      return
    }
    if (!lines.length) {
      toast.error(catalog.length ? 'Đơn hàng chưa có sản phẩm nào.' : 'Kho đang chọn không có sản phẩm nào.')
      return
    }

    const provName = provinces.find((p) => p.id === provinceId)?.name ?? ''
    const wardName = (wards.data ?? []).find((w) => w.id === wardId)?.name ?? ''
    const defaultCity = ctx.data?.crm?.city || ctx.data?.contact.city || 'Hà Nội'

    const body: CreateOrderBody = {
      requestId,
      conversationId: convId,
      customerName: custName,
      customerPhone: custPhone,
      shippingAddress: [custAddr, wardName, provName].filter(Boolean).join(', '),
      city: provName || defaultCity,
      // Đợt 1
      orderStatusId: orderStatusId ?? undefined,
      warehouseId: warehouseId ?? undefined,
      provinceId: provinceId ?? undefined,
      provinceName: provName || undefined,
      wardId: wardId ?? undefined,
      wardName: wardName || undefined,
      addressDetail: custAddr,
      // Đợt 3
      depositAmount: totals.deposit,
      orderType,
      orderSource,
      selfShipping,
      isFragile,
      isExchange,
      typeFeeDelivery,
      // Sản phẩm & tiền
      items: lines.map((l) => ({
        productCode: l.code,
        productName: l.name,
        quantity: l.quantity,
        unitPrice: l.price,
        isGift: l.isGift,
      })),
      discountAmount: totals.discountPayload,
      shippingFee: totals.shippingFeePayload,
      paymentMethod: totals.deposit > 0 ? 'vietqr' : 'cod',
      shippingProvider,
      notes: notes.trim(),
    }

    createOrder.mutate(body, {
      onSuccess: (res) => {
        const money = formatVnd(res.total_amount || totals.total)
        if (res.replayed) {
          toast.info(`Đơn ${res.order_code} đã được tạo trước đó · ${money}`)
        } else {
          toast.success(`Lên đơn thành công — mã ${res.order_code} · ${money}`)
        }
        if (res.status === 'partial' || res.fm_saved === false) {
          toast.warning(`Đơn ${res.order_code} đã vào CRM nhưng FM chưa nhận — hệ thống sẽ tự đẩy lại.`)
        }
        resetAfterCreate()
        onCreated?.(res)
      },
      onError: (err) => toast.error(apiError(err)),
    })
  }

  // ── Hiển thị ──
  const crm = crmQ.data?.found ? crmQ.data.customer : ctx.data?.crm ?? null
  const submitDisabled = createOrder.isPending || lines.length === 0
  const wardList = wards.data ?? []

  if (ctx.isLoading && !ctx.data) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Đang tải thông tin khách…
      </div>
    )
  }

  return (
    <div className="space-y-3 text-xs">
      {/* CRM card */}
      <div className="rounded-lg border bg-muted/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={crm ? 'success' : 'secondary'} className="text-[10px]">
            {crmQ.isFetching ? 'ĐANG TRA CRM…' : crm ? 'ĐÃ CÓ TRÊN CRM' : 'CHƯA CÓ TRÊN CRM'}
          </Badge>
          {crm?.cap_vip && <span className="font-semibold text-success">{crm.cap_vip}</span>}
          {(crm?.nhom_kh || crm?.priority_level) && (
            <span className="text-muted-foreground">Nhóm: <b className="text-foreground">{crm?.nhom_kh || crm?.priority_level}</b></span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>GMV: <b className="text-foreground">{formatVnd(crm?.gmv_total ?? 0)}</b></span>
          <span>Đã mua: <b className="text-foreground">{crm?.order_count ?? 0} đơn</b></span>
          {crm?.thich_dung_hang && <span>Gu: <b className="text-foreground">{crm.thich_dung_hang}</b></span>}
        </div>
      </div>

      {/* (a) Thông tin đơn hàng */}
      <Section title="Thông tin đơn hàng" icon={User}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Trạng thái">
            <Select
              value={orderStatusId != null ? String(orderStatusId) : ''}
              onValueChange={(v) => setOrderStatusId(Number(v))}
              disabled={lookups.isLoading}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Chọn trạng thái" /></SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)} className="text-xs">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Nhân viên lên đơn" hint="Lấy từ tài khoản đang đăng nhập">
            <Input value={currentUser?.fullName || currentUser?.email || ''} disabled className="h-8 text-xs" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Tên khách hàng">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên khách" className="h-8 text-xs" />
          </Field>
          <Field label="Số điện thoại">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0xxxxxxxxx"
              inputMode="tel"
              className="h-8 text-xs"
            />
          </Field>
        </div>

        <Field label="Tỉnh/Thành phố" icon={MapPin}>
          <Select
            value={provinceId != null ? String(provinceId) : ''}
            onValueChange={(v) => { setProvinceId(Number(v)); setWardId(null) }}
            disabled={lookups.isLoading}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Chọn tỉnh/thành phố" /></SelectTrigger>
            <SelectContent>
              {provinces.map((p) => (
                <SelectItem key={p.id} value={String(p.id)} className="text-xs">{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Phường/Xã" icon={MapPin}>
          <Select
            value={wardId != null ? String(wardId) : ''}
            onValueChange={(v) => setWardId(Number(v))}
            disabled={!provinceId || wards.isLoading}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={!provinceId ? 'Chọn tỉnh trước' : wards.isLoading ? 'Đang tải…' : 'Chọn phường/xã'} />
            </SelectTrigger>
            <SelectContent>
              {wardList.map((w) => (
                <SelectItem key={w.id} value={String(w.id)} className="text-xs">{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Địa chỉ chi tiết" icon={MapPin}>
          <Input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Số nhà, đường…" className="h-8 text-xs" />
        </Field>
      </Section>

      {/* (b) Thông tin khác */}
      <Section title="Thông tin khác" icon={Info}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nguồn đơn hàng">
            <Select value={orderSource} onValueChange={setOrderSource}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Chọn nguồn" /></SelectTrigger>
              <SelectContent>
                {ORDER_SOURCE_OPTIONS.map((o) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Loại đơn hàng">
            <Select value={orderType} onValueChange={setOrderType}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Chọn loại" /></SelectTrigger>
              <SelectContent>
                {ORDER_TYPE_OPTIONS.map((o) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Ghi chú">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Nhập ghi chú đơn hàng…"
            className="min-h-[56px] text-xs"
          />
        </Field>
      </Section>

      {/* (c) Sản phẩm */}
      <Section title="Sản phẩm" icon={Package}>
        <div className="flex gap-2">
          <Select
            value={warehouseId != null ? String(warehouseId) : ''}
            onValueChange={(v) => setWarehouseId(Number(v))}
            disabled={lookups.isLoading || catalogQ.isFetching}
          >
            <SelectTrigger className="h-8 w-[104px] shrink-0 text-xs" title="Kho hàng"><SelectValue placeholder="Kho" /></SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => <SelectItem key={w.id} value={String(w.id)} className="text-xs">{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <ProductSearch mode="product" catalog={catalog} loading={catalogQ.isLoading} onPick={addProduct} />
        </div>
        {/* Ô quà tặng tách riêng — khớp bản prod, tránh bấm nhầm khi lên đơn. */}
        <ProductSearch mode="gift" catalog={catalog} loading={catalogQ.isLoading} onPick={addProduct} />

        {!catalogQ.isLoading && !catalog.length && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11px] text-foreground">
            <b>Kho này chưa có sản phẩm nào.</b> Chọn kho khác để tiếp tục lên đơn.
          </p>
        )}
        {!lines.length && catalog.length > 0 && (
          <p className="rounded-md border border-dashed px-2.5 py-3 text-center text-[11px] text-muted-foreground">
            Chưa có sản phẩm — gõ vào ô tìm kiếm để thêm vào đơn.
          </p>
        )}

        <div className="space-y-2">
          {lines.map((line, i) => (
            <LineCard
              key={`${line.code}-${line.isGift ? 'g' : 'p'}`}
              line={line}
              product={catalog.find((p) => p.code === line.code)}
              onQty={(q) => updateLine(i, { quantity: Math.max(1, q) })}
              onToggleGift={() => updateLine(i, { isGift: !line.isGift })}
              onRemove={() => removeLine(i)}
            />
          ))}
        </div>

        {lines.length > 0 && (
          <div className="flex items-center justify-between border-t pt-2">
            <span className="font-medium">Tổng: {totals.totalQty} SP · {formatNumber(totals.totalWeight)}g</span>
            <b className="text-sm tabular-nums">{formatVnd(totals.subtotal)}</b>
          </div>
        )}
      </Section>

      {/* (d) Vận chuyển */}
      <Section
        title="Vận chuyển"
        icon={Truck}
        right={
          <CheckLabel checked={selfShipping} onChange={setSelfShipping} label="Tự vận chuyển" />
        }
      >
        <Field label="Đơn vị vận chuyển">
          <Select value={shippingProvider} onValueChange={(v) => changeProvider(v as ShippingProvider)} disabled={selfShipping}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CARRIERS.map((c) => (
                <SelectItem key={c} value={c} className="text-xs">
                  {CARRIER_LABELS[c]}{CARRIER_FEES[c] ? ` - ${formatNumber(CARRIER_FEES[c])}đ` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Phí vận chuyển">
            <MoneyInput value={shippingFee} onChange={setShippingFee} suffix="đ" disabled={selfShipping} />
          </Field>
          <Field label="Loại phí ship">
            <Select value={typeFeeDelivery} onValueChange={(v) => setTypeFeeDelivery(v as TypeFeeDelivery)} disabled={selfShipping}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CC_CASH" className="text-xs">Khách trả ship</SelectItem>
                <SelectItem value="PP_CASH" className="text-xs">Shop hỗ trợ ship</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {!selfShipping && (
          <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" /> {CARRIER_INFO[shippingProvider]}
          </p>
        )}
        {selfShipping && (
          <p className="text-[11px] text-muted-foreground">Tự vận chuyển: không tính phí ship vào đơn.</p>
        )}

        <div className="grid grid-cols-4 gap-1.5">
          <Input value={`${formatNumber(totals.totalWeight)} g`} disabled className="h-8 px-2 text-[11px]" title="Khối lượng (gram) — tự tính theo bảng sản phẩm" />
          <Input placeholder="Dài" disabled className="h-8 px-2 text-[11px]" />
          <Input placeholder="Rộng" disabled className="h-8 px-2 text-[11px]" />
          <Input placeholder="Cao" disabled className="h-8 px-2 text-[11px]" />
        </div>
        <PendingHint>Khối lượng / kích thước gói hàng</PendingHint>

        <div className="flex items-center justify-between">
          <CheckLabel checked={isFragile} onChange={setIsFragile} label="Hàng dễ vỡ" />
          <CheckLabel checked={isExchange} onChange={toggleExchange} label="Đơn đổi trả" />
        </div>
        {isExchange && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px]">{RETURN_NOTE_TEXT}</p>
        )}
      </Section>

      {/* (e) Thanh toán */}
      <Section title="Thanh toán" icon={CreditCard}>
        {/* Chiết khấu */}
        <SumRow
          label={
            <span className="flex items-center gap-1.5">
              Chiết khấu
              <span className="inline-flex rounded-md bg-muted p-0.5">
                {(['pct', 'vnd'] as DiscountType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDiscountType(t)}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-bold',
                      discountType === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {t === 'pct' ? '%' : 'đ'}
                  </button>
                ))}
              </span>
            </span>
          }
        >
          {discountType === 'pct' ? (
            <MoneyInput value={discountPercent} onChange={(v) => setDiscountPercent(Math.min(100, v))} suffix="%" className="w-[110px]" />
          ) : (
            <MoneyInput value={discountAmount} onChange={setDiscountAmount} suffix="đ" className="w-[130px]" />
          )}
        </SumRow>
        {totals.discount > 0 && (
          <SumRow label={<span className="text-muted-foreground">Tiền giảm{discountType === 'pct' ? ` (${discountPercent}%)` : ''}</span>}>
            <span className="font-semibold text-destructive">−{formatVnd(totals.discount)}</span>
          </SumRow>
        )}

        {/* Mã ưu đãi */}
        <SumRow label={<span className="flex items-center gap-1"><Tag className="h-3 w-3" /> Mã ưu đãi</span>}>
          <div className="flex w-[170px] gap-1">
            <Input
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  handlePromo()
                }
              }}
              placeholder="Nhập mã"
              disabled={!!promoApplied}
              className="h-8 flex-1 uppercase text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant={promoApplied ? 'destructive' : 'default'}
              className="h-8 px-2.5"
              onClick={handlePromo}
              disabled={applyPromo.isPending}
            >
              {applyPromo.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : promoApplied ? 'Bỏ' : 'Áp dụng'}
            </Button>
          </div>
        </SumRow>
        {promoApplied && (
          <p className="text-right text-[11px] text-success">
            ✓ {promoApplied.message || 'Đã áp dụng mã'}
            {promoApplied.free_shipping ? ' · Miễn phí ship' : ''}
            {promoApplied.discount_amount > 0 ? ` · −${formatVnd(promoApplied.discount_amount)}` : ''}
          </p>
        )}
        {!promoApplied && eligiblePromos.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {eligiblePromos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPromoCode(p.code ?? '')}
                title={[p.name, ...(p.conditions_text ?? [])].join(' · ')}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-medium hover:bg-accent',
                  promoCode === p.code && 'border-primary bg-primary/10 text-primary',
                )}
              >
                {p.code}
              </button>
            ))}
          </div>
        )}

        {/* Tiêu Lá */}
        <SumRow
          label={
            <span>
              Tiêu "Lá" <em className="not-italic text-[10px] text-muted-foreground">1 Lá = 1.000đ</em>
              {pointsBalance != null && (
                <span className="ml-1 text-[10px] text-muted-foreground">· dư {formatNumber(pointsBalance)}</span>
              )}
            </span>
          }
        >
          <MoneyInput
            value={usedPoints}
            onChange={(v) => setUsedPoints(clampPoints(v, pointsBalance))}
            suffix="Lá"
            className="w-[110px]"
            disabled={pointsBalance != null && pointsBalance <= 0}
          />
        </SumRow>
        <SumRow label="Quy đổi Lá">
          <span className="font-semibold">{totals.pointsDiscount > 0 ? `−${formatVnd(totals.pointsDiscount)}` : '0 ₫'}</span>
        </SumRow>
        <SumRow label="Phí vận chuyển">
          <span className="font-semibold">
            {formatVnd(totals.shippingCharged)}
            {typeFeeDelivery === 'PP_CASH' && !selfShipping && totals.shippingFeePayload > 0 && (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">(shop hỗ trợ {formatVnd(totals.shippingFeePayload)})</span>
            )}
          </span>
        </SumRow>

        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-[13px] font-bold">Tổng thanh toán</span>
          <span className="text-base font-extrabold tabular-nums text-primary">{formatVnd(totals.total)}</span>
        </div>

        <SumRow label="Chuyển khoản (đặt cọc)">
          <MoneyInput value={depositAmount} onChange={setDepositAmount} suffix="đ" className="w-[130px]" />
        </SumRow>
        <SumRow label="Đã đặt cọc">
          <span className="font-semibold text-success">{formatVnd(totals.deposit)}</span>
        </SumRow>
        <SumRow label="Còn phải thu (COD)">
          <span className="text-sm font-bold text-warning">{formatVnd(totals.codRemaining)}</span>
        </SumRow>
        <SumRow label="Trạng thái thanh toán">
          <Badge
            variant={
              totals.payStatus === 'paid' ? 'success'
                : totals.payStatus === 'partial' ? 'warning'
                : totals.payStatus === 'over' ? 'destructive'
                : 'secondary'
            }
            className="text-[10px]"
          >
            {PAY_STATUS_LABELS[totals.payStatus]}
          </Badge>
        </SumRow>
      </Section>

      {/* (f) Nút */}
      <div className="sticky bottom-0 flex gap-2 border-t bg-background pt-2">
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={resetAfterCreate} disabled={createOrder.isPending}>
          <RefreshCw /> Tạo lại
        </Button>
        <Button type="button" size="sm" className="h-9 flex-1" onClick={submit} disabled={submitDisabled}>
          {createOrder.isPending ? <Loader2 className="animate-spin" /> : <ShoppingCart />}
          {createOrder.isPending ? 'Đang đồng bộ CRM & FM…' : 'Lên đơn'}
        </Button>
      </div>
    </div>
  )
}

// ── Khối con ──────────────────────────────────────────────────────────

function Section({
  title, icon: Icon, right, children,
}: {
  title: string
  icon: typeof User
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <span className="h-3.5 w-0.5 rounded bg-primary" />
          <Icon className="h-3.5 w-3.5 text-primary" /> {title}
        </p>
        {right}
      </div>
      {children}
    </section>
  )
}

function Field({
  label, icon: Icon, hint, children,
}: {
  label: string
  icon?: typeof MapPin
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SumRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[28px] items-center justify-between gap-2">
      <span className="font-medium">{label}</span>
      {children}
    </div>
  )
}

function PendingHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] text-muted-foreground">
      {children} — <Badge variant="outline" className="px-1.5 py-0 text-[9px]">chờ backend</Badge>
    </p>
  )
}

function CheckLabel({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  )
}

/**
 * Ô nhập số kiểu VN: hiện "1.234.567", nhận cả chuỗi có dấu chấm/phẩy/khoảng
 * trắng (bỏ mọi ký tự không phải số). Giá trị 0 hiện ô trống.
 */
function MoneyInput({
  value, onChange, suffix, disabled, className, placeholder = '0',
}: {
  value: number
  onChange: (v: number) => void
  suffix?: string
  disabled?: boolean
  className?: string
  placeholder?: string
}) {
  return (
    <div className={cn('flex h-8 items-center rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring', disabled && 'opacity-50', className)}>
      <input
        type="text"
        inputMode="numeric"
        value={value > 0 ? formatNumber(value) : ''}
        onChange={(e) => onChange(parseVnNumber(e.target.value))}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full min-w-0 bg-transparent text-right text-xs font-semibold tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      {suffix && <span className="ml-1 shrink-0 text-[11px] text-muted-foreground">{suffix}</span>}
    </div>
  )
}

/**
 * Ô tìm sản phẩm (không phân biệt dấu) + danh sách gợi ý thả xuống.
 *
 * Có HAI ô riêng như bản prod (`order-ui-bridge.js`): "Tìm sản phẩm" và
 * "Tìm quà tặng". Cùng tra trên một danh mục kho, chỉ khác ở chỗ ô quà tặng
 * thêm dòng với `isGift = true` (đơn giá về 0đ, không tính vào tiền hàng).
 * Tách ô để nhân viên không bấm nhầm nút "Quà tặng" nằm lẫn trong kết quả.
 */
function ProductSearch({
  catalog, loading, onPick, mode,
}: {
  catalog: CatalogProduct[]
  loading: boolean
  onPick: (p: CatalogProduct, asGift?: boolean) => void
  mode: 'product' | 'gift'
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const isGift = mode === 'gift'

  const matched = useMemo(
    () => (q.trim() ? catalog.filter((p) => matchesQuery(p, q)).slice(0, 30) : []),
    [catalog, q],
  )

  function pick(p: CatalogProduct) {
    onPick(p, isGift)
    setQ('')
    setOpen(false)
  }

  return (
    <div className="relative min-w-0 flex-1">
      <div
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-md border bg-background px-2 focus-within:ring-2 focus-within:ring-ring',
          isGift ? 'border-warning/50' : 'border-input',
        )}
      >
        {loading
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          : isGift
            ? <Gift className="h-3.5 w-3.5 shrink-0 text-warning" />
            : <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            // Bộ gõ tiếng Việt chưa chốt ký tự → không xử lý Enter.
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              if (matched[0]) pick(matched[0])
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder={loading ? 'Đang tải danh mục…' : isGift ? 'Tìm quà tặng' : 'Tìm sản phẩm'}
          disabled={loading || !catalog.length}
          autoComplete="off"
          className="w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>

      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
          {!matched.length ? (
            <p className="px-2 py-2 text-center text-[11px] text-muted-foreground">
              {isGift ? 'Không tìm thấy quà tặng' : 'Không tìm thấy sản phẩm'}
            </p>
          ) : (
            matched.map((p) => (
              <button
                key={p.code}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(p) }}
                title={isGift ? 'Thêm làm quà tặng (0đ)' : 'Thêm vào đơn'}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left',
                  isGift ? 'hover:bg-warning/10' : 'hover:bg-accent',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{p.name}</span>
                  <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className={cn('rounded px-1 font-mono', isGift ? 'bg-warning/15 text-warning' : 'bg-muted')}>{p.code}</span>
                    {p.weight ? <span>{p.weight}g</span> : null}
                    {p.inventory > 0
                      ? <span className="font-semibold text-success">Tồn {formatNumber(p.inventory)}</span>
                      : <span className="font-bold text-destructive">HẾT HÀNG</span>}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {isGift ? (
                    <>
                      <span className="block text-xs font-bold tabular-nums text-warning">0 ₫</span>
                      <span className="block text-[10px] font-medium text-warning">+ Thêm quà 🎁</span>
                    </>
                  ) : (
                    <span className="block text-xs font-bold tabular-nums">{formatVnd(p.price)}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Một dòng sản phẩm trong đơn. */
function LineCard({
  line, product, onQty, onToggleGift, onRemove,
}: {
  line: OrderLine
  product?: CatalogProduct
  onQty: (q: number) => void
  onToggleGift: () => void
  onRemove: () => void
}) {
  const inventory = product?.inventory ?? line.inventory ?? null
  const weight = product?.weight ?? line.weight ?? null
  const unit = product?.unit ?? line.unit ?? null
  const vat = product?.vat_note ?? line.vatNote ?? null
  const over = inventory != null && inventory > 0 && line.quantity > inventory

  return (
    <div className={cn('rounded-lg border p-2.5', line.isGift ? 'border-warning/40 bg-warning/5' : 'bg-background', over && 'border-destructive/50')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-xs font-bold">{line.code}</span>
          {line.isGift && <Badge variant="warning" className="px-1.5 py-0 text-[9px]">Quà tặng</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn('h-6 w-6', line.isGift && 'text-warning')}
            onClick={onToggleGift}
            title={line.isGift ? 'Bỏ đánh dấu quà tặng' : 'Đánh dấu quà tặng (0đ)'}
          >
            <Gift className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={onRemove} title="Xoá dòng">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
        {line.name}
        {unit ? ` · ${unit}` : ''}
        {weight ? ` · ${weight}g` : ''}
        {line.isGift ? ' · Quà tặng — không tính tiền' : vat ? ` · ${vat}` : ''}
      </p>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          <div>{line.isGift ? '0 ₫' : formatVnd(line.price)}{unit ? `/${unit}` : ''}</div>
          <div>
            {inventory == null
              ? 'Tồn: —'
              : inventory > 0
                ? <>Tồn: <b className={cn('text-foreground', over && 'text-destructive')}>{formatNumber(inventory)}</b>{over ? ' (vượt tồn)' : ''}</>
                : <b className="text-destructive">HẾT HÀNG</b>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="inline-flex items-center overflow-hidden rounded-md border">
            <button type="button" onClick={() => onQty(line.quantity - 1)} disabled={line.quantity <= 1} className="flex h-6 w-6 items-center justify-center hover:bg-accent disabled:opacity-40">
              <Minus className="h-3 w-3" />
            </button>
            <input
              type="text"
              inputMode="numeric"
              value={line.quantity}
              onChange={(e) => onQty(parseVnNumber(e.target.value) || 1)}
              className="h-6 w-9 bg-transparent text-center text-xs font-bold outline-none"
            />
            <button type="button" onClick={() => onQty(line.quantity + 1)} className="flex h-6 w-6 items-center justify-center hover:bg-accent">
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <b className="text-sm tabular-nums">{formatVnd(lineTotal(line))}</b>
        </div>
      </div>
    </div>
  )
}
