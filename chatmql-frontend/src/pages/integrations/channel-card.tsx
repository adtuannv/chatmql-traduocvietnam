import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn, initials } from '@/lib/utils'
import type { StatusMeta } from '@/hooks/use-integrations'

/**
 * Thẻ hiển thị một tài khoản kênh: logo/avatar, tên, trạng thái và hành động.
 */
export function ChannelCard({
  icon,
  iconClassName,
  avatarUrl,
  title,
  subtitle,
  status,
  actions,
}: {
  /** Icon nền (lucide) dùng khi không có ảnh avatar. */
  icon?: ReactNode
  iconClassName?: string
  avatarUrl?: string | null
  title: string
  subtitle?: ReactNode
  status?: StatusMeta
  actions?: ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-center gap-3">
          {avatarUrl ? (
            <Avatar className="h-11 w-11">
              <AvatarImage src={avatarUrl} alt={title} />
              <AvatarFallback>{initials(title)}</AvatarFallback>
            </Avatar>
          ) : icon ? (
            <div
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
                iconClassName,
              )}
            >
              {icon}
            </div>
          ) : (
            <Avatar className="h-11 w-11">
              <AvatarFallback>{initials(title)}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{title}</p>
            {subtitle && (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status && <Badge variant={status.variant}>{status.label}</Badge>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </CardContent>
    </Card>
  )
}
