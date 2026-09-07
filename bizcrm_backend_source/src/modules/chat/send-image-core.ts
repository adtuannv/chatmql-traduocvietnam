/**
 * send-image-core.ts — gửi MỘT ảnh ra kênh chat và ghi vào lịch sử hội thoại.
 *
 * Tách ra từ luồng nhân viên gửi ảnh (chat-message-routes) để AI dùng lại đúng
 * một đường đi. Trước đây AI chỉ trả lời được bằng chữ vì sendMessageCore chỉ
 * nhận text; giờ AI có thể gửi kèm ảnh sản phẩm cho khách.
 *
 * Ảnh CHỈ được lấy từ URL do máy chủ tự phân giải (ảnh sản phẩm đã duyệt trong
 * catalog). Không bao giờ nhận URL do mô hình sinh ra — mô hình chỉ được nói
 * "gửi ảnh sản phẩm nào", còn nội dung gửi đi do máy chủ quyết định.
 */
import { readFile, access } from 'fs/promises'
import path from 'path'
import { prisma } from '../../shared/prisma-client.js'
import { logger } from '../../shared/logger.js'
import { SenderType, Platform } from '../../shared/constants.js'
import { getPoolEntry, sendImageViaPool } from '../zalo/zalo-pool.js'
import { checkLimits, recordAction } from '../zalo/zalo-rate-limiter.js'
import { PRODUCT_UPLOADS_DIR } from '../products/product-routes.js'
import { CHAT_MEDIA_DIR } from './chat-media-store.js'
import { DOC_ASSETS_DIR } from '../doc-library/doc-assets-store.js'
import { emitNewMessage } from '../realtime/socket-gateway.js'
import { transformMessageForFrontend } from './chat-routes.js'

export interface SendImageCoreParams {
  orgId: string
  conversationId: string
  /** URL ảnh do máy chủ phân giải — tuyệt đối hoặc /uploads/... */
  imageUrl: string
  caption?: string
  sender: 'ai' | 'staff'
  repliedByUserId?: string | null
  aiReplyRunId?: string | null
}

export interface SendImageCoreResult {
  sent: boolean
  messageId?: string
  error?: string
}

/**
 * Đổi URL ảnh thành đường dẫn tệp trên đĩa, hoặc null nếu đó là ảnh ở ngoài.
 * Dùng chung cho cả lúc GỬI và lúc KIỂM TRA còn file hay không — hai bên mà
 * tính đường dẫn khác nhau thì sẽ có cảnh "kiểm tra thấy có, lúc gửi lại mất".
 */
function localPathOf(imageUrl: string): string | null {
  const localDirs: Array<[string, string]> = [
    ['/uploads/products/', PRODUCT_UPLOADS_DIR],
    ['/uploads/chat-media/', CHAT_MEDIA_DIR],
    ['/uploads/doc-assets/', DOC_ASSETS_DIR],
  ]
  for (const [prefix, dir] of localDirs) {
    const idx = imageUrl.indexOf(prefix)
    if (idx === -1) continue
    const name = imageUrl.slice(idx + prefix.length).split('?')[0]
    // Chặn đi ngược thư mục: chỉ cho phép tên tệp trần.
    if (!name || name.includes('/') || name.includes('..')) return null
    return path.join(dir, name)
  }
  return null
}

/**
 * Ảnh này có thật sự gửi được không?
 *
 * Phải hỏi TRƯỚC khi để AI nói với khách là "em gửi ảnh ngay". Database còn ghi
 * đường dẫn nhưng file đã mất là chuyện có thật trên hệ thống này — không kiểm
 * thì AI hứa rồi khách chờ mãi không thấy ảnh, tệ hơn là không hứa.
 */
export async function isImageAvailable(imageUrl: string): Promise<boolean> {
  const local = localPathOf(imageUrl)
  if (local) {
    try { await access(local); return true } catch { return false }
  }
  if (!/^https?:\/\//i.test(imageUrl)) return false
  try {
    const res = await fetch(imageUrl, { method: 'HEAD', signal: AbortSignal.timeout(5_000) })
    return res.ok
  } catch { return false }
}

/** Đuôi tệp theo kiểu MIME. Zalo nhìn ĐUÔI để quyết định hiện ảnh hay đính kèm. */
const DUOI_THEO_MIME: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp',
};

/**
 * Bảo đảm tên tệp có đuôi ảnh.
 *
 * Zalo quyết định hiện ảnh hay hiện thẻ đính kèm dựa vào ĐUÔI TỆP, không phải
 * nội dung. Tên không đuôi là khách nhận được một thẻ tệp xám phải bấm tải về —
 * vô dụng cho bán hàng. Đã xảy ra thật: nguồn sản phẩm trả ảnh dạng
 * `data:image/jpeg;base64,...`, tên suy ra từ đó thành `2Q==` và khách nhận
 * được "tệp 2Q== · 132 KB".
 */
function themDuoiAnh(ten: string, mime?: string | null): string {
  const sach = ten.replace(/[^\w.\-]/g, '') || 'anh';
  if (/\.(jpe?g|png|gif|webp|bmp)$/i.test(sach)) return sach;
  return sach + (DUOI_THEO_MIME[(mime ?? '').split(';')[0].trim().toLowerCase()] ?? '.jpg');
}

/** Đọc bytes của ảnh. Ưu tiên đọc thẳng từ đĩa để khỏi tự gọi HTTP vào chính mình. */
async function loadImageBytes(imageUrl: string): Promise<{ buffer: Buffer; filename: string }> {
  // Ảnh nhúng thẳng trong chuỗi: không có tên tệp nào để lấy, phải tự đặt.
  const nhung = /^data:([^;,]+)[^,]*,(.*)$/is.exec(imageUrl);
  if (nhung) {
    const mime = nhung[1];
    const raw = nhung[2];
    const buffer = /;base64/i.test(imageUrl)
      ? Buffer.from(raw, 'base64')
      : Buffer.from(decodeURIComponent(raw), 'utf8');
    return { buffer, filename: themDuoiAnh('anh-san-pham', mime) };
  }

  const local = localPathOf(imageUrl);
  if (local) return { buffer: await readFile(local), filename: themDuoiAnh(path.basename(local)) };

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Không tải được ảnh (${res.status})`);
  const ten = path.basename(new URL(imageUrl, 'http://x').pathname) || 'anh';
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    filename: themDuoiAnh(ten, res.headers.get('content-type')),
  };
}

/** Phản hồi tải lên có dùng làm ảnh để hiện được không. */
function coAnhDungDuoc(raw: string): boolean {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return !!(o.href || o.thumb || o.hdUrl);
  } catch {
    return false;
  }
}

export async function sendImageCore(params: SendImageCoreParams): Promise<SendImageCoreResult> {
  const { orgId, conversationId, imageUrl, caption, sender } = params

  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId },
    select: {
      id: true, channelAccountId: true, threadType: true, externalThreadId: true,
      contact: { select: { zaloUid: true } },
      channelAccount: { select: { platform: true } },
    },
  })
  if (!conv) return { sent: false, error: 'Không tìm thấy hội thoại' }

  let buffer: Buffer
  let filename: string
  try {
    ({ buffer, filename } = await loadImageBytes(imageUrl))
  } catch (err: any) {
    logger.warn({ err, imageUrl }, '[send-image] không đọc được ảnh')
    return { sent: false, error: err?.message || 'Không đọc được ảnh' }
  }

  let sentOut = false
  let uploadedContent: string | undefined

  try {
    if (conv.channelAccount?.platform === Platform.WEBCHAT) {
      sentOut = true
    } else if (conv.channelAccount?.platform === Platform.ZALO_OA) {
      return { sent: false, error: 'Kênh Zalo OA chưa hỗ trợ gửi ảnh tự động' }
    } else if (conv.channelAccountId) {
      const targetUid = conv.externalThreadId || conv.contact?.zaloUid
      if (targetUid) {
        const entry = getPoolEntry(conv.channelAccountId)
        if (entry?.status === 'connected') {
          const rate = checkLimits(conv.channelAccountId, 'message')
          if (!rate.allowed) return { sent: false, error: rate.reason || 'Vượt hạn mức gửi' }

          const r = await sendImageViaPool(
            conv.channelAccountId, targetUid, buffer, filename, caption,
            conv.threadType === 'group' ? 1 : 0,
          )
          sentOut = r.sent
          uploadedContent = r.content
          if (sentOut) recordAction(conv.channelAccountId, 'message')
        }
      }
    }
  } catch (err: any) {
    logger.error({ err, conversationId }, '[send-image] gửi ra kênh thất bại')
    return { sent: false, error: err?.message || 'Gửi ảnh thất bại' }
  }

  // Zalo trả về hai dạng phản hồi khác nhau: ảnh thì có `href`/`thumb`, còn tệp
  // thì có `fileUrl`/`fileName`. Cất nguyên dạng thứ hai vào tin loại ảnh là
  // giao diện nhân viên không tìm ra ảnh nào để vẽ, hiện thành ô ảnh vỡ kèm chữ
  // "Hình ảnh" — đã xảy ra thật. Nhận về dạng nào không dùng được thì bỏ, quay
  // về đường dẫn của chính mình.
  if (uploadedContent && !coAnhDungDuoc(uploadedContent)) {
    logger.warn(
      { conversationId, filename, tra_ve: uploadedContent.slice(0, 120) },
      '[send-image] Zalo trả về phản hồi không phải ảnh — dùng đường dẫn của mình',
    )
    uploadedContent = undefined
  }

  if (!uploadedContent) {
    const abs = /^https?:\/\//i.test(imageUrl)
      ? imageUrl
      : `${(process.env.PUBLIC_API_URL || 'https://chatmql-dev.traduocvietnam.com').replace(/\/$/, '')}${imageUrl}`
    uploadedContent = JSON.stringify({
      href: abs, thumb: abs, hdUrl: abs,
      caption: caption || '', title: filename,
    })
  }

  const message = await prisma.message.create({
    data: {
      conversationId: conv.id,
      senderType: SenderType.SELF,
      senderUid: '',
      senderName: sender === 'ai' ? 'AI' : 'Staff',
      content: uploadedContent,
      contentType: 'image',
      sentAt: new Date(),
      repliedByUserId: params.repliedByUserId ?? null,
    },
    select: {
      id: true,
      conversationId: true,
      senderType: true,
      senderUid: true,
      senderName: true,
      content: true,
      contentType: true,
      sentAt: true,
      isDeleted: true,
      attachments: true,
      aiGenerated: true,
      aiReplyRunId: true,
      responseSource: true,
      repliedByUserId: true,
      externalMsgId: true,
      createdAt: true,
      deletedAt: true,
      albumKey: true,
      albumIndex: true,
      albumTotal: true,
    },
  })

  await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
  })

  try {
    const fePayload = transformMessageForFrontend({
      ...message,
      senderType: SenderType.SELF,
      senderName: sender === 'ai' ? 'AI Assistant' : 'Staff',
    })
    emitNewMessage(orgId, conv.id, fePayload)
  } catch { /* socket error non-fatal */ }

  logger.info(
    { conversationId: conv.id, sender, sentOut, aiReplyRunId: params.aiReplyRunId },
    '[send-image] đã gửi ảnh',
  )
  return { sent: sentOut, messageId: message.id }
}
