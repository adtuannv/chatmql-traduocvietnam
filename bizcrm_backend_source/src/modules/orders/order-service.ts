/**
 * order-service.ts — Điều phối lên đơn từ ChatMQL.
 *
 * KIẾN TRÚC: CRM là chủ sở hữu duy nhất của đơn hàng.
 *
 *   Trình duyệt --(JWT nhân viên)--> ChatMQL backend --(service key)--> CRM API
 *                                          |
 *                                          +--> việc riêng của ChatMQL:
 *                                               cập nhật Contact, đăng thẻ đơn
 *                                               vào hội thoại, ghi log
 *
 * Trước đây file này tự ghi thẳng vào database crm/fm — tức là bản sao thứ hai
 * của nghiệp vụ lên đơn nằm song song với bridge Python, và hai bản đã lệch nhau.
 * Giờ toàn bộ việc ghi đơn nằm ở CRM; ở đây chỉ còn phần thuộc về ChatMQL.
 */
import { randomUUID, createHash } from 'crypto'
import { prisma } from '../../shared/prisma-client.js'
import { logger } from '../../shared/logger.js'
import { buildOrderBill, loadCompanyInfo } from './order-bill.js'
import {
  createOrderOnCrm,
  CrmApiError,
  type CrmCreateOrderResult,
} from './crm-order-client.js'
import { sendImageCore } from '../chat/send-image-core.js'
import { emitNewMessage } from '../realtime/socket-gateway.js'
import { transformMessageForFrontend } from '../chat/chat-routes.js'
import { SenderType } from '../../shared/constants.js'

export interface OrderItemInput {
  productId?: string | number
  productCode: string
  productName: string
  quantity: number
  unitPrice: number
  /** Dòng quà tặng — không tính vào tiền hàng. */
  isGift?: boolean
}

export interface CreateOrderInput {
  orgId: string
  contactId?: string
  conversationId?: string
  createdUserId?: string
  sellerName?: string
  /** Username nhân sự lên đơn (phần trước @ của email). Backend tự điền. */
  sellerUsername?: string
  customerName: string
  customerPhone: string
  shippingAddress: string
  city?: string
  items: OrderItemInput[]
  discountAmount?: number
  shippingFee?: number
  paymentMethod?: 'cod' | 'vietqr' | 'bank_transfer'
  shippingProvider?: 'jt_express' | 'viettel_post' | 'vnpost' | 'other'
  notes?: string
  // ── Đợt 1 ──
  /** Trạng thái đơn do nhân viên chọn. Bỏ trống = Chờ xử lý. */
  orderStatusId?: number
  warehouseId?: number
  provinceId?: number
  provinceName?: string
  wardId?: number
  wardName?: string
  /** Số nhà/đường. shippingAddress vẫn là địa chỉ đầy đủ đã ghép. */
  addressDetail?: string
  // ── Đợt 3 ──
  /** Tiền khách chuyển khoản trước; COD còn phải thu = tổng - số này. */
  depositAmount?: number
  orderType?: string
  orderSource?: string
  selfShipping?: boolean
  isFragile?: boolean
  isExchange?: boolean
  typeFeeDelivery?: 'PP_CASH' | 'CC_CASH'
  /**
   * Khóa chống trùng đơn. Nên do trình duyệt sinh và giữ nguyên qua các lần
   * bấm lại, để timeout rồi thử lại không đẻ ra đơn thứ hai.
   */
  requestId?: string
  /**
   * Nguồn chốt đơn cho báo cáo Chat → Đơn: 'ai' khi đơn xuất phát từ nháp AI
   * (pending action create_order được xác nhận), 'staff' cho mọi ca còn lại.
   * KHÔNG để trình duyệt tự khai — route /orders/create tự xác minh
   * aiPendingActionId với bảng AiPendingAction rồi mới đặt cờ này.
   */
  source?: 'ai' | 'staff'
}

export interface CreateOrderResult extends CrmCreateOrderResult {
  contactUpdated: boolean
  chatMessageCreated: boolean
}

/**
 * Khóa dự phòng khi client không gửi requestId: băm từ nội dung đơn + khung
 * thời gian 2 phút. Hai lần bấm liên tiếp cùng một giỏ hàng sẽ ra cùng khóa,
 * nên vẫn chặn được đa số ca bấm đúp. Client tự sinh khóa vẫn tốt hơn.
 */
function deriveRequestId(input: CreateOrderInput): string {
  const bucket = Math.floor(Date.now() / 120_000)
  const seed = [
    input.orgId,
    input.conversationId ?? input.contactId ?? '',
    input.customerPhone,
    input.items.map(i => `${i.productCode}x${i.quantity}@${i.unitPrice}`).join('|'),
    input.discountAmount ?? 0,
    input.shippingFee ?? 0,
    bucket,
  ].join('::')
  return `chatmql-${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`
}

function formatVnd(amount: number): string {
  return Math.round(amount || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₫'
}

/**
 * Bỏ số điện thoại lặp ở cuối tên. Rất nhiều contact Zalo được đặt tên kèm số
 * ("Anh Thông Bình Phước 0918587052"), in nguyên si ra thẻ đơn thì thành
 * "Anh Thông Bình Phước 0918587052 (0918587052)".
 */
function cleanCustomerName(name: string, phone: string): string {
  const digits = (phone || '').replace(/\D/g, '')
  if (!digits) return name.trim()
  // Về phần số thuê bao (bỏ 84 hoặc 0 đứng đầu) để khớp được cả hai cách viết:
  // tên lưu "84829881052" trong khi số chuẩn hoá là "0829881052".
  const tail = digits.replace(/^(?:84|0)/, '')
  return name
    .replace(new RegExp(`\\s*(?:84|0)?${tail}\\s*$`), '')
    .trim() || name.trim()
}

/**
 * Thẻ đơn hàng đăng vào hội thoại.
 *
 * VIẾT BẰNG VĂN BẢN THUẦN, không markdown: khung chat ChatMQL in thẳng nội dung
 * ra màn hình, nên `**đậm**` hiện nguyên cả hai dấu sao — khách nhìn thấy y hệt
 * nhân viên. Muốn nhấn mạnh thì dùng chữ HOA và ký tự phân cách.
 */
/**
 * Tin xác nhận đơn gửi khách — bố cục phiếu bán hàng, xem order-bill.ts.
 * Tiền lấy từ kết quả CRM trả về (nguồn sự thật), không tự tính lại ở đây.
 */
async function buildOrderCard(
  result: CrmCreateOrderResult,
  input: CreateOrderInput,
): Promise<string> {
  const company = await loadCompanyInfo(input.orgId)
  return buildOrderBill(
    {
      orderCode: result.order_code,
      customerName: cleanCustomerName(input.customerName || '', input.customerPhone || ''),
      customerPhone: input.customerPhone || '',
      shippingAddress: input.shippingAddress || '',
      sellerName: input.sellerName,
      items: input.items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        isGift: i.isGift,
      })),
      subtotal: result.subtotal,
      discountAmount: result.discount_amount,
      shippingFee: result.shipping_fee,
      totalAmount: result.total_amount,
      depositAmount: input.depositAmount,
      paymentMethod: result.payment_method || input.paymentMethod,
      notes: input.notes,
      vietqrUrl: result.vietqr_url,
    },
    company,
  )
}

/**
 * Tạo đơn: gọi CRM, rồi cập nhật dữ liệu phía ChatMQL.
 *
 * Ném CrmApiError nếu CRM từ chối hoặc không ghi được — khi đó KHÔNG có đơn
 * nào được tạo, và cũng không đụng gì tới dữ liệu ChatMQL.
 */
export async function createOrderAndSync(input: CreateOrderInput): Promise<CreateOrderResult> {
  if (!input.items?.length) {
    throw new CrmApiError('Đơn hàng phải có ít nhất 1 sản phẩm', 400)
  }

  const requestId = input.requestId?.trim() || deriveRequestId(input)

  // ── 1. CRM tạo đơn (nguồn sự thật) ────────────────────────────────
  const result = await createOrderOnCrm({
    request_id: requestId,
    customer_phone: input.customerPhone,
    customer_name: input.customerName,
    shipping_address: input.shippingAddress,
    city: input.city ?? '',
    items: input.items.map(i => ({
      product_code: i.productCode,
      product_name: i.productName,
      quantity: i.quantity,
      unit_price: i.unitPrice,
      is_gift: i.isGift ?? false,
    })),
    discount_amount: input.discountAmount ?? 0,
    shipping_fee: input.shippingFee ?? 0,
    payment_method: input.paymentMethod ?? 'cod',
    shipping_provider: input.shippingProvider ?? 'jt_express',
    seller_name: input.sellerName,
    seller_username: input.sellerUsername,
    notes: input.notes ?? '',
    order_status_id: input.orderStatusId,
    warehouse_id: input.warehouseId,
    province_id: input.provinceId,
    province_name: input.provinceName,
    ward_id: input.wardId,
    ward_name: input.wardName,
    address_detail: input.addressDetail,
    deposit_amount: input.depositAmount ?? 0,
    order_type: input.orderType,
    order_source: input.orderSource,
    self_shipping: input.selfShipping ?? false,
    is_fragile: input.isFragile ?? false,
    is_exchange: input.isExchange ?? false,
    type_fee_delivery: input.typeFeeDelivery,
  })

  logger.info(
    { orderCode: result.order_code, requestId, status: result.status, replayed: result.replayed },
    '[orders] CRM đã nhận đơn',
  )

  // Gọi lại trùng request_id: đơn đã tồn tại, không lặp lại phần việc local
  // (nếu không sẽ đẻ ra thẻ đơn hàng thứ hai trong hội thoại).
  if (result.replayed) {
    return { ...result, contactUpdated: false, chatMessageCreated: false }
  }

  // ── 1b. Ghi sự kiện 'order_created' cho báo cáo Chat → Đơn ─────────
  // ChatMQL không có bảng đơn hàng local (đơn nằm ở CRM), nên báo cáo
  // /api/v1/reports/chat-to-order đếm đơn/doanh số từ cdp_events. Chỉ ghi khi
  // CRM đã thực sự nhận đơn (đến được đây là thành công) và KHÔNG replayed.
  // CdpEvent.contactId là FK bắt buộc → thiếu contactId thì tra theo số điện
  // thoại trong org; vẫn không có contact thì đành bỏ qua event (ghi warn),
  // không thể fabricate contact. Hỏng ở đây KHÔNG làm hỏng đơn.
  try {
    let eventContactId = input.contactId ?? null
    if (!eventContactId && input.customerPhone?.trim()) {
      const byPhone = await prisma.contact.findFirst({
        where: { orgId: input.orgId, phone: input.customerPhone.trim(), deletedAt: null },
        select: { id: true },
      })
      eventContactId = byPhone?.id ?? null
    }
    // Kênh của đơn — để báo cáo lọc được theo kênh/tài khoản tương tác.
    // Không có hội thoại (lên đơn ngoài chat) thì để trống, báo cáo lọc theo
    // kênh sẽ không tính đơn này (đúng: không biết nó thuộc kênh nào).
    let eventChannelAccountId: string | null = null
    if (input.conversationId) {
      const cvChan = await prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { channelAccountId: true },
      })
      eventChannelAccountId = cvChan?.channelAccountId ?? null
    }
    if (eventContactId) {
      await prisma.cdpEvent.create({
        data: {
          orgId: input.orgId,
          contactId: eventContactId,
          eventName: 'order_created',
          properties: {
            orderCode: result.order_code,
            total: result.total_amount, // VND nguyên
            source: input.source ?? 'staff',
            ...(input.conversationId ? { conversationId: input.conversationId } : {}),
            ...(eventChannelAccountId ? { channelAccountId: eventChannelAccountId } : {}),
          },
          source: 'chatmql',
          timestamp: new Date(),
        },
      })
    } else {
      logger.warn(
        { orderCode: result.order_code, orgId: input.orgId },
        '[orders] Không tìm được contact — bỏ qua event order_created (báo cáo Chat → Đơn sẽ thiếu đơn này)',
      )
    }
  } catch (err) {
    logger.error({ err, orderCode: result.order_code }, '[orders] Ghi event order_created thất bại')
  }

  // ── 2. Việc riêng của ChatMQL — hỏng ở đây KHÔNG làm hỏng đơn ──────
  let contactUpdated = false
  if (input.contactId) {
    try {
      const contact = await prisma.contact.findFirst({
        where: { id: input.contactId, orgId: input.orgId },
        select: { id: true, phone: true, metadata: true },
      })
      if (contact) {
        const meta =
          contact.metadata && typeof contact.metadata === 'object'
            ? { ...(contact.metadata as Record<string, unknown>) }
            : {}
        meta.address = input.shippingAddress
        if (input.city) meta.city = input.city
        meta.lastOrderCode = result.order_code
        meta.lastOrderAt = new Date().toISOString()

        const data: Record<string, unknown> = {
          metadata: meta,
          leadScore: { increment: 10 },
        }

        // Hơn 8.000 contact đến từ Zalo không có số điện thoại, nên nhân viên
        // phải gõ tay khi lên đơn. Ghi số đó lại vào contact — nếu không, lần
        // sau mở hội thoại vẫn trống, và khung LỊCH SỬ ĐƠN HÀNG (tra theo
        // contact.phone) sẽ mãi không hiện gì dù đơn đã tạo thành công.
        // Chỉ điền khi đang trống, không đè lên số đã có.
        if (!contact.phone?.trim() && input.customerPhone?.trim()) {
          data.phone = input.customerPhone.trim()
          logger.info(
            { contactId: contact.id, orderCode: result.order_code },
            '[orders] Lưu số điện thoại nhân viên nhập vào contact',
          )
        }

        await prisma.contact.update({
          where: { id: contact.id },
          data: data as any,
        })
        contactUpdated = true
      } else {
        logger.warn({ contactId: input.contactId }, '[orders] Không tìm thấy contact để cập nhật')
      }
    } catch (err) {
      logger.error({ err, orderCode: result.order_code }, '[orders] Cập nhật contact thất bại')
    }
  }

  let chatMessageCreated = false
  if (input.conversationId) {
    try {
      const orderMsg = await prisma.message.create({
        data: {
          conversationId: input.conversationId,
          senderType: SenderType.SELF,
          senderName: input.sellerName || 'Staff',
          repliedByUserId: input.createdUserId || null,
          contentType: 'text',
          content: await buildOrderCard(result, input),
          sentAt: new Date(),
        },
      })
      chatMessageCreated = true

      await prisma.conversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
      }).catch(() => {})

      try {
        const fePayload = transformMessageForFrontend({
          ...orderMsg,
          senderType: SenderType.SELF,
          senderName: input.sellerName || 'Staff',
        })
        emitNewMessage(input.orgId, input.conversationId, fePayload)
      } catch { /* socket error non-fatal */ }

      // Nếu đơn hàng thanh toán qua VietQR và có link QR -> Gửi trực tiếp ảnh mã QR vào hội thoại
      if (result.vietqr_url) {
        try {
          await sendImageCore({
            orgId: input.orgId,
            conversationId: input.conversationId,
            imageUrl: result.vietqr_url,
            caption: `Mã QR thanh toán cho đơn hàng ${result.order_code}`,
            sender: 'staff',
            repliedByUserId: input.createdUserId || null,
          })
          logger.info(
            { orderCode: result.order_code, conversationId: input.conversationId },
            '[orders] Đã gửi ảnh mã QR VietQR vào hội thoại',
          )
        } catch (err) {
          logger.error({ err, orderCode: result.order_code }, '[orders] Gửi ảnh mã QR VietQR thất bại')
        }
      }
    } catch (err) {
      logger.error({ err, orderCode: result.order_code }, '[orders] Không đăng được thẻ đơn vào hội thoại')
    }
  }

  return { ...result, contactUpdated, chatMessageCreated }
}

/** Mã đơn dùng cho hiển thị tạm ở client trước khi CRM trả về. */
export function generateOrderCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return `HD_${yy}${mm}${dd}${suffix}`
}
