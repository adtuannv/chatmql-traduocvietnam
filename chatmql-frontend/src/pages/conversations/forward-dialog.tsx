import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Forward, Info, Loader2, Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/misc'
import { EmptyState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { cn, initials } from '@/lib/utils'
import {
  useConversations,
  useForwardMessage,
  type ConversationListItem,
} from '@/hooks/use-conversations'
import { platformLabel } from './lib'

/** Backend chỉ nhận tối đa 10 hội thoại đích cho mỗi lần chuyển tiếp. */
const MAX_TARGETS = 10

interface Props {
  sourceConvId: string
  /** null = không có tin nào được chọn → hộp thoại coi như đóng */
  messageId: string | null
  /** Nội dung văn bản của tin; rỗng ⇒ tin không phải văn bản, không chuyển tiếp được */
  messageText: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Một dòng lỗi sau khi gửi, đã ghép sẵn tên hội thoại để hiển thị. */
interface FailedRow {
  conversationId: string
  name: string
  error: string
}

function convName(conv: ConversationListItem): string {
  return conv.displayName || conv.contact?.fullName || 'Không tên'
}

/**
 * Hộp thoại "Chuyển tiếp tin nhắn": chọn tối đa 10 hội thoại đích rồi gửi.
 *
 * Ràng buộc phía backend được phản ánh ngay trên giao diện:
 *  - Tối đa 10 hội thoại mỗi lần.
 *  - Chỉ chuyển tiếp được tin văn bản (ảnh/sticker/tệp sẽ bị từ chối).
 *  - Hội thoại đích phải cùng tài khoản kênh với hội thoại nguồn, nếu khác
 *    sẽ nằm trong danh sách `failed` của kết quả trả về.
 */
export function ForwardDialog({
  sourceConvId,
  messageId,
  messageText,
  open,
  onOpenChange,
}: Props) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [failedRows, setFailedRows] = useState<FailedRow[]>([])

  const forward = useForwardMessage(sourceConvId)

  // Tin không có nội dung văn bản ⇒ không thể chuyển tiếp
  const preview = messageText.trim()
  const isTextMessage = preview.length > 0

  // Debounce ô tìm kiếm 400ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(timer)
  }, [search])

  // Đóng hộp thoại → xoá toàn bộ trạng thái tạm
  useEffect(() => {
    if (open) return
    setSearch('')
    setDebouncedSearch('')
    setSelected([])
    setFailedRows([])
  }, [open])

  const { data, isLoading, isError, error } = useConversations({
    search: debouncedSearch || undefined,
    limit: 50,
  })

  // Bỏ hội thoại nguồn khỏi danh sách đích
  const targets = useMemo(
    () => (data?.conversations ?? []).filter((conv) => conv.id !== sourceConvId),
    [data, sourceConvId],
  )

  const atLimit = selected.length >= MAX_TARGETS

  function toggle(id: string) {
    setFailedRows([])
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= MAX_TARGETS) {
        toast.warning(`Chỉ chọn được tối đa ${MAX_TARGETS} hội thoại mỗi lần`)
        return prev
      }
      return [...prev, id]
    })
  }

  const canSend =
    !!messageId && isTextMessage && selected.length > 0 && !forward.isPending

  async function handleForward() {
    if (!canSend || !messageId) return
    setFailedRows([])
    try {
      const result = await forward.mutateAsync({
        messageId,
        conversationIds: selected,
      })
      const failed = result.failed ?? []

      if (failed.length === 0) {
        toast.success(`Đã chuyển tiếp tới ${result.sent} hội thoại`)
        onOpenChange(false)
        return
      }

      // Có lỗi một phần → giữ hộp thoại mở để người dùng xem lý do
      const byId = new Map(targets.map((conv) => [conv.id, convName(conv)]))
      setFailedRows(
        failed.map((f) => ({
          conversationId: f.conversationId,
          name: byId.get(f.conversationId) || f.conversationId,
          error: f.error,
        })),
      )
      setSelected(failed.map((f) => f.conversationId))

      if (result.sent > 0) {
        toast.warning(
          `Đã gửi ${result.sent} hội thoại, ${failed.length} hội thoại lỗi`,
        )
      } else {
        toast.error(`Không gửi được tới ${failed.length} hội thoại`)
      }
    } catch (err) {
      toast.error(apiError(err) || 'Không chuyển tiếp được tin nhắn.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Chuyển tiếp tin nhắn</DialogTitle>
          <DialogDescription>
            Chọn tối đa {MAX_TARGETS} hội thoại để chuyển tiếp nội dung bên dưới.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Xem trước nội dung sắp chuyển tiếp */}
          <div className="rounded-lg bg-muted p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Nội dung chuyển tiếp
            </p>
            <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">
              {preview || 'Tin nhắn này không có nội dung văn bản.'}
            </p>
          </div>

          {/* Cảnh báo tin không phải văn bản */}
          {!isTextMessage && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p>
                Chỉ chuyển tiếp được tin nhắn văn bản. Tin ảnh, sticker hoặc tệp
                đính kèm sẽ bị từ chối.
              </p>
            </div>
          )}

          {/* Chú thích: đích phải cùng tài khoản kênh với hội thoại nguồn */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Hội thoại đích phải cùng tài khoản kênh với hội thoại nguồn. Hội
              thoại khác kênh sẽ bị báo lỗi khi gửi.
            </p>
          </div>

          {/* Ô tìm kiếm */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              autoComplete="off"
              placeholder="Tìm hội thoại..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Danh sách hội thoại đích */}
          <div className="max-h-72 overflow-y-auto rounded-lg border">
            {isLoading ? (
              <Loading className="py-10" label="Đang tải hội thoại..." />
            ) : isError ? (
              <EmptyState
                icon={AlertTriangle}
                title="Không tải được danh sách hội thoại"
                description={apiError(error) || undefined}
              />
            ) : targets.length === 0 ? (
              <EmptyState
                title="Không có hội thoại phù hợp"
                description={
                  debouncedSearch
                    ? 'Thử từ khoá khác để tìm hội thoại đích.'
                    : 'Chưa có hội thoại nào khác để chuyển tiếp.'
                }
              />
            ) : (
              <ul className="divide-y">
                {targets.map((conv) => {
                  const checked = selected.includes(conv.id)
                  const disabled = !checked && atLimit
                  return (
                    <li key={conv.id}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/60',
                          checked && 'bg-primary/5',
                          disabled && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={() => toggle(conv.id)}
                        />
                        <Avatar className="h-8 w-8">
                          {conv.contact?.avatarUrl && (
                            <AvatarImage src={conv.contact.avatarUrl} alt="" />
                          )}
                          <AvatarFallback>{initials(convName(conv))}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {convName(conv)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {conv.channelAccount?.displayName ||
                              platformLabel(conv.channelAccount?.platform)}
                          </p>
                        </div>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Kết quả lỗi một phần */}
          {failedRows.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm font-medium">
                {failedRows.length} hội thoại chưa nhận được tin
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {failedRows.map((row) => (
                  <li key={row.conversationId} className="break-words">
                    <span className="font-medium text-foreground">{row.name}</span>
                    {' — '}
                    {row.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            Đã chọn {selected.length}/{MAX_TARGETS}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={forward.isPending}
            >
              Huỷ
            </Button>
            <Button type="button" onClick={handleForward} disabled={!canSend}>
              {forward.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Forward className="h-4 w-4" />
              )}
              Chuyển tiếp
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
