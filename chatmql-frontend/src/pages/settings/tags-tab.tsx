import { useState } from 'react'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ErrorState, Loading, EmptyState } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { useTags, useCreateTag, useUpdateTag, useDeleteTag, type TagDef } from '@/hooks/use-settings'

const DEFAULT_COLOR = '#3b82f6'
const PRESET_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#ef4444']

function TagPreview({ name, color }: { name: string; color: string }) {
  return (
    <Badge
      className="border-transparent"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {name || 'Xem trước'}
    </Badge>
  )
}

export function TagsTab() {
  const { data: tags, isLoading, isError } = useTags()
  const createTag = useCreateTag()
  const updateTag = useUpdateTag()
  const deleteTag = useDeleteTag()

  const [editTarget, setEditTarget] = useState<TagDef | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TagDef | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<{ name: string; color: string }>({ name: '', color: DEFAULT_COLOR })

  function openCreate() {
    setEditTarget(null)
    setForm({ name: '', color: DEFAULT_COLOR })
    setDialogOpen(true)
  }

  function openEdit(t: TagDef) {
    setEditTarget(t)
    setForm({ name: t.name, color: t.color })
    setDialogOpen(true)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) {
      toast.error('Vui lòng nhập tên nhãn')
      return
    }
    try {
      if (editTarget) {
        await updateTag.mutateAsync({ id: editTarget.id, name, color: form.color })
        toast.success('Đã cập nhật nhãn')
      } else {
        await createTag.mutateAsync({ name, color: form.color })
        toast.success('Đã tạo nhãn mới')
      }
      setDialogOpen(false)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function onDelete() {
    if (!deleteTarget) return
    try {
      await deleteTag.mutateAsync(deleteTarget.id)
      toast.success('Đã xóa nhãn')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const saving = createTag.isPending || updateTag.isPending

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {tags ? `${tags.length} nhãn` : 'Danh sách nhãn'}
          </p>
          <Button onClick={openCreate}>
            <Plus /> Thêm nhãn
          </Button>
        </div>

        {isLoading ? (
          <Loading label="Đang tải nhãn..." />
        ) : isError ? (
          <ErrorState />
        ) : !tags?.length ? (
          <EmptyState title="Chưa có nhãn nào" description="Tạo nhãn để phân loại khách hàng." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <div
                key={t.id}
                className="group flex items-center gap-2 rounded-lg border bg-card px-3 py-2"
              >
                <TagPreview name={t.name} color={t.color} />
                <div className="flex items-center gap-0.5">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)} aria-label="Sửa">
                    <Pencil className="!size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(t)}
                    aria-label="Xóa"
                  >
                    <Trash2 className="!size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Dialog thêm/sửa */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Sửa nhãn' : 'Thêm nhãn'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tag-name">Tên nhãn</Label>
              <Input
                id="tag-name"
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                placeholder="VIP, Tiềm năng..."
                maxLength={50}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tag-color">Màu</Label>
              <div className="flex items-center gap-3">
                <input
                  id="tag-color"
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((s) => ({ ...s, color: e.target.value }))}
                  className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background"
                />
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((s) => ({ ...s, color: c }))}
                      className="h-6 w-6 rounded-full border"
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Xem trước</Label>
              <div>
                <TagPreview name={form.name} color={form.color} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="animate-spin" />}
                {editTarget ? 'Lưu' : 'Tạo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog xóa */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa nhãn</DialogTitle>
            <DialogDescription>
              Xóa nhãn <span className="font-medium text-foreground">{deleteTarget?.name}</span> sẽ gỡ nhãn này khỏi tất
              cả khách hàng đang gắn.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={deleteTag.isPending}>
              {deleteTag.isPending && <Loader2 className="animate-spin" />}
              Xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
