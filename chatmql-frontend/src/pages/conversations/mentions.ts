/**
 * mentions.ts — Tính vị trí tag @ ngay trước lúc gửi.
 *
 * Zalo cần `{ pos, uid, len }` với `pos` là CHỈ SỐ KÝ TỰ trong nội dung cuối
 * cùng. Không thể lưu vị trí lúc chèn rồi dùng lại: người dùng gõ thêm/xoá chữ
 * phía trước là mọi vị trí sau đó lệch hết, và tag sẽ trỏ nhầm người.
 *
 * Cách làm ở đây: chỉ nhớ *ai đã được chèn theo thứ tự nào*, còn vị trí thì
 * QUÉT LẠI TỪ ĐẦU ngay trước khi gửi.
 *
 * Nguyên tắc an toàn: mention nào không tìm thấy nguyên vẹn trong nội dung
 * (người dùng đã sửa/xoá tên) thì **bỏ hẳn**, không đoán. Thà mất tag còn hơn
 * tag nhầm người trong nhóm.
 */
import type { MessageMention } from '@/hooks/use-conversations'

/** Một lần chèn @: nhớ uid và đúng chuỗi đã chèn vào ô soạn tin. */
export interface PendingMention {
  uid: string
  /** Chuỗi hiển thị kèm '@', ví dụ "@Lâm Thanh Hà". */
  token: string
}

/** uid Zalo dùng cho "@Tất cả". */
export const MENTION_ALL_UID = '-1'

/**
 * Dò vị trí thật của từng mention trong `text`.
 *
 * Quét theo thứ tự chèn và dùng con trỏ tiến dần, nên hai người trùng tên vẫn
 * ánh xạ đúng lần chèn thứ nhất → thứ hai.
 */
export function resolveMentions(text: string, pending: PendingMention[]): MessageMention[] {
  const out: MessageMention[] = []
  let cursor = 0

  for (const m of pending) {
    const pos = text.indexOf(m.token, cursor)
    if (pos === -1) continue // đã bị sửa/xoá → bỏ, không đoán
    out.push({ pos, uid: m.uid, len: m.token.length })
    cursor = pos + m.token.length
  }
  return out
}

/**
 * Chèn một tag vào ô soạn tin, thay thế phần `@abc` người dùng đang gõ dở.
 *
 * Trả về nội dung mới + vị trí con trỏ mới để component đặt lại caret — không
 * đặt lại thì con trỏ nhảy về cuối, gõ tiếp là sai chỗ.
 */
export function insertMention(
  text: string,
  /** Vị trí ký tự '@' đang gõ dở. */
  triggerAt: number,
  /** Vị trí con trỏ hiện tại (cuối phần đang gõ dở). */
  caret: number,
  label: string,
): { text: string; caret: number; token: string } {
  const token = `@${label}`
  const next = `${text.slice(0, triggerAt)}${token} ${text.slice(caret)}`
  return { text: next, caret: triggerAt + token.length + 1, token }
}

/**
 * Người dùng có đang gõ '@...' không? Trả về vị trí '@' và từ khoá sau nó.
 *
 * Chỉ kích hoạt khi '@' đứng đầu dòng hoặc sau khoảng trắng — nếu không thì
 * địa chỉ email cũng bật danh sách tag.
 */
export function detectMentionQuery(
  text: string,
  caret: number,
): { triggerAt: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null

  const prev = at > 0 ? before[at - 1] : ' '
  if (!/\s/.test(prev)) return null

  const query = before.slice(at + 1)
  // Xuống dòng hoặc gõ quá dài thì coi như không còn định tag nữa.
  if (query.includes('\n') || query.length > 30) return null

  return { triggerAt: at, query }
}

/** Lọc thành viên theo từ khoá, không phân biệt hoa thường và dấu. */
export function filterMembers<T extends { name: string }>(members: T[], query: string): T[] {
  if (!query.trim()) return members
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const q = norm(query)
  return members.filter((m) => norm(m.name).includes(q))
}
