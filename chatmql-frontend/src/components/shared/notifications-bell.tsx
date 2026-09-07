/**
 * notifications-bell.tsx — Chuông thông báo trên thanh điều hướng.
 *
 * Trước đây thông báo nằm trong một tab của màn Cài đặt, nhưng đó là thứ cần
 * liếc nhanh giữa lúc làm việc chứ không phải đi vào Cài đặt để xem — nên gom
 * hẳn vào chuông, kèm chấm đỏ đếm số chưa đọc.
 *
 * Backend: `GET /notifications`, `PATCH /notifications/:id/read`,
 * `POST /notifications/read-all`. Chưa có API cấu hình bật/tắt theo loại.
 */
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Bell, CheckCheck } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loading, EmptyState } from '@/components/shared/feedback'
import {
  useNotifications, useMarkAllNotificationsRead, useMarkNotificationRead,
} from '@/hooks/use-settings'
import { apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const TYPE_LABEL: Record<string, string> = {
  message: 'Tin nhắn',
  contact: 'Khách hàng',
  appointment: 'Lịch hẹn',
  automation: 'Tự động hóa',
}

/** "3 phút", "2 giờ", "18/06" — đủ để biết mới hay cũ mà không dài dòng. */
function timeAgo(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'Vừa xong'
  if (min < 60) return `${min} phút`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} giờ`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ngày`
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

export function NotificationsBell({ className }: { className?: string }) {
  const { data, isLoading } = useNotifications(20)
  const markAll = useMarkAllNotificationsRead()
  const markOne = useMarkNotificationRead()
  const navigate = useNavigate()

  const unread = data?.unreadCount ?? 0

  const handleMarkAll = async () => {
    try {
      await markAll.mutateAsync()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const open = (n: { id: string; isRead: boolean; link?: string | null }) => {
    if (!n.isRead) markOne.mutate(n.id)
    if (n.link) navigate(n.link)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Thông báo" className={cn('relative', className)}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <p className="flex-1 text-sm font-semibold">Thông báo</p>
          {unread > 0 && (
            <>
              <Badge variant="secondary" className="text-[10px]">{unread} chưa đọc</Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={handleMarkAll}
                disabled={markAll.isPending}
              >
                <CheckCheck className="h-3.5 w-3.5" /> Đọc hết
              </Button>
            </>
          )}
        </div>

        <div className="max-h-[26rem] overflow-y-auto">
          {isLoading ? (
            <div className="p-6"><Loading label="Đang tải…" /></div>
          ) : !data?.notifications.length ? (
            <div className="p-4">
              <EmptyState icon={Bell} title="Chưa có thông báo nào" />
            </div>
          ) : (
            <ul className="divide-y">
              {data.notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={cn(
                      'flex w-full gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent',
                      !n.isRead && 'bg-accent/40',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        n.isRead ? 'bg-transparent' : 'bg-primary',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                      </span>
                      {n.body && (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>
                      )}
                      <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {TYPE_LABEL[n.type] ?? n.type}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
