import type { ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import dayjs from 'dayjs'
import { Label } from '@/components/ui/label'
import { EmptyState, ErrorState } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { isForbidden } from '@/hooks/use-cdp'

/** Thông báo thân thiện khi vai trò hiện tại không được phép truy cập (403). */
export function ForbiddenNotice({ what = 'khu vực này' }: { what?: string }) {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Bạn không có quyền truy cập"
      description={`Vai trò hiện tại không được phép xem ${what}. Liên hệ quản trị viên để được cấp quyền.`}
    />
  )
}

/** Hiển thị lỗi query: 403 → ForbiddenNotice, còn lại → ErrorState. */
export function QueryError({ error, what }: { error: unknown; what?: string }) {
  if (isForbidden(error)) return <ForbiddenNotice what={what} />
  return <ErrorState message={apiError(error)} />
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className ?? 'grid gap-1.5'}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  return dayjs(value).format('HH:mm DD/MM/YYYY')
}

/** Chuỗi JSON rút gọn để hiện trong bảng. */
export function shortJson(value: unknown, max = 80): string {
  if (value == null) return ''
  let s: string
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    s = String(value)
  }
  if (s === '{}' || s === '[]') return ''
  return s.length > max ? `${s.slice(0, max)}…` : s
}
