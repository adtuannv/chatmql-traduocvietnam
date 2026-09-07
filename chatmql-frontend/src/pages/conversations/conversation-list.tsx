import { useState } from 'react'
import { toast } from 'sonner'
import { Search, MoreHorizontal, UserPlus, CheckCheck, RefreshCw, Pin, Tag, X, MailOpen, Trash2, Globe, Check, Settings2, Loader2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/misc'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import { Loading, EmptyState, ErrorState } from '@/components/shared/feedback'
import { cn, initials } from '@/lib/utils'
import { api, apiError } from '@/lib/api-client'
import { FEATURES } from '@/lib/features'
import { useQueryClient } from '@tanstack/react-query'
import { useTags, useMyPermissions } from '@/hooks/use-settings'
import { useAuthStore } from '@/stores/auth-store'
import { useMarkUnread, useDeleteConversation, type ConversationListItem } from '@/hooks/use-conversations'
import { ManageTagsDialog } from './conversation-tags'
import { formatRelativeTime, messagePreview } from './lib'

/** Logo nền tảng đè góc avatar — nhận diện nhanh OA / Zalo cá nhân / Messenger / Web. */
function PlatformBadge({ platform }: { platform?: number | null }) {
  if (platform == null) return null
  const base = 'absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-card text-[7px] font-extrabold leading-none text-white select-none'
  switch (platform) {
    case 2: // Zalo cá nhân
      return <span className={base} style={{ background: '#0068ff' }} title="Zalo Cá nhân">Z</span>
    case 1: // Zalo OA
      return <span className={base} style={{ background: '#005ae0' }} title="Zalo OA">OA</span>
    case 10: // Facebook Messenger
      return (
        <span className={base} style={{ background: 'linear-gradient(45deg,#0099FF,#A033FF,#FF5280)' }} title="Facebook Messenger">M</span>
      )
    case 20: // Web Chat
      return (
        <span className={base} style={{ background: '#475569' }} title="Web Chat">
          <Globe className="h-2.5 w-2.5" />
        </span>
      )
    default:
      return null
  }
}

interface Props {
  items: ConversationListItem[]
  activeId?: string
  search: string
  tag?: string
  isLoading: boolean
  isError: boolean
  onSearchChange: (value: string) => void
  onTagChange: (tag?: string) => void
  onSelect: (id: string) => void
  onAddFriend: () => void
  onMarkAllRead: () => void
  onRefresh: () => void
}

export function ConversationList({
  items,
  activeId,
  search,
  tag,
  isLoading,
  isError,
  onSearchChange,
  onTagChange,
  onSelect,
  onAddFriend,
  onMarkAllRead,
  onRefresh,
}: Props) {
  const { data: tags = [] } = useTags()
  const activeTag = tags.find((t) => t.name === tag)
  // Quyền hiệu lực (BE vẫn chốt lại) — "Xoá hội thoại" theo conversations.delete,
  // admin bật/tắt cho từng vai trò trong Cài đặt → Phân quyền.
  const { data: myPerms } = useMyPermissions()
  const role = useAuthStore((s) => s.user?.role)
  // Backend TDVN không có RBAC động: DELETE /conversations/:id chỉ cho owner/admin.
  const canDelete = FEATURES.ROLES_PERMISSIONS
    ? (myPerms?.has('conversations.delete') ?? false)
    : role === 'owner' || role === 'admin'

  // Tra màu nhãn theo tên để hiển thị đúng màu đã cấu hình
  const tagColor = (name: string) => tags.find((t) => t.name === name)?.color ?? '#64748b'

  return (
    <div className="flex h-full flex-col">
      {/* Hàng đầu: tìm kiếm + menu ... */}
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              data-tour="conv-search"
              placeholder="Tìm theo tên, số điện thoại…"
              className="pl-8"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Thao tác khác" className="shrink-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={onAddFriend}>
                <UserPlus className="mr-2 h-4 w-4" />
                Thêm bạn
              </DropdownMenuItem>
              {FEATURES.CHAT_MARK_ALL_READ && (
                <DropdownMenuItem onClick={onMarkAllRead}>
                  <CheckCheck className="mr-2 h-4 w-4" />
                  Đánh dấu tất cả đã đọc
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRefresh}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Làm mới
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Lọc theo nhãn — backend TDVN không đọc `?tag=` nên ẩn */}
        {FEATURES.CHAT_TAG_FILTER && (
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
                <Tag className="h-3.5 w-3.5" />
                {activeTag ? (
                  <span
                    className="max-w-[120px] truncate font-medium"
                    style={{ color: activeTag.color }}
                  >
                    {activeTag.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Tất cả nhãn</span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
              <DropdownMenuLabel>Lọc theo nhãn</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onTagChange(undefined)}>
                Tất cả nhãn
              </DropdownMenuItem>
              {tags.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Chưa có nhãn nào. Tạo trong Cài đặt → Nhãn.
                </div>
              ) : (
                tags.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => onTagChange(t.name)}>
                    <span
                      className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: t.color }}
                    />
                    <span className="truncate">{t.name}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {tag && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-xs text-muted-foreground"
              onClick={() => onTagChange(undefined)}
              aria-label="Bỏ lọc nhãn"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        )}
      </div>

      {/* Danh sách */}
      <ScrollArea data-tour="conv-list" className="flex-1">
        {isLoading ? (
          <Loading label="Đang tải hội thoại…" />
        ) : isError ? (
          <ErrorState message="Không tải được danh sách hội thoại." />
        ) : items.length === 0 ? (
          <EmptyState title="Chưa có hội thoại" description="Hội thoại mới sẽ xuất hiện tại đây." />
        ) : (
          <ul className="divide-y">
            {items.map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                active={c.id === activeId}
                tagColor={tagColor}
                onClick={() => onSelect(c.id)}
                canDelete={canDelete}
              />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}

function ConversationRow({
  conv,
  active,
  tagColor,
  onClick,
  canDelete,
}: {
  conv: ConversationListItem
  active: boolean
  tagColor: (name: string) => string
  onClick: () => void
  canDelete: boolean
}) {
  const unread = conv.unreadCount > 0
  const last = conv.messages?.[0]
  const name = conv.displayName || conv.contact?.fullName || 'Không tên'
  const tags = conv.contact?.tags ?? []

  const markUnread = useMarkUnread()
  const deleteConv = useDeleteConversation()
  const qc = useQueryClient()
  const { data: allTags = [] } = useTags()
  const [manageTagsOpen, setManageTagsOpen] = useState(false)
  const [savingTag, setSavingTag] = useState<string | null>(null)

  /** Gắn/gỡ nhãn ngay trong menu — API thay TOÀN BỘ mảng tags của contact. */
  async function toggleTag(tagName: string) {
    if (!conv.contact?.id || savingTag) return
    const has = tags.includes(tagName)
    const next = has ? tags.filter((t) => t !== tagName) : [...tags, tagName]
    setSavingTag(tagName)
    try {
      await api.put(`/contacts/${conv.contact.id}`, { tags: next })
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      toast.success(has ? `Đã gỡ nhãn "${tagName}"` : `Đã gắn nhãn "${tagName}"`)
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSavingTag(null)
    }
  }

  async function handleMarkUnread() {
    try {
      await markUnread.mutateAsync(conv.id)
      toast.success('Đã đánh dấu chưa đọc')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Xoá hội thoại "${name}"?\nToàn bộ tin nhắn trong CRM sẽ bị xoá (không ảnh hưởng phía Zalo/FB).`)) return
    try {
      await deleteConv.mutateAsync(conv.id)
      toast.success('Đã xoá hội thoại')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent',
          active && 'bg-accent',
        )}
      >
        <div className="relative">
          <Avatar className="h-10 w-10">
            {conv.contact?.avatarUrl && <AvatarImage src={conv.contact.avatarUrl} alt={name} />}
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          {unread && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-card" />
          )}
          <PlatformBadge platform={conv.channelAccount?.platform} />
        </div>

        <div className="min-w-0 flex-1">
          {/* Dòng 1: tên (cắt bằng …) + thời gian */}
          <div className="flex items-baseline gap-2">
            {conv.isPinned && <Pin className="h-3 w-3 shrink-0 self-center text-primary" />}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm',
                unread ? 'font-semibold' : 'font-medium',
              )}
              title={name}
            >
              {name}
            </span>
            {!conv.isReplied && (
              <span
                className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-warning"
                title="Chưa trả lời"
              />
            )}
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatRelativeTime(conv.lastMessageAt)}
            </span>
          </div>

          {/* Dòng 2: nhãn + nội dung tin cuối (1 dòng, cắt bằng …) + số chưa đọc */}
          <div className="mt-0.5 flex items-center gap-1.5">
            {tags.slice(0, 1).map((t) => {
              const color = tagColor(t)
              return (
                <span
                  key={t}
                  className="inline-flex max-w-[84px] shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `${color}22`, color }}
                  title={tags.join(', ')}
                >
                  <Tag className="h-2.5 w-2.5 shrink-0" style={{ fill: color }} />
                  <span className="truncate">{t}</span>
                </span>
              )
            })}
            {tags.length > 1 && (
              <span className="shrink-0 text-[10px] text-muted-foreground" title={tags.join(', ')}>
                +{tags.length - 1}
              </span>
            )}

            <span
              className={cn(
                'min-w-0 flex-1 truncate text-xs',
                unread ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {messagePreview(last)}
            </span>

            {unread && (
              <Badge
                variant="destructive"
                className="min-w-[18px] shrink-0 justify-center rounded-full px-1.5 py-0 text-[10px]"
              >
                {conv.unreadCount}
              </Badge>
            )}
          </div>
        </div>
      </button>

      {/* Menu hành động cuối dòng — hiện khi hover */}
      <div className="absolute right-2 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Hành động hội thoại"
              className="flex h-6 w-6 items-center justify-center rounded-md border bg-card text-muted-foreground shadow-sm hover:bg-muted"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {/* Gắn nhãn: mở thẳng danh sách thẻ (submenu) — không popup */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!conv.contact?.id}>
                <Tag className="mr-2 h-4 w-4" /> Gắn nhãn
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-96 w-60 overflow-y-auto">
                {allTags.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground">Chưa có thẻ phân loại nào.</div>
                ) : (
                  allTags.map((t) => {
                    const checked = tags.includes(t.name)
                    return (
                      <DropdownMenuItem
                        key={t.id}
                        onSelect={(e) => {
                          e.preventDefault() // giữ menu mở để gắn nhiều nhãn liên tiếp
                          void toggleTag(t.name)
                        }}
                        className="gap-2"
                      >
                        <Tag className="h-4 w-4 shrink-0" style={{ color: t.color, fill: t.color }} />
                        <span className="flex-1 truncate">{t.name}</span>
                        {savingTag === t.name ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : checked ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : null}
                      </DropdownMenuItem>
                    )
                  })
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setManageTagsOpen(true)} className="gap-2">
                  <Settings2 className="h-4 w-4" /> Quản lý thẻ phân loại
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {FEATURES.CHAT_MARK_UNREAD && (
              <DropdownMenuItem onClick={() => void handleMarkUnread()}>
                <MailOpen className="h-4 w-4" /> Đánh dấu chưa đọc
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => void handleDelete()}
                >
                  <Trash2 className="h-4 w-4" /> Xoá hội thoại
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Popup quản lý thẻ phân loại (mở từ submenu) */}
      <ManageTagsDialog open={manageTagsOpen} onOpenChange={setManageTagsOpen} tags={allTags} />
    </li>
  )
}
