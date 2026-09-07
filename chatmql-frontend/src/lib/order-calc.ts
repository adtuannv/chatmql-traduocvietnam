/**
 * order-calc.ts — Toán tiền cho form "Tạo đơn" (TDVN).
 *
 * Hàm thuần, không React. Giữ NGUYÊN phép tính của bridge cũ
 * (order-ui-bridge.js: calcSubtotal / calcDiscountAmount / calculateTotal /
 * updateSummary) để đơn lên từ giao diện mới ra đúng số như giao diện cũ.
 */
import { formatNumber } from '@/lib/utils'

// ── Kiểu dữ liệu ──────────────────────────────────────────────────────

export interface OrderLine {
  /** Mã sản phẩm (SKU / code_product bên FM). */
  code: string
  name: string
  /** Đơn giá tại thời điểm thêm vào đơn. */
  price: number
  quantity: number
  /** Dòng quà tặng — thành tiền = 0, không tính vào tiền hàng. */
  isGift: boolean
  unit?: string | null
  /** Khối lượng 1 đơn vị (gram). Thiếu thì bridge mặc định 100g. */
  weight?: number | null
  inventory?: number | null
  vatNote?: string | null
}

export type DiscountType = 'pct' | 'vnd'
export type ShippingProvider = 'jt_express' | 'viettel_post' | 'vnpost' | 'other'
export type TypeFeeDelivery = 'CC_CASH' | 'PP_CASH'
export type PayStatus = 'unpaid' | 'partial' | 'paid' | 'over'

export interface PromoResult {
  discount_amount: number
  free_shipping: boolean
}

export interface ComputeTotalsInput {
  lines: OrderLine[]
  discountType: DiscountType
  /** % chiết khấu (kẹp 0–100) — dùng khi discountType = 'pct'. */
  discountPercent: number
  /** Tiền chiết khấu (đ) — dùng khi discountType = 'vnd'. */
  discountAmount: number
  /** Kết quả POST /orders/promotions/apply, null khi chưa áp mã. */
  promo: PromoResult | null
  /** Số Lá tiêu. 1 Lá = 1.000đ. */
  usedPoints: number
  /** Số dư Lá của khách; null = chưa tra được (không kẹp). */
  pointsBalance?: number | null
  shippingFee: number
  selfShipping: boolean
  typeFeeDelivery: TypeFeeDelivery
  depositAmount: number
}

export interface OrderTotals {
  /** Tiền hàng — không gồm quà tặng. */
  subtotal: number
  /** Giá trị quà tặng (chỉ để hiển thị, không tính tiền). */
  giftValue: number
  totalQty: number
  /** Tổng khối lượng (gram). */
  totalWeight: number
  /** Tiền chiết khấu tay (% hoặc đ). */
  discount: number
  promoDiscount: number
  /** Số Lá thực dùng sau khi kẹp theo số dư. */
  pointsUsed: number
  pointsDiscount: number
  /** Phí ship KHÁCH phải trả (đã tính vào tổng). 0 khi tự ship / freeship / PP_CASH. */
  shippingCharged: number
  /** Phí ship gửi sang CRM (`shippingFee` trong body create). */
  shippingFeePayload: number
  /** Tổng giảm gửi sang CRM = chiết khấu + mã + Lá (`discountAmount` trong body). */
  discountPayload: number
  /** Tổng thanh toán. */
  total: number
  deposit: number
  /** COD còn phải thu = tổng − đặt cọc, không âm. */
  codRemaining: number
  payStatus: PayStatus
}

// ── Hằng số ───────────────────────────────────────────────────────────

/** 1 Lá = 1.000đ. */
export const POINT_RATE = 1000

/** Khối lượng mặc định (gram) khi FM không trả weight — theo bridge. */
export const DEFAULT_ITEM_WEIGHT = 100

/** Phí ship mặc định theo hãng — bridge gán khi đổi đơn vị vận chuyển. */
export const CARRIER_FEES: Record<ShippingProvider, number> = {
  jt_express: 30000,
  vnpost: 25000,
  viettel_post: 28000,
  other: 0,
}

export const CARRIER_LABELS: Record<ShippingProvider, string> = {
  jt_express: 'J&T Express',
  vnpost: 'VN Post',
  viettel_post: 'Viettel Post',
  other: 'Khác',
}

export const CARRIER_INFO: Record<ShippingProvider, string> = {
  jt_express: 'J&T Express - Chuyển phát nhanh chuyên nghiệp',
  vnpost: 'VN Post - Mạng lưới bưu cục phủ khắp toàn quốc',
  viettel_post: 'Viettel Post - Giao nhanh, mạng lưới rộng khắp',
  other: 'Đơn vị vận chuyển khác',
}

export const PAY_STATUS_LABELS: Record<PayStatus, string> = {
  unpaid: 'Chưa thanh toán',
  partial: 'Đã cọc một phần',
  paid: 'Đã thanh toán',
  over: 'Đặt cọc vượt tổng đơn',
}

// ── Tiện ích số ───────────────────────────────────────────────────────

/** Ép về số không âm, NaN → 0. */
export function nonNeg(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** Đọc số từ chuỗi người dùng gõ kiểu VN ("1.234.567", "1 234", "25,000") — bỏ mọi ký tự không phải chữ số. */
export function parseVnNumber(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') return nonNeg(raw)
  const digits = String(raw ?? '').replace(/[^\d]/g, '')
  return digits ? Number(digits) : 0
}

/** `1.234.567 ₫` */
export function formatVnd(n: number | null | undefined): string {
  return `${formatNumber(Math.round(nonNeg(n)))} ₫`
}

/** Bỏ dấu tiếng Việt để tìm kiếm — giữ nguyên thuật toán của bridge. */
export function removeVietnameseTones(input: string | null | undefined): string {
  if (!input) return ''
  let str = input.toLowerCase()
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, 'a')
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, 'e')
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, 'i')
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, 'o')
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, 'u')
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, 'y')
  str = str.replace(/đ/g, 'd')
  str = str.replace(/[\u0300-\u036f]/g, '')
  return str.trim()
}

/** Sản phẩm khớp từ khoá (không phân biệt dấu) theo tên hoặc mã. */
export function matchesQuery(p: { name?: string | null; code?: string | null }, query: string): boolean {
  const q = removeVietnameseTones(query)
  if (!q) return false
  return removeVietnameseTones(p.name).includes(q) || removeVietnameseTones(p.code).includes(q)
}

// ── Từng bước tính ────────────────────────────────────────────────────

/** Thành tiền một dòng — quà tặng = 0. */
export function lineTotal(line: OrderLine): number {
  return line.isGift ? 0 : nonNeg(line.price) * nonNeg(line.quantity)
}

/** Tiền hàng — dòng quà tặng không tính. */
export function calcSubtotal(lines: OrderLine[]): number {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0)
}

/** Giá trị quà tặng theo giá gốc (chỉ hiển thị). */
export function calcGiftValue(lines: OrderLine[]): number {
  return lines.reduce((sum, l) => sum + (l.isGift ? nonNeg(l.price) * nonNeg(l.quantity) : 0), 0)
}

export function calcTotalQty(lines: OrderLine[]): number {
  return lines.reduce((sum, l) => sum + nonNeg(l.quantity), 0)
}

/** Tổng khối lượng (gram); thiếu weight thì mặc định 100g/đơn vị như bridge. */
export function calcTotalWeight(lines: OrderLine[]): number {
  return lines.reduce((sum, l) => {
    const w = l.weight && l.weight > 0 ? l.weight : DEFAULT_ITEM_WEIGHT
    return sum + w * nonNeg(l.quantity)
  }, 0)
}

/** Chiết khấu tay: % → làm tròn(sub × %/100) với % kẹp 0–100; đ → không âm. */
export function calcDiscount(subtotal: number, type: DiscountType, percent: number, amount: number): number {
  if (type === 'pct') {
    const pct = Math.max(0, Math.min(100, nonNeg(percent)))
    return Math.round((subtotal * pct) / 100)
  }
  return nonNeg(amount)
}

/** Kẹp số Lá theo số dư (null = không biết số dư → không kẹp). */
export function clampPoints(points: number, balance?: number | null): number {
  const p = Math.floor(nonNeg(points))
  if (balance == null) return p
  return Math.min(p, Math.max(0, Math.floor(balance)))
}

export function pointsToMoney(points: number): number {
  return nonNeg(points) * POINT_RATE
}

/**
 * Phí ship theo luật bridge.
 * - `charged`: phần cộng vào tổng khách trả — chỉ khi CC_CASH, không tự ship, không freeship.
 * - `payload`: phần gửi sang CRM — 0 khi tự ship / freeship, còn lại giữ nguyên
 *   (PP_CASH vẫn gửi phí để CRM biết shop chịu ship).
 */
export function calcShipping(input: {
  shippingFee: number
  selfShipping: boolean
  freeShipping: boolean
  typeFeeDelivery: TypeFeeDelivery
}): { charged: number; payload: number } {
  const fee = nonNeg(input.shippingFee)
  const customerPays = input.typeFeeDelivery === 'CC_CASH' && !input.selfShipping && !input.freeShipping
  return {
    charged: customerPays ? fee : 0,
    payload: input.selfShipping || input.freeShipping ? 0 : fee,
  }
}

export function calcPayStatus(total: number, deposit: number): PayStatus {
  if (deposit <= 0) return 'unpaid'
  if (total > 0 && deposit > total) return 'over'
  if (total > 0 && deposit >= total) return 'paid'
  return 'partial'
}

// ── Tổng hợp ──────────────────────────────────────────────────────────

/**
 * Tổng = max(0, tiền hàng − chiết khấu − mã ưu đãi − Lá×1.000 + ship khách trả)
 * COD  = max(0, tổng − đặt cọc)
 */
export function computeTotals(input: ComputeTotalsInput): OrderTotals {
  const subtotal = calcSubtotal(input.lines)
  const giftValue = calcGiftValue(input.lines)
  const discount = calcDiscount(subtotal, input.discountType, input.discountPercent, input.discountAmount)
  const promoDiscount = nonNeg(input.promo?.discount_amount)
  const pointsUsed = clampPoints(input.usedPoints, input.pointsBalance)
  const pointsDiscount = pointsToMoney(pointsUsed)
  const ship = calcShipping({
    shippingFee: input.shippingFee,
    selfShipping: input.selfShipping,
    freeShipping: !!input.promo?.free_shipping,
    typeFeeDelivery: input.typeFeeDelivery,
  })
  const total = Math.max(0, subtotal - discount - promoDiscount - pointsDiscount + ship.charged)
  const deposit = nonNeg(input.depositAmount)
  const codRemaining = Math.max(0, total - deposit)

  return {
    subtotal,
    giftValue,
    totalQty: calcTotalQty(input.lines),
    totalWeight: calcTotalWeight(input.lines),
    discount,
    promoDiscount,
    pointsUsed,
    pointsDiscount,
    shippingCharged: ship.charged,
    shippingFeePayload: ship.payload,
    discountPayload: discount + promoDiscount + pointsDiscount,
    total,
    deposit,
    codRemaining,
    payStatus: calcPayStatus(total, deposit),
  }
}
