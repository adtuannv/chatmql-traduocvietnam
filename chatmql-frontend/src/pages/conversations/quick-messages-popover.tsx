/**
 * quick-messages-popover.tsx — Kho "tin nhắn nhanh" đồng bộ từ app Zalo của nhân viên.
 *
 * Dự án KHÔNG có component Popover → dùng DropdownMenu làm popup.
 * Nội dung tin nằm ở `message.title`, từ khoá ở `keyword` (theo dữ liệu Zalo trả về).
 *
 * API (zalo-extra-routes.ts):
 *   GET    /zalo-accounts/:accountId/quick-messages
 *   POST   /zalo-accounts/:accountId/quick-messages          { keyword, title }
 *   PUT    /zalo-accounts/:accountId/quick-messages/:itemId  { keyword, title }
 *   DELETE /zalo-accounts/:accountId/quick-messages/:itemId
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Zap, Search, Pencil, Trash2, Plus, PlugZap } from 'lucide-react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/misc'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Loading, EmptyState, ErrorState } from '@/components/shared/feedback'
import { api, apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const ERR_NOT_CONNECTED = 'Tài khoản Zalo chưa kết nối'
const HINT_NO_ACCOUNT = 'Chỉ dùng với kênh Zalo cá nhân'

/** Tin nhắn nhanh là object passthrough từ zca-js — mọi field đều có thể vắng mặt. */
type RawQuickMessage = Record<string, unknown>

interface QuickMessage {
  id: string
  keyword: string
  title: string
}

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

/** Lấy chuỗi không rỗng từ nhiều tên field khả dĩ (number cũng chấp nhận). */
function pickString(obj: RawQuickMessage, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return null
}

/** Chuẩn hoá 1 item; trả null nếu thiếu id hoặc thiếu nội dung (sẽ bị bỏ qua). */
function normalize(raw: unknown): QuickMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as RawQuickMessage

  const id = pickString(obj, ['id', 'itemId', 'item_id'])
  if (!id) return null

  const message = (obj.message && typeof obj.message === 'object'
    ? (obj.message as RawQuickMessage)
    : {}) as RawQuickMessage

  // Nội dung tin nằm ở message.title; một số bản trả thẳng title/content ở gốc
  const title = pickString(message, ['title']) ?? pickString(obj, ['title', 'content'])
  if (!title) return null

  return { id, keyword: pickString(obj, ['keyword']) ?? '', title }
}

interface Props {
  accountId?: string | null
  onPick: (text: string) => void
}

export function QuickMessagesPopover({ accountId, onPick }: Props) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<QuickMessage | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<QuickMessage | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const queryKey = ['zalo-quick-messages', accountId]

  const query = useQuery({
    queryKey,
    enabled: open && !!accountId,
    retry: false,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get<{ items?: unknown }>(
        `/zalo-accounts/${accountId}/quick-messages`,
      )
      return Array.isArray(data?.items) ? (data.items as unknown[]) : []
    },
  })

  // Đưa con trỏ vào ô tìm kiếm khi mở popup; đóng thì xoá từ khoá cũ
  useEffect(() => {
    if (!open) {
      setSearch('')
      return
    }
    const t = setTimeout(() => searchRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  const items = useMemo(() => {
    const out: QuickMessage[] = []
    for (const raw of query.data ?? []) {
      const norm = normalize(raw)
      if (norm) out.push(norm)
    }
    return out
  }, [query.data])

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase()
    if (!kw) return items
    return items.filter(
      (m) => m.keyword.toLowerCase().includes(kw) || m.title.toLowerCase().includes(kw),
    )
  }, [items, search])

  const deleteMutation = useMutation({
    mutationFn: async (item: QuickMessage) => {
      await api.delete(`/zalo-accounts/${accountId}/quick-messages/${item.id}`)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey })
      toast.success('Đã xoá tin nhắn nhanh')
      setConfirmDelete(null)
    },
    onError: (err) => toast.error(apiError(err)),
  })

  const notConnected = statusOf(query.error) === 503
  const disabled = !accountId

  function pick(item: QuickMessage) {
    onPick(item.title)
    setOpen(false)
  }

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
    setOpen(false)
  }

  function openEdit(item: QuickMessage) {
    setEditing(item)
    setFormOpen(true)
    setOpen(false)
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Tin nhắn nhanh"
            title={disabled ? HINT_NO_ACCOUNT : 'Tin nhắn nhanh'}
          >
            <Zap className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          side="top"
          sideOffset={8}
          className="w-80 p-2"
          // Không để menu cướp phím gõ (typeahead) khi đang nhập từ khoá
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tin nhắn nhanh..."
              aria-label="Tìm tin nhắn nhanh"
              className="h-9 pl-8"
            />
          </div>

          {notConnected ? (
            <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
              <PlugZap className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{ERR_NOT_CONNECTED}</p>
            </div>
          ) : query.isError ? (
            <ErrorState message={apiError(query.error)} />
          ) : query.isPending ? (
            <Loading className="py-10" label="Đang tải..." />
          ) : items.length === 0 ? (
            <EmptyState icon={Zap} title="Chưa có tin nhắn nhanh nào" />
          ) : filtered.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">
              Không tìm thấy tin nhắn nhanh
            </div>
          ) : (
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {filtered.map((item) => (
                <li
                  key={item.id}
                  className="group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
                >
                  <button
                    type="button"
                    onClick={() => pick(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    {item.keyword && (
                      <span className="block text-xs font-semibold text-primary">
                        /{item.keyword}
                      </span>
                    )}
                    <span className="line-clamp-2 text-sm text-foreground">{item.title}</span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1 pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label={`Sửa tin nhanh ${item.keyword || item.title}`}
                      onClick={() => openEdit(item)}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Xoá tin nhanh ${item.keyword || item.title}`}
                      onClick={() => {
                        setConfirmDelete(item)
                        setOpen(false)
                      }}
                      className="text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!notConnected && (
            <>
              <DropdownMenuSeparator />
              <button
                type="button"
                onClick={openCreate}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-primary',
                  'transition-colors hover:bg-accent',
                )}
              >
                <Plus className="h-4 w-4" />
                Thêm tin nhanh
              </button>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <QuickMessageFormDialog
        open={formOpen}
        accountId={accountId}
        item={editing}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Xoá tin nhắn nhanh?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tin nhanh{' '}
            <span className="font-medium text-foreground">
              {confirmDelete?.keyword ? `/${confirmDelete.keyword}` : confirmDelete?.title}
            </span>{' '}
            sẽ bị xoá khỏi tài khoản Zalo. Không thể hoàn tác.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Huỷ
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete)}
            >
              Xoá
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ── Popup thêm mới / cập nhật tin nhanh ─────────────────────────── */

function QuickMessageFormDialog({
  open,
  accountId,
  item,
  onClose,
}: {
  open: boolean
  accountId?: string | null
  item: QuickMessage | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [title, setTitle] = useState('')
  const isEdit = !!item

  useEffect(() => {
    if (open) {
      setKeyword(item?.keyword ?? '')
      setTitle(item?.title ?? '')
    }
  }, [open, item])

  const mutation = useMutation({
    mutationFn: async (payload: { keyword: string; title: string }) => {
      if (isEdit && item) {
        await api.put(`/zalo-accounts/${accountId}/quick-messages/${item.id}`, payload)
      } else {
        await api.post(`/zalo-accounts/${accountId}/quick-messages`, payload)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['zalo-quick-messages', accountId] })
      toast.success(isEdit ? 'Đã cập nhật tin nhắn nhanh' : 'Đã thêm tin nhắn nhanh')
      onClose()
    },
    onError: (err) => toast.error(apiError(err)),
  })

  const canSave = !!accountId && !!keyword.trim() && !!title.trim() && !mutation.isPending

  function submit() {
    if (!canSave) return
    mutation.mutate({ keyword: keyword.trim(), title: title.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Sửa tin nhắn nhanh' : 'Thêm tin nhắn nhanh'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="qm-keyword">
              Từ khoá
            </label>
            <Input
              id="qm-keyword"
              autoFocus
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="vd: chao"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="qm-title">
              Nội dung
            </label>
            <Textarea
              id="qm-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nội dung tin nhắn nhanh"
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Huỷ
          </Button>
          <Button onClick={submit} disabled={!canSave}>
            {isEdit ? 'Lưu thay đổi' : 'Thêm tin nhanh'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
