/**
 * channel-groups.ts — Gom tài khoản kênh thành nhóm để lọc.
 *
 * Mã nền tảng là số, khai báo ở backend `src/shared/constants.ts`. Nhân viên
 * không nhớ số, họ nghĩ theo "Zalo cá nhân", "OA", "Facebook", "Sàn TMĐT" —
 * bảng này dịch từ số sang cách nghĩ đó.
 *
 * Nhóm "Khác" cố ý tồn tại: Web Chat, Telegram và các kênh thêm sau này không
 * thuộc bốn nhóm trên, bỏ đi thì tài khoản biến mất khỏi bảng chọn.
 */

/** Mã nền tảng — khớp `Platform` trong backend. */
export const PLATFORM = {
  ZALO_OA: 1,
  ZALO_USER: 2,
  FACEBOOK_PAGE: 10,
  INSTAGRAM: 11,
  TELEGRAM: 12,
  WEBCHAT: 20,
  PANCAKE_FB: 30,
  PANCAKE_IG: 31,
  PANCAKE_TIKTOK: 32,
  PANCAKE_OTHER: 39,
} as const

export type ChannelGroupId = 'zalo_user' | 'zalo_oa' | 'facebook' | 'ecommerce' | 'other'

export interface ChannelGroup {
  id: ChannelGroupId
  label: string
  /** Mã nền tảng thuộc nhóm. Rỗng = nhóm hứng phần còn lại. */
  platforms: number[]
}

/** Thứ tự hiển thị bám theo tần suất dùng: Zalo cá nhân là kênh chính của TDVN. */
export const CHANNEL_GROUPS: ChannelGroup[] = [
  { id: 'zalo_user', label: 'Zalo cá nhân', platforms: [PLATFORM.ZALO_USER] },
  { id: 'zalo_oa', label: 'OA', platforms: [PLATFORM.ZALO_OA] },
  {
    id: 'facebook',
    label: 'Facebook',
    // Instagram và Pancake FB/IG đều là kênh Meta — nhân viên coi chung một mối.
    platforms: [PLATFORM.FACEBOOK_PAGE, PLATFORM.INSTAGRAM, PLATFORM.PANCAKE_FB, PLATFORM.PANCAKE_IG],
  },
  {
    id: 'ecommerce',
    label: 'Sàn TMĐT',
    platforms: [PLATFORM.PANCAKE_TIKTOK, PLATFORM.PANCAKE_OTHER],
  },
  { id: 'other', label: 'Khác', platforms: [] },
]

/** Nhóm của một tài khoản. Không khớp nhóm nào thì về "Khác". */
export function groupOfPlatform(platform?: number | null): ChannelGroupId {
  if (platform == null) return 'other'
  const g = CHANNEL_GROUPS.find((x) => x.platforms.includes(platform))
  return g ? g.id : 'other'
}
