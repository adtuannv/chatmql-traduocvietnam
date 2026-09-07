/**
 * org-status.tsx — Tiện ích hiển thị trạng thái cấp phép + định dạng ngày.
 * Dùng chung bởi OrgsPage và OrgDetailPage.
 */
import { Badge } from '@/components/ui/badge'
import type { OrgDisplayStatus } from '@/hooks/use-platform'

const STATUS_MAP: Record<OrgDisplayStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  active: { label: 'Đang hoạt động', variant: 'success' },
  unlimited: { label: 'Không giới hạn', variant: 'secondary' },
  expired: { label: 'Đã hết hạn', variant: 'warning' },
  suspended: { label: 'Đã khóa', variant: 'destructive' },
}

export function OrgStatusBadge({ status }: { status: OrgDisplayStatus }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.active
  return <Badge variant={s.variant}>{s.label}</Badge>
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Chủ sở hữu',
  admin: 'Quản trị',
  manager: 'Quản lý',
  member: 'Nhân viên',
}
export function roleLabel(role: string) {
  return ROLE_LABEL[role] ?? role
}

/** Định dạng ngày kiểu VN, hoặc "Không giới hạn" nếu null. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Không giới hạn'
  const d = new Date(value)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Chuyển ISO date → giá trị cho <input type="date"> (yyyy-mm-dd). */
export function toDateInput(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}
