/**
 * Diễn giải nội dung tin nhắn Zalo sang dạng người đọc được.
 *
 * Zalo trả rất nhiều loại tin dưới dạng JSON và backend lưu nguyên chuỗi đó vào
 * `content` (cố ý — để không mất dữ liệu gốc). Việc dịch sang chữ đẹp là của
 * frontend. Nguyên tắc bắt buộc:
 *
 *   KHÔNG BAO GIỜ để lọt chuỗi JSON thô ra màn hình.
 *
 * Loại nào chưa nhận diện được thì rơi về nhãn theo `contentType`, chứ không
 * hiển thị `{"eventType":"leave",...}` như trước.
 *
 * Dùng chung cho bong bóng chat (`message-bubble.tsx`) và dòng xem trước ở danh
 * sách hội thoại (`lib.ts`) để hai nơi không bao giờ lệch nhau.
 */

export type MessageView =
  /** Thông báo hệ thống — vẽ thành chip xám ở giữa, không phải bong bóng. */
  | { kind: 'system'; text: string }
  | { kind: 'video'; href: string; thumb?: string; durationMs?: number }
  | { kind: 'card'; title: string; description?: string; thumb?: string; href?: string }
  | { kind: 'text'; text: string }

interface Msg {
  content: string | null
  contentType: string
  senderName?: string | null
}

/** Nhãn cuối cùng khi không rút được nội dung nào có nghĩa. */
const TYPE_LABEL: Record<string, string> = {
  image: '[Hình ảnh]',
  video: '[Video]',
  file: '[Tệp đính kèm]',
  sticker: '[Sticker]',
  gif: '[Ảnh động]',
  voice: '[Tin nhắn thoại]',
  audio: '[Âm thanh]',
  location: '[Vị trí]',
  card: '[Danh thiếp]',
  contact_card: '[Danh thiếp]',
  bank_card: '[Thẻ ngân hàng]',
  link: '[Liên kết]',
  call: '[Cuộc gọi]',
  group_event: '[Sự kiện nhóm]',
  birthday_notification: '[Nhắc sinh nhật]',
  rich: '[Tin nhắn hệ thống]',
  doodle: '[Hình vẽ]',
  poll: '[Bình chọn]',
}

/** Sự kiện gắn với một người cụ thể → phải ghép tên vào trước nhãn. */
const MEMBER_EVENTS = new Set([
  'join', 'leave', 'remove_member', 'block_member', 'add_admin', 'remove_admin',
])

function parseJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return null
  try {
    const o = JSON.parse(t) as unknown
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Chuỗi trông như JSON (object hoặc mảng) mà không rút được nội dung nào. */
function looksLikeJson(text: string): boolean {
  if (!/^[{[]/.test(text)) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** Zalo nhét thêm một chuỗi JSON nữa vào trường `params`. */
function params(obj: Record<string, unknown>): Record<string, unknown> {
  return parseJson(obj.params) ?? {}
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (!m) return `${s} giây`
  return s ? `${m} phút ${s} giây` : `${m} phút`
}

/** Sự kiện nhóm: vào/ra nhóm, đổi tên, đổi ảnh… */
function groupEvent(obj: Record<string, unknown>, senderName?: string | null): string {
  const type = str(obj.eventType)
  const label = str(obj.label) || str(obj.displayText)
  const who = str(obj.memberNames) || str(senderName)

  if (MEMBER_EVENTS.has(type)) {
    // Nhãn của các sự kiện này là vế sau ("đã rời nhóm") — thiếu tên thì câu cụt.
    return who ? `${who} ${label}` : `Một thành viên ${label}`
  }
  return label || str(obj.displayText) || 'Sự kiện nhóm'
}

/** Bong bóng cuộc gọi (`sendBubbleMessage` + action `recommened.*`). */
function callEvent(obj: Record<string, unknown>): string {
  const p = params(obj)
  const action = str(obj.action)
  const video = p.calltype === 1
  const kind = video ? 'Cuộc gọi video' : 'Cuộc gọi thoại'
  if (action.includes('misscall')) return `${kind} nhỡ`
  const d = formatDuration(Number(p.duration))
  return d ? `${kind} · ${d}` : kind
}

/**
 * Các loại đã có bộ vẽ riêng trong `message-bubble.tsx` (ảnh, tệp, sticker,
 * danh thiếp, thẻ ngân hàng). Ở đây chỉ trả nhãn cho dòng xem trước, không
 * được trả `card`/`video` kẻo giành mất chỗ vẽ của chúng.
 */
const HAS_OWN_RENDERER = new Set(['image', 'file', 'sticker', 'card', 'bank_card'])

/**
 * Chuyển một tin nhắn thành dạng hiển thị.
 * Luôn trả về thứ đọc được — không bao giờ trả JSON thô.
 */
export function describeMessage(msg: Msg): MessageView {
  const type = msg.contentType
  const raw = msg.content ?? ''
  const obj = parseJson(raw)

  // Sticker lưu đủ kiểu: JSON, id số trần, hoặc URL — không dạng nào đọc được,
  // luôn trả nhãn. Các loại còn lại chỉ thay nhãn khi nội dung là JSON, để giữ
  // phần chữ đẹp sẵn có (ví dụ ảnh lưu "[📷 ten-tep.png]").
  if (type === 'sticker') return { kind: 'text', text: TYPE_LABEL.sticker }
  if (obj && HAS_OWN_RENDERER.has(type)) {
    return { kind: 'text', text: TYPE_LABEL[type] ?? '[Tin nhắn]' }
  }

  // Không phải object JSON → hoặc là chữ thường, hoặc là JSON dạng khác (Zalo
  // gửi biên nhận đã-nhận/đã-xem dưới dạng MẢNG). Mảng thì không có gì để vẽ,
  // phải ra nhãn — nếu trả nguyên chuỗi là lòi mã ra màn hình.
  if (!obj) {
    const text = raw.trim()
    if (!text || looksLikeJson(text)) return { kind: 'text', text: TYPE_LABEL[type] ?? '[Tin nhắn]' }
    return { kind: 'text', text }
  }

  switch (type) {
    case 'group_event':
      return { kind: 'system', text: groupEvent(obj, msg.senderName) }
    case 'call':
      return { kind: 'system', text: callEvent(obj) }
    case 'birthday_notification': {
      // `notifyTxt` là câu hoàn chỉnh Zalo dựng sẵn, đẹp hơn title rời rạc.
      const p = params(obj)
      const text = str(p.notifyTxt) || [str(obj.title), str(obj.description)].filter(Boolean).join(' — ')
      return { kind: 'system', text: text || 'Nhắc sinh nhật' }
    }
    case 'video':
      if (str(obj.href)) {
        return {
          kind: 'video',
          href: str(obj.href),
          thumb: str(obj.thumb) || undefined,
          durationMs: Number(params(obj).duration) || undefined,
        }
      }
      break
  }

  // Gói tin thu hồi lọt vào bảng tin (backend phân loại là `rich`): không có nội
  // dung để vẽ, chỉ có id tin bị gỡ.
  if (obj.globalMsgId !== undefined && 'deleteMsg' in obj) {
    return { kind: 'system', text: 'Một tin nhắn đã được thu hồi' }
  }

  // Dạng thẻ chung của Zalo: title + description + thumb (+ href).
  const title = str(obj.title)
  const description = str(obj.description)
  if (title || description) {
    // Danh thiếp nhét JSON vào `description` — rút số điện thoại ra cho dễ đọc.
    const inner = parseJson(description)
    const phone = inner ? str(inner.phone) : ''
    return {
      kind: 'card',
      title: title || 'Nội dung được chia sẻ',
      description: phone || (inner ? '' : description) || undefined,
      thumb: str(obj.thumb) || undefined,
      href: str(obj.href) || undefined,
    }
  }

  // Hết cách rút chữ → nhãn theo loại. Tuyệt đối không trả JSON.
  return { kind: 'text', text: TYPE_LABEL[type] ?? '[Tin nhắn]' }
}

/** Một dòng gọn cho danh sách hội thoại. */
export function previewText(msg: Msg): string {
  const v = describeMessage(msg)
  switch (v.kind) {
    case 'system':
      return v.text
    case 'video':
      return TYPE_LABEL.video
    case 'card':
      return v.title
    case 'text':
      return v.text
  }
}
