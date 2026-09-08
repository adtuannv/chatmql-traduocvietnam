/**
 * runtime-context.ts — Dữ liệu của PHIÊN hiện tại, thay vào prompt mỗi lượt.
 *
 * Vì sao cần: trước đây prompt hoàn toàn tĩnh, nên AI không biết hai thứ mà nó
 * buộc phải biết để trả lời đúng.
 *
 * 1. NÓ ĐANG TRỰC BẰNG TÀI KHOẢN NÀO. Công ty có 17 nick Zalo, bốn nick trùng
 *    tên. Prompt lại có sẵn câu mẫu ký tên một người cụ thể, nên AI ký tên đó
 *    cho mọi nick — khách nhắn nick A mà được giới thiệu là nhân viên B.
 *
 * 2. HÔM NAY LÀ NGÀY MẤY. Mô hình không có đồng hồ; hỏi "tháng này có ưu đãi
 *    gì" thì nó lấy tháng theo trí nhớ huấn luyện, lệch hẳn thực tế.
 *
 * Cách dùng: viết `{{account_name}}` trong tài liệu, hàm `thayBien` đổi thành
 * giá trị thật. Biến không có dữ liệu thì thay bằng chuỗi rỗng và tài liệu tự
 * nói rõ phải làm gì khi rỗng — thà trống còn hơn để AI thấy `{{...}}` rồi đọc
 * nguyên cả dấu ngoặc ra cho khách.
 */
import { prisma } from '../../shared/prisma-client.js'
import { PlatformLabel } from '../../shared/constants.js'

/** Múi giờ vận hành. Toàn bộ khách và nhân viên đều ở Việt Nam. */
export const MUI_GIO = 'Asia/Ho_Chi_Minh'

export interface RuntimeContext {
  account_name: string
  account_role: string
  channel_name: string
  current_datetime: string
  timezone: string
  customer_name: string
  customer_phone: string
  customer_id: string
}

/** Mã khách CRM nếu bản ghi liên hệ có lưu sẵn. */
function maKhachTuMetadata(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return ''
  const m = meta as Record<string, unknown>
  for (const k of ['customer_code', 'customerCode', 'crm_customer_code', 'ma_kh']) {
    const v = m[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/** Ngày giờ tiếng Việt, đủ thứ trong tuần để AI trả lời "hôm nay thứ mấy". */
function ngayGioVn(d = new Date()): string {
  const f = new Intl.DateTimeFormat('vi-VN', {
    timeZone: MUI_GIO,
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return f.format(d).replace(/^./, (c) => c.toUpperCase())
}

/**
 * Gom dữ liệu phiên từ hội thoại.
 *
 * Không tìm thấy hội thoại thì vẫn trả về thời gian — đó là thứ luôn đúng và
 * luôn cần, không phụ thuộc hội thoại nào.
 */
export async function layRuntimeContext(convId: string): Promise<RuntimeContext> {
  const trong: RuntimeContext = {
    account_name: '', account_role: '', channel_name: '',
    current_datetime: ngayGioVn(), timezone: MUI_GIO,
    customer_name: '', customer_phone: '', customer_id: '',
  }

  try {
    const conv = await prisma.conversation.findFirst({
      where: { id: convId },
      select: {
        displayName: true,
        channelAccount: { select: { displayName: true, phone: true, platform: true } },
        contact: { select: { fullName: true, crmName: true, phone: true, metadata: true } },
      },
    })
    if (!conv) return trong

    const acc = conv.channelAccount
    const ct = conv.contact
    return {
      ...trong,
      account_name: acc?.displayName?.trim() ?? '',
      // Nick nào cũng là người bán hàng; số điện thoại giúp phân biệt các nick
      // trùng tên khi nhân viên đọc lại nhật ký.
      account_role: acc ? `Nhân viên tư vấn bán hàng${acc.phone ? ` (${acc.phone})` : ''}` : '',
      channel_name: acc ? (PlatformLabel[acc.platform] ?? 'Kênh chat') : '',
      customer_name: (ct?.crmName || ct?.fullName || conv.displayName || '').trim(),
      customer_phone: ct?.phone?.trim() ?? '',
      // Mã khách nằm bên CRM. Bản ghi liên hệ có lưu lại thì dùng; không có
      // thì để trống chứ không gọi CRM mỗi lượt — một lượt trả lời không đáng
      // thêm một vòng gọi mạng chỉ để lấy mã hiển thị.
      customer_id: maKhachTuMetadata(ct?.metadata),
    }
  } catch {
    // Đọc hỏng thì vẫn phải trả thời gian: mất tên tài khoản là bất tiện, còn
    // để AI đoán ngày tháng là trả lời sai cho khách.
    return trong
  }
}

/**
 * Thay `{{tên_biến}}` bằng giá trị thật.
 *
 * Chỉ thay đúng những biến khai báo — chuỗi `{{...}}` lạ giữ nguyên để người
 * soạn nhìn thấy mình gõ sai tên biến, thay vì âm thầm biến mất.
 */
export function thayBien(noiDung: string | null | undefined, rc: RuntimeContext): string | null {
  if (!noiDung) return noiDung ?? null
  if (!noiDung.includes('{{')) return noiDung
  return noiDung.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (nguyen, ten: string) => {
    const v = (rc as unknown as Record<string, string>)[ten.toLowerCase()]
    return v === undefined ? nguyen : v
  })
}

/**
 * Khối RUNTIME CONTEXT dựng sẵn, nối vào prompt.
 *
 * Có khối này thì bot nào cũng biết mình là ai và hôm nay ngày mấy, kể cả bot
 * mà người soạn chưa viết `{{account_name}}` vào tài liệu.
 */
export function khoiRuntimeContext(rc: RuntimeContext): string {
  const dong = [
    rc.account_name && `- Tên tài khoản đang trả lời: ${rc.account_name}`,
    rc.account_role && `- Vai trò tài khoản: ${rc.account_role}`,
    rc.channel_name && `- Kênh hội thoại: ${rc.channel_name}`,
    `- Thời gian hiện tại: ${rc.current_datetime}`,
    `- Múi giờ: ${rc.timezone}`,
    rc.customer_name && `- Tên khách hàng: ${rc.customer_name}`,
    rc.customer_phone && `- Số điện thoại khách hàng: ${rc.customer_phone}`,
    rc.customer_id && `- Mã khách hàng: ${rc.customer_id}`,
  ].filter(Boolean).join('\n')

  return `\n## RUNTIME CONTEXT — dữ liệu phiên hiện tại
${dong}

Đây là nguồn đúng cho danh tính tài khoản và thời gian.
- Cần xưng tên hoặc ký tên thì dùng ĐÚNG tên tài khoản ở trên. KHÔNG lấy tên xuất hiện trong tài liệu, câu mẫu hay lịch sử hội thoại. KHÔNG tự đặt tên mới.
- Không có tên tài khoản thì cứ xưng "em", tuyệt đối không bịa tên.
- Mọi câu hỏi liên quan thời gian ("hôm nay", "tháng này", "mai", "bây giờ") tính từ THỜI GIAN HIỆN TẠI ở trên, không lấy ngày trong tài liệu hay theo trí nhớ.`
}
