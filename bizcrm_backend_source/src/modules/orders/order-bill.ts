/**
 * order-bill.ts — Soạn tin xác nhận đơn hàng gửi khách qua Zalo cá nhân.
 *
 * Bố cục bám đúng mẫu "PHIẾU GIAO & HÓA ĐƠN BÁN HÀNG" của Trà Dược Việt Nam:
 * đầu trang thông tin công ty, tới thông tin đơn và khách, rồi bảng hàng, rồi
 * phần tiền, cuối là hướng dẫn lấy hoá đơn GTGT.
 *
 * Zalo cá nhân là TIN NHẮN THUẦN CHỮ — không có bảng, không hiểu markdown. Nên
 * bảng hàng được dựng bằng dòng và khoảng trắng, và không dùng ** hay #.
 *
 * Thông tin công ty đọc từ `app_settings` để đổi được mà không phải sửa mã;
 * chưa cấu hình thì rơi về mặc định đúng như phiếu mẫu.
 */
import { prisma } from '../../shared/prisma-client.js'

export interface CompanyInfo {
  name: string
  tagline: string
  address: string
  website: string
  hotline: string
  /** Trang tra hoá đơn GTGT theo mã đơn. */
  invoicePortal: string
}

const DEFAULT_COMPANY: CompanyInfo = {
  name: 'TRÀ DƯỢC VIỆT NAM',
  tagline: 'HÀNG CHÍNH HÃNG',
  address: 'Số 15, Ngõ 19, Đường Hoàng Ngân, Phường Phan Đình Phùng, Tỉnh Thái Nguyên',
  website: 'traduocvietnam.vn',
  hotline: '0344 6868 62',
  invoicePortal: 'hoadon.traduocvietnam.vn',
}

/** Khoá cấu hình trong app_settings, đặt tiền tố `company.` cho gọn nhóm. */
const KEYS: Record<keyof CompanyInfo, string> = {
  name: 'company.name',
  tagline: 'company.tagline',
  address: 'company.address',
  website: 'company.website',
  hotline: 'company.hotline',
  invoicePortal: 'company.invoice_portal',
}

export async function loadCompanyInfo(orgId: string): Promise<CompanyInfo> {
  try {
    const rows = await prisma.appSetting.findMany({
      where: { orgId, settingKey: { in: Object.values(KEYS) } },
      select: { settingKey: true, valuePlain: true },
    })
    const byKey = new Map(rows.map((r) => [r.settingKey, r.valuePlain?.trim() || '']))
    const pick = (k: keyof CompanyInfo) => byKey.get(KEYS[k]) || DEFAULT_COMPANY[k]
    return {
      name: pick('name'),
      tagline: pick('tagline'),
      address: pick('address'),
      website: pick('website'),
      hotline: pick('hotline'),
      invoicePortal: pick('invoicePortal'),
    }
  } catch {
    // Đọc cấu hình hỏng thì vẫn phải gửi được phiếu — dùng mặc định.
    return DEFAULT_COMPANY
  }
}

const vnd = (n: number | null | undefined): string =>
  new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0))

/** "4 tháng 9 năm 2026" — viết như phiếu giấy, không dùng dd/mm. */
function dateVi(d: Date): string {
  return `${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`
}

/** Che số điện thoại như phiếu mẫu, chỉ chừa 4 số cuối. */
function maskPhone(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '')
  if (digits.length <= 4) return digits
  return '*'.repeat(digits.length - 4) + digits.slice(-4)
}

export interface BillItem {
  productName: string
  quantity: number
  unitPrice: number
  isGift?: boolean
}

export interface BillInput {
  orderCode: string
  customerName: string
  customerPhone: string
  shippingAddress: string
  sellerName?: string
  /** Mã khách bên CRM, có thì in như phiếu mẫu. */
  customerCode?: string | null
  items: BillItem[]
  subtotal: number
  discountAmount: number
  shippingFee: number
  totalAmount: number
  depositAmount?: number
  paymentMethod?: string
  notes?: string | null
  vietqrUrl?: string | null
  createdAt?: Date
}

const RULE = '━━━━━━━━━━━━━━━━━━━━'

export function buildOrderBill(bill: BillInput, company: CompanyInfo): string {
  const L: string[] = []

  // ── Đầu phiếu: công ty ──
  L.push(`${company.name} — ${company.tagline}`)
  L.push(`Trụ sở: ${company.address}`)
  L.push(`Website: ${company.website}`)
  L.push(`Phản hồi chất lượng dịch vụ: ${company.hotline}`)
  L.push(RULE)
  L.push('PHIẾU GIAO & HÓA ĐƠN BÁN HÀNG')
  L.push('')

  // ── Thông tin đơn ──
  L.push(`Mã đơn hàng: ${bill.orderCode}`)
  L.push(`Ngày: ${dateVi(bill.createdAt ?? new Date())}`)
  if (bill.sellerName) L.push(`Nhân viên bán hàng: ${bill.sellerName}`)
  L.push('')

  // ── Thông tin khách ──
  L.push(`Khách hàng: ${bill.customerName}`)
  if (bill.customerCode) L.push(`Mã khách hàng: ${bill.customerCode}`)
  L.push(`SĐT: ${maskPhone(bill.customerPhone)}`)
  L.push(`Địa chỉ: ${bill.shippingAddress}`)
  L.push(RULE)

  // ── Bảng hàng: mỗi mặt hàng 2 dòng cho dễ đọc trên điện thoại ──
  bill.items.forEach((it, i) => {
    L.push(`${i + 1}. ${it.productName}`)
    // Dòng quà tặng không ghi đơn giá — ghi "× 47.000 = 0" trông như tính sai.
    L.push(it.isGift
      ? `    SL ${it.quantity} — Tặng kèm`
      : `    SL ${it.quantity} × ${vnd(it.unitPrice)} = ${vnd(it.unitPrice * it.quantity)}`)
  })
  L.push('')

  // ── Phần tiền ──
  L.push(`Tạm tính: ${vnd(bill.subtotal)}`)
  if (bill.discountAmount > 0) L.push(`Giảm giá: -${vnd(bill.discountAmount)}`)
  L.push(`Phí vận chuyển: ${vnd(bill.shippingFee)}`)
  L.push(`TỔNG THANH TOÁN: ${vnd(bill.totalAmount)}`)

  // Đã cọc thì khách cần biết còn phải trả bao nhiêu khi nhận hàng.
  const deposit = Number(bill.depositAmount) || 0
  if (deposit > 0) {
    L.push(`Đã chuyển khoản: ${vnd(deposit)}`)
    L.push(`Còn thu khi nhận hàng: ${vnd(Math.max(0, bill.totalAmount - deposit))}`)
  } else {
    L.push(
      bill.paymentMethod === 'vietqr'
        ? 'Hình thức: Chuyển khoản VietQR'
        : 'Hình thức: Thanh toán khi nhận hàng (COD)',
    )
  }

  if (bill.notes?.trim()) {
    L.push('')
    L.push(`Ghi chú: ${bill.notes.trim()}`)
  }

  if (bill.vietqrUrl) {
    L.push('')
    L.push('Quét mã QR để chuyển khoản:')
    L.push(bill.vietqrUrl)
  }

  // ── Chân phiếu: hướng dẫn lấy hoá đơn GTGT ──
  L.push(RULE)
  L.push(
    `Quý khách truy cập ${company.invoicePortal} và nhập "Mã đơn hàng" để lấy hoá đơn GTGT, ` +
    'hoặc liên hệ nhân viên phụ trách trong vòng 24h kể từ khi giao hàng thành công.',
  )

  return L.join('\n')
}
