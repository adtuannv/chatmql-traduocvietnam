/**
 * doc-folder-dialog.tsx — Popup tạo/sửa thư mục của thư viện tài liệu.
 *
 * Có chọn THƯ MỤC CHA để dựng cây. Danh sách cha đã loại sẵn chính nó và toàn
 * bộ cây con của nó — chuyển thư mục vào con của chính mình sẽ tạo vòng lặp,
 * backend cũng chặn nhưng chặn ngay ở đây thì người dùng không phải thử rồi lỗi.
 */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiError } from '@/lib/api-client'
import {
  VISIBILITY_LABELS, useSaveDocFolder, type DocFolder, type Visibility,
} from '@/hooks/use-doc-library'

const NO_PARENT = '__root__'

/** Emoji gợi ý — bấm nhanh thay vì phải mở bảng emoji của hệ điều hành. */
const ICON_CHOICES = ['📁', '💰', '🖼️', '🎬', '📄', '🏭', '🌿', '🎁', '📢', '⭐', '🧾', '📦']

interface Props {
  /** null = tạo mới. */
  folder: DocFolder | null
  folders: DocFolder[]
  /** Thư mục cha điền sẵn khi tạo mới từ trong một thư mục. */
  defaultParentId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Id của chính nó + toàn bộ cây con — không được chọn làm cha. */
function descendantIds(folders: DocFolder[], rootId: string): Set<string> {
  const childrenOf = new Map<string | null, DocFolder[]>()
  for (const f of folders) {
    const arr = childrenOf.get(f.parentId) ?? []
    arr.push(f)
    childrenOf.set(f.parentId, arr)
  }
  const out = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const c of childrenOf.get(cur) ?? []) {
      if (!out.has(c.id)) { out.add(c.id); stack.push(c.id) }
    }
  }
  return out
}

/** Tên có thụt lề theo độ sâu, để bảng chọn nhìn ra cấu trúc cây. */
function indentedOptions(folders: DocFolder[], exclude: Set<string>): Array<{ id: string; label: string }> {
  const childrenOf = new Map<string | null, DocFolder[]>()
  for (const f of folders) {
    const arr = childrenOf.get(f.parentId) ?? []
    arr.push(f)
    childrenOf.set(f.parentId, arr)
  }
  const out: Array<{ id: string; label: string }> = []
  const walk = (parentId: string | null, depth: number) => {
    const list = (childrenOf.get(parentId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    for (const f of list) {
      if (exclude.has(f.id)) continue
      out.push({ id: f.id, label: `${'— '.repeat(depth)}${f.icon ? `${f.icon} ` : ''}${f.name}` })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export function DocFolderDialog({ folder, folders, defaultParentId, open, onOpenChange }: Props) {
  const save = useSaveDocFolder()

  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [parentId, setParentId] = useState<string>(NO_PARENT)
  const [visibility, setVisibility] = useState<Visibility>('sales')
  const [description, setDescription] = useState('')
  const [sortOrder, setSortOrder] = useState('0')

  useEffect(() => {
    if (!open) return
    setName(folder?.name ?? '')
    setIcon(folder?.icon ?? '')
    setParentId(folder?.parentId ?? defaultParentId ?? NO_PARENT)
    setVisibility(folder?.visibility ?? 'sales')
    setDescription(folder?.description ?? '')
    setSortOrder(String(folder?.sortOrder ?? 0))
  }, [open, folder, defaultParentId])

  const parentOptions = useMemo(
    () => indentedOptions(folders, folder ? descendantIds(folders, folder.id) : new Set<string>()),
    [folders, folder],
  )

  const onSave = () => {
    if (!name.trim()) { toast.error('Tên thư mục không được để trống'); return }
    const order = Number.parseInt(sortOrder, 10)

    save.mutate(
      {
        id: folder?.id,
        data: {
          name: name.trim(),
          icon: icon.trim() || null,
          parentId: parentId === NO_PARENT ? null : parentId,
          visibility,
          description: description.trim() || null,
          sortOrder: Number.isFinite(order) ? order : 0,
        },
      },
      {
        onSuccess: () => {
          toast.success(folder ? 'Đã cập nhật thư mục' : 'Đã tạo thư mục')
          onOpenChange(false)
        },
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{folder ? 'Sửa thư mục' : 'Thư mục mới'}</DialogTitle>
          <DialogDescription>
            Thư mục lồng nhau được. Chọn thư mục cha để xếp vào nhánh tương ứng.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Tên thư mục *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onSave() } }}
              placeholder="VD: Biểu giá 2026, Ảnh sản phẩm, Uy tín thương hiệu…"
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Biểu tượng</Label>
            <div className="flex flex-wrap items-center gap-1">
              {ICON_CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setIcon(icon === c ? '' : c)}
                  className={`flex h-8 w-8 items-center justify-center rounded-md border text-base ${
                    icon === c ? 'border-primary bg-primary/10' : 'hover:bg-accent'
                  }`}
                  aria-label={`Chọn biểu tượng ${c}`}
                >
                  {c}
                </button>
              ))}
              <Input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="hoặc dán emoji"
                className="h-8 w-32 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Thư mục cha</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>— Thư mục gốc —</SelectItem>
                {parentOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {folder && (
              <p className="text-[11px] text-muted-foreground">
                Không hiện chính nó và các thư mục con của nó, tránh lồng vòng.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Mức hiển thị</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => (
                    <SelectItem key={v} value={v}>{VISIBILITY_LABELS[v]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Thứ tự</Label>
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Số nhỏ xếp trước.</p>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Mô tả</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Thư mục này chứa gì, dùng khi nào…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Huỷ</Button>
          <Button onClick={onSave} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
