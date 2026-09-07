import { useEffect, useState } from 'react'
import { Tag, Check, Pencil, Trash2, Plus, Settings2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { api, apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import {
  useTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  type TagDef,
} from '@/hooks/use-settings'

/** Bảng màu thẻ phân loại */
const TAG_COLORS = [
  '#ef4444', // đỏ
  '#ec4899', // hồng
  '#f97316', // cam
  '#f59e0b', // vàng
  '#10b981', // xanh lá
  '#14b8a6', // ngọc
  '#3b82f6', // xanh dương
  '#8b5cf6', // tím
]
const DEFAULT_COLOR = TAG_COLORS[0]
const FALLBACK_COLOR = '#64748b'

/** Icon thẻ phân loại tô màu */
function TagIcon({ color, className }: { color: string; className?: string }) {
  return <Tag className={cn('h-4 w-4 shrink-0', className)} style={{ color, fill: color }} />
}

interface Props {
  contactId?: string | null
  tags: string[]
  className?: string
}

export function ConversationTags({ contactId, tags, className }: Props) {
  const queryClient = useQueryClient()
  const { data: allTags = [] } = useTags()
  const [manageOpen, setManageOpen] = useState(false)
  const [savingTag, setSavingTag] = useState<string | null>(null)

  const colorOf = (name: string) =>
    allTags.find((t) => t.name === name)?.color ?? FALLBACK_COLOR

  /** Gán/gỡ nhãn — API thay TOÀN BỘ mảng nên luôn gửi lại cả mảng mới */
  async function toggleTag(name: string) {
    if (!contactId || savingTag) return
    const has = tags.includes(name)
    const next = has ? tags.filter((t) => t !== name) : [...tags, name]
    setSavingTag(name)
    try {
      await api.put(`/contacts/${contactId}`, { tags: next })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['conversation'] })
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      toast.success(has ? `Đã gỡ nhãn "${name}"` : `Đã gắn nhãn "${name}"`)
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSavingTag(null)
    }
  }

  return (
    <>
      <div className={cn('flex min-w-0 items-center gap-1', className)}>
        {/* Các nhãn đã gắn */}
        {/* Chỉ 1 nhãn — header còn phải chừa chỗ cho tên khách và các nút bên phải. */}
        {tags.slice(0, 1).map((name) => (
          <span
            key={name}
            className="inline-flex max-w-[9rem] shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: `${colorOf(name)}20`, color: colorOf(name) }}
            title={tags.join(', ')}
          >
            <TagIcon color={colorOf(name)} className="h-3 w-3" />
            <span className="truncate">{name}</span>
          </span>
        ))}
        {tags.length > 1 && (
          <span className="shrink-0 text-[11px] text-muted-foreground" title={tags.join(', ')}>
            +{tags.length - 1}
          </span>
        )}

        {/* Nút thẻ: icon khi chưa gắn nhãn nào */}
        {contactId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Thẻ phân loại"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Tag className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-96 w-64 overflow-y-auto">
              {allTags.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Chưa có thẻ phân loại nào.
                </div>
              ) : (
                allTags.map((t) => {
                  const checked = tags.includes(t.name)
                  return (
                    <DropdownMenuItem
                      key={t.id}
                      onSelect={(e) => {
                        e.preventDefault()
                        toggleTag(t.name)
                      }}
                      className="gap-2"
                    >
                      <TagIcon color={t.color} />
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
              <DropdownMenuItem onSelect={() => setManageOpen(true)} className="gap-2">
                <Settings2 className="h-4 w-4" />
                Quản lý thẻ phân loại
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <ManageTagsDialog open={manageOpen} onOpenChange={setManageOpen} tags={allTags} />
    </>
  )
}

/* ── Popup quản lý thẻ phân loại ─────────────────────────────────── */
/* Export để menu dòng hội thoại (conversation-list) dùng chung. */

export function ManageTagsDialog({
  open,
  onOpenChange,
  tags,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tags: TagDef[]
}) {
  const deleteTag = useDeleteTag()
  const [editing, setEditing] = useState<TagDef | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<TagDef | null>(null)

  async function handleDelete(tag: TagDef) {
    try {
      await deleteTag.mutateAsync(tag.id)
      toast.success(`Đã xóa thẻ "${tag.name}"`)
      setConfirmDelete(null)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const formOpen = creating || !!editing

  return (
    <>
      <Dialog open={open && !formOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Quản lý thẻ phân loại</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Danh sách thẻ phân loại</p>

            {tags.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Chưa có thẻ phân loại nào.
              </div>
            ) : (
              <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                {tags.map((t) => (
                  <li
                    key={t.id}
                    className="group flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2"
                  >
                    <TagIcon color={t.color} />
                    <span className="flex-1 truncate text-sm">{t.name}</span>
                    <button
                      type="button"
                      aria-label={`Sửa ${t.name}`}
                      onClick={() => setEditing(t)}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Xóa ${t.name}`}
                      onClick={() => setConfirmDelete(t)}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Button
              variant="ghost"
              className="w-full justify-start gap-2 text-primary hover:text-primary"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-4 w-4" />
              Thêm phân loại
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Form thêm / sửa */}
      <TagFormDialog
        open={formOpen}
        tag={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
      />

      {/* Xác nhận xóa */}
      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Xóa thẻ phân loại?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Thẻ <span className="font-medium text-foreground">{confirmDelete?.name}</span> sẽ bị xóa
            khỏi tất cả khách hàng đang gắn. Không thể hoàn tác.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
              disabled={deleteTag.isPending}
            >
              Xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ── Popup thêm mới / sửa thẻ phân loại ──────────────────────────── */

function TagFormDialog({
  open,
  tag,
  onClose,
}: {
  open: boolean
  tag: TagDef | null
  onClose: () => void
}) {
  const createTag = useCreateTag()
  const updateTag = useUpdateTag()
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)

  useEffect(() => {
    if (open) {
      setName(tag?.name ?? '')
      setColor(tag?.color ?? DEFAULT_COLOR)
    }
  }, [open, tag])

  const isEdit = !!tag
  const pending = createTag.isPending || updateTag.isPending

  async function handleSubmit() {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      if (isEdit) {
        await updateTag.mutateAsync({ id: tag.id, name: trimmed, color })
        toast.success('Đã cập nhật thẻ phân loại')
      } else {
        await createTag.mutateAsync({ name: trimmed, color })
        toast.success('Đã thêm thẻ phân loại')
      }
      onClose()
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Sửa thẻ phân loại' : 'Thêm mới thẻ phân loại'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Tên thẻ phân loại</label>
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="Nhập tên thẻ phân loại"
                className="flex-1"
              />
              {/* Nút chọn màu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Thay đổi màu thẻ"
                    className="flex h-9 w-11 shrink-0 items-center justify-center rounded-md border bg-muted transition-colors hover:bg-muted/70"
                  >
                    <TagIcon color={color} className="h-5 w-5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto p-3">
                  <p className="mb-2 px-1 text-sm font-medium">Thay đổi màu thẻ</p>
                  <div className="flex gap-1.5">
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Màu ${c}`}
                        onClick={() => setColor(c)}
                        className="flex h-8 w-8 items-center justify-center rounded-md transition-transform hover:scale-105"
                        style={{ backgroundColor: c }}
                      >
                        {color === c && <Check className="h-4 w-4 text-white" />}
                      </button>
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Hủy
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || pending}>
            {isEdit ? 'Lưu thay đổi' : 'Thêm phân loại'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
