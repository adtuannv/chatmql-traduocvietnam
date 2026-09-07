import { API_ORIGIN } from '@/lib/config'
import type { Role } from '@/types/api'

/** Nhãn tiếng Việt cho vai trò. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Chủ sở hữu',
  admin: 'Quản trị viên',
  manager: 'Quản lý',
  member: 'Nhân viên',
}

/** Vai trò có thể gán khi thêm/sửa nhân sự (không cho tạo owner mới). */
export const ASSIGNABLE_ROLES: Role[] = ['admin', 'manager', 'member']

/** Biến avatarUrl tương đối (`/uploads/...`) thành URL tuyệt đối tới backend. */
export function avatarSrc(url?: string | null): string | undefined {
  if (!url) return undefined
  if (/^https?:\/\//.test(url)) return url
  return `${API_ORIGIN}${url}`
}

/** Các trường thông tin công ty lưu trong AppSetting (KV). */
export const COMPANY_FIELDS: { key: string; label: string; placeholder: string; type?: string }[] = [
  { key: 'company.name', label: 'Tên công ty', placeholder: 'Công ty TNHH ABC' },
  { key: 'company.phone', label: 'Số điện thoại', placeholder: '0900 000 000' },
  { key: 'company.email', label: 'Email liên hệ', placeholder: 'contact@company.vn', type: 'email' },
  { key: 'company.website', label: 'Website', placeholder: 'https://company.vn' },
  { key: 'company.taxCode', label: 'Mã số thuế', placeholder: '0101234567' },
  { key: 'company.address', label: 'Địa chỉ', placeholder: 'Số 1, Đường ABC, Quận 1, TP.HCM' },
]

/** Nhãn nền tảng kênh giao tiếp — khớp `Platform` ở backend/shared/constants.ts. */
export const PLATFORM_LABEL: Record<number, string> = {
  1: 'Zalo OA',
  2: 'Zalo Cá nhân',
  10: 'Facebook Messenger',
  11: 'Instagram',
  12: 'Telegram',
  20: 'Web Chat',
  30: 'Pancake (Facebook)',
  31: 'Pancake (Instagram)',
  32: 'Pancake (TikTok)',
  39: 'Pancake',
}
