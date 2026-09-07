import type { AiMode, LastMessagePreview, MessageAttachment } from '@/hooks/use-conversations'
import { previewText } from './message-content'

// ── Nhãn kênh theo mã platform ──────────────────────────────────────
const PLATFORM_LABEL: Record<number, string> = {
  1: 'Zalo OA',
  2: 'Zalo Cá nhân',
  10: 'Facebook Page',
  11: 'Instagram',
  12: 'Telegram',
  20: 'Webchat',
  30: 'Pancake (Facebook)',
  31: 'Pancake (Instagram)',
  32: 'Pancake (TikTok)',
  33: 'Pancake',
}

export function platformLabel(platform?: number | null): string {
  if (platform == null) return 'Kênh khác'
  return PLATFORM_LABEL[platform] || 'Kênh khác'
}

// ── Nhãn chế độ AI ──────────────────────────────────────────────────
export const AI_MODES: { value: AiMode; label: string; hint: string }[] = [
  { value: 'manual', label: 'Thủ công', hint: 'Nhân viên tự trả lời' },
  { value: 'suggest', label: 'Gợi ý', hint: 'AI soạn nháp để duyệt' },
  { value: 'auto', label: 'Tự động', hint: 'AI tự trả lời khách' },
]

export function aiModeLabel(mode: AiMode): string {
  return AI_MODES.find((m) => m.value === mode)?.label ?? mode
}

// ── Định dạng thời gian ─────────────────────────────────────────────
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'Vừa xong'
  if (min < 60) return `${min} phút`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} giờ`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ngày`
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

export function formatClock(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

// ── Xem trước tin cuối trong danh sách ──────────────────────────────
export function messagePreview(msg?: LastMessagePreview | null): string {
  if (!msg) return 'Chưa có tin nhắn'
  if (msg.isDeleted) return 'Tin đã thu hồi'
  const prefix = msg.senderType === 'self' ? 'Bạn: ' : ''
  // Dùng chung bộ diễn giải với bong bóng chat — trước đây nhánh `default` in
  // thẳng `content`, nên tin dạng JSON (sự kiện nhóm, cuộc gọi…) lòi mã ra danh sách.
  return prefix + previewText(msg)
}

// ── Tách ảnh/tệp từ content JSON (một số tin lưu content dạng JSON) ──
export interface ParsedMedia {
  imageUrl?: string
  fileHref?: string
  fileTitle?: string
  text?: string
}

export function parseContent(content: string | null | undefined, contentType: string): ParsedMedia {
  if (!content) return {}
  const trimmed = content.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      if (contentType === 'image' || obj.thumb || (obj.href && String(obj.href).match(/\.(jpg|jpeg|png|gif|webp)/i))) {
        // Zalo gửi "ảnh kèm chữ" thì phần chữ nằm ở `title` — không lấy ra là
        // mất luôn lời nhắn của khách, chỉ còn mỗi ảnh. Ảnh do nhân viên gửi
        // (backend TDVN) thì chữ ở `caption`, còn `title` là TÊN TỆP → bỏ qua.
        const captionField = typeof obj.caption === 'string' ? obj.caption.trim() : ''
        const titleField = typeof obj.title === 'string' ? obj.title.trim() : ''
        const titleIsFilename = /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(titleField)
        const caption = captionField || (titleIsFilename ? '' : titleField) || undefined
        return { imageUrl: (obj.hdUrl || obj.href || obj.thumb) as string | undefined, text: caption }
      }
      if (contentType === 'file' || obj.title) {
        return { fileHref: obj.href as string | undefined, fileTitle: (obj.title as string) || 'Tệp đính kèm' }
      }
    } catch {
      /* không phải JSON hợp lệ → coi như text */
    }
  }
  return { text: content }
}

// ── Lấy danh sách ảnh từ attachments ────────────────────────────────
export function imageAttachments(attachments?: MessageAttachment[]): string[] {
  if (!attachments?.length) return []
  return attachments
    .filter((a) => a.type === 'photo' || a.type === 'image')
    .map((a) => a.url)
}

export function fileAttachments(attachments?: MessageAttachment[]): MessageAttachment[] {
  if (!attachments?.length) return []
  return attachments.filter((a) => a.type === 'file' || a.type === 'share.file')
}

// ── Sticker Zalo ────────────────────────────────────────────────────
/**
 * Zalo không trả URL ảnh cho sticker — chỉ trả id. Ảnh lấy từ CDN theo id
 * (đúng pattern bản gốc dùng): .../emoticon/sticker/webpc?eid=<id>&size=<size>
 */
export function stickerUrl(id: number | string, size = 130): string {
  return `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${id}&size=${size}`
}

/**
 * Lấy URL ảnh sticker từ nội dung tin nhắn. Backend lưu nhiều dạng:
 *  - URL đầy đủ            → dùng luôn
 *  - JSON {"id":18009,...} → dựng URL từ id
 *  - chuỗi số "47240"      → dựng URL từ số đó
 */
export function stickerUrlFromContent(content: string | null): string | null {
  if (!content) return null
  const raw = content.trim()
  if (/^https?:\/\//.test(raw)) return raw
  if (/^\d+$/.test(raw)) return stickerUrl(raw)
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const id = obj.id ?? obj.stickerId ?? obj.sticker_id
    if (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id))) {
      return stickerUrl(id)
    }
  } catch {
    /* không phải JSON → bỏ qua */
  }
  return null
}
