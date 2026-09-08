import { useMemo, useState } from 'react'
import { Bot, Inbox, Mail, MessageCircleWarning, Pin, Users, type LucideIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/misc'
import { statusMeta, useZaloAccounts, type ChannelAccount } from '@/hooks/use-integrations'
import { CAO_TOI_DA_10_DONG, OTimKenh, TheLocKenh, useBoLocKenh } from '@/components/shared/channel-picker'
import { FEATURES } from '@/lib/features'
import { cn, initials } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ─────────────────────────────────────────────────────────────────────────────

/** Bộ lọc nhanh của danh sách hội thoại. */
export type ConvFilter = 'all' | 'unread' | 'unreplied' | 'ai' | 'pinned'

export interface FilterRailProps {
  /** Bộ lọc đang được chọn. */
  filter: ConvFilter
  /** Đổi bộ lọc. */
  onFilterChange: (f: ConvFilter) => void
  /** Tài khoản kênh đang lọc (bỏ trống = tất cả tài khoản). */
  accountId?: string
  /** Đổi tài khoản kênh; `undefined` nghĩa là "Tất cả tài khoản". */
  onAccountChange: (id?: string) => void
  /** Số đếm hiển thị trên badge. */
  counts?: { unread: number; unreplied: number; ai?: number; total: number }
}

interface FilterItem {
  value: ConvFilter
  label: string
  icon: LucideIcon
}

const FILTER_ITEMS: FilterItem[] = [
  { value: 'all', label: 'Tất cả', icon: Inbox },
  { value: 'unread', label: 'Chưa đọc', icon: Mail },
  { value: 'unreplied', label: 'Chưa trả lời', icon: MessageCircleWarning },
  // Hội thoại đang để AI tự tư vấn (aiMode = auto) — backend lọc qua `?aiMode=`.
  { value: 'ai', label: 'AI tư vấn', icon: Bot },
  // Backend TDVN không có ghim → không có bộ lọc "Đã ghim".
  ...(FEATURES.CHAT_PIN ? [{ value: 'pinned' as const, label: 'Đã ghim', icon: Pin }] : []),
]

/** Rút gọn số lớn để badge không bị tràn (99+). */
function shortCount(n: number): string {
  return n > 99 ? '99+' : String(n)
}

// ─────────────────────────────────────────────────────────────────────────────
// Cột lọc dạng icon rail (ngoài cùng bên trái màn Hội thoại)
// ─────────────────────────────────────────────────────────────────────────────

export function FilterRail({
  filter,
  onFilterChange,
  accountId,
  onAccountChange,
  counts,
}: FilterRailProps) {
  const { data: accounts, isLoading } = useZaloAccounts()
  const list: ChannelAccount[] = accounts ?? []
  const selected = accountId ? list.find((a) => a.id === accountId) : undefined
  const selectedName = selected?.displayName ?? 'Không tên'

  // Lọc theo nền tảng + tìm theo tên. Chỉ hiện tab của nhóm thật sự có tài
  // khoản — công ty không dùng sàn TMĐT thì khỏi nhìn một tab rỗng.
  const loc = useBoLocKenh(list)

  const countOf = (value: ConvFilter): number => {
    if (!counts) return 0
    if (value === 'unread') return counts.unread
    if (value === 'unreplied') return counts.unreplied
    if (value === 'ai') return counts.ai ?? 0
    return 0
  }

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-background py-3">
      {/* ── Ô vuông chọn tài khoản ─────────────────────────────── */}
      {isLoading ? (
        <div
          className="h-10 w-10 animate-pulse rounded-lg border bg-muted"
          aria-label="Đang tải tài khoản"
        />
      ) : (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Chọn tài khoản"
                  className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border bg-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {selected ? (
                    <Avatar className="h-8 w-8 rounded-md">
                      <AvatarImage src={selected.avatarUrl ?? undefined} alt={selectedName} />
                      <AvatarFallback className="rounded-md text-xs">
                        {initials(selected.displayName)}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <Users className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">
              {selected ? selectedName : 'Tất cả tài khoản'}
            </TooltipContent>
          </Tooltip>

          <DropdownMenuContent align="start" side="right" className="w-72">
            <DropdownMenuLabel>Tài khoản kênh</DropdownMenuLabel>

            {/* Lọc theo nền tảng rồi mới tới ô tìm: chọn nhóm là đã đủ trong
                phần lớn trường hợp, gõ tìm chỉ cần khi tên na ná nhau. */}
            <TheLocKenh loc={loc} />
            <OTimKenh value={loc.tuKhoa} onChange={loc.datTuKhoa} />

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onSelect={() => onAccountChange(undefined)}
              className={cn('gap-2', !accountId && 'bg-accent text-accent-foreground')}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border">
                <Users className="h-4 w-4 text-muted-foreground" />
              </span>
              <span className="truncate">Tất cả tài khoản</span>
            </DropdownMenuItem>

            {loc.hienThi.length > 0 && <DropdownMenuSeparator />}

            <div className={CAO_TOI_DA_10_DONG}>
            {loc.hienThi.map((acc) => {
              const meta = statusMeta(acc.liveStatus, acc.isDisabled)
              const name = acc.displayName ?? 'Không tên'
              return (
                <DropdownMenuItem
                  key={acc.id}
                  onSelect={() => onAccountChange(acc.id)}
                  className={cn('gap-2', accountId === acc.id && 'bg-accent text-accent-foreground')}
                >
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarImage src={acc.avatarUrl ?? undefined} alt={name} />
                    <AvatarFallback className="text-xs">{initials(acc.displayName)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <Badge variant={meta.variant} className="shrink-0 px-1.5 py-0 text-[10px]">
                    {meta.label}
                  </Badge>
                </DropdownMenuItem>
              )
            })}
            </div>

            {loc.hienThi.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                {list.length === 0
                  ? 'Chưa có tài khoản kênh nào'
                  : loc.tuKhoa
                    ? `Không có tài khoản nào khớp "${loc.tuKhoa}"`
                    : 'Nhóm này chưa có tài khoản nào'}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* ── Ngăn cách ──────────────────────────────────────────── */}
      <Separator className="my-2 w-8" />

      {/* ── Nhóm nút lọc (chỉ icon) ───────────────────────────── */}
      <nav data-tour="conv-filters" className="flex flex-col items-center gap-1" aria-label="Bộ lọc hội thoại">
        {FILTER_ITEMS.map(({ value, label, icon: Icon }) => {
          const active = filter === value
          const count = countOf(value)
          return (
            <Tooltip key={value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  onClick={() => onFilterChange(value)}
                  className={cn(
                    'relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {count > 0 && (
                    <span
                      className={cn(
                        'absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none',
                        active
                          ? 'bg-primary-foreground text-primary'
                          : 'bg-destructive text-destructive-foreground',
                      )}
                    >
                      {shortCount(count)}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          )
        })}
      </nav>
    </aside>
  )
}

/** Một tab loại kênh trong bảng chọn tài khoản. */
