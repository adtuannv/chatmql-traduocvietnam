import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch, Textarea } from '@/components/ui/misc'
import { EmptyState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import {
  DEFAULT_GROUP_NAME,
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  fieldTypeVariant,
  useCdpProperties,
  useCreateProperty,
  useDeleteProperty,
  usePropertyGroups,
  useRenamePropertyGroup,
  useReorderProperties,
  useUpdateProperty,
  type CustomProperty,
  type PropertyOption,
} from '@/hooks/use-cdp'
import { Field, QueryError } from './cdp-shared'

const SELECT_TYPES = new Set(['single_select', 'multi_select'])

interface PropertyForm {
  name: string
  fieldType: string
  groupName: string
  description: string
  isRequired: boolean
  options: PropertyOption[]
}

const EMPTY_FORM: PropertyForm = {
  name: '',
  fieldType: 'text',
  groupName: '',
  description: '',
  isRequired: false,
  options: [],
}

function groupKey(p: CustomProperty): string {
  return p.groupName || DEFAULT_GROUP_NAME
}

export function PropertiesTab() {
  const propsQuery = useCdpProperties()
  const groupsQuery = usePropertyGroups()
  const createProp = useCreateProperty()
  const updateProp = useUpdateProperty()
  const deleteProp = useDeleteProperty()
  const renameGroup = useRenamePropertyGroup()
  const reorder = useReorderProperties()

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CustomProperty | null>(null)
  const [form, setForm] = useState<PropertyForm>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<CustomProperty | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const properties = propsQuery.data?.properties ?? []

  // Gom theo nhóm, giữ thứ tự sortOrder từ backend
  const grouped = useMemo(() => {
    const map = new Map<string, CustomProperty[]>()
    for (const p of properties) {
      const k = groupKey(p)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(p)
    }
    // Nhóm rỗng (backend không trả) sẽ không có; sắp xếp: "Chung" cuối, còn lại theo tên
    return [...map.entries()].sort(([a], [b]) => {
      if (a === DEFAULT_GROUP_NAME) return 1
      if (b === DEFAULT_GROUP_NAME) return -1
      return a.localeCompare(b, 'vi')
    })
  }, [properties])

  const groupNames = useMemo(
    () => (groupsQuery.data?.groups ?? []).map((g) => g.name).filter((n) => n !== DEFAULT_GROUP_NAME),
    [groupsQuery.data],
  )

  function openCreate(groupName?: string) {
    setEditTarget(null)
    setForm({
      ...EMPTY_FORM,
      groupName: groupName && groupName !== DEFAULT_GROUP_NAME ? groupName : '',
    })
    setDialogOpen(true)
  }

  function openEdit(p: CustomProperty) {
    setEditTarget(p)
    setForm({
      name: p.name,
      fieldType: p.fieldType,
      groupName: p.groupName ?? '',
      description: p.description ?? '',
      isRequired: p.isRequired,
      options: Array.isArray(p.options) ? p.options.map((o) => ({ ...o })) : [],
    })
    setDialogOpen(true)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) {
      toast.error('Vui lòng nhập tên thuộc tính')
      return
    }
    const isSelect = SELECT_TYPES.has(form.fieldType)
    const options = isSelect
      ? form.options
          .map((o) => ({
            value: o.value.trim(),
            label: o.label.trim() || o.value.trim(),
          }))
          .filter((o) => o.value)
      : []
    if (isSelect && options.length === 0) {
      toast.error('Kiểu chọn cần ít nhất một tuỳ chọn')
      return
    }
    const payload = {
      name,
      fieldType: form.fieldType,
      options,
      isRequired: form.isRequired,
      groupName: form.groupName.trim(),
      description: form.description.trim(),
    }
    try {
      if (editTarget) {
        await updateProp.mutateAsync({ id: editTarget.id, data: payload })
        toast.success('Đã cập nhật thuộc tính')
      } else {
        await createProp.mutateAsync(payload)
        toast.success('Đã tạo thuộc tính')
      }
      setDialogOpen(false)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function onDelete() {
    if (!deleteTarget) return
    try {
      await deleteProp.mutateAsync(deleteTarget.id)
      toast.success('Đã xóa thuộc tính')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function onRename(e: React.FormEvent) {
    e.preventDefault()
    if (!renameTarget) return
    const newName = renameValue.trim()
    if (!newName) {
      toast.error('Vui lòng nhập tên nhóm')
      return
    }
    try {
      await renameGroup.mutateAsync({ oldName: renameTarget, newName })
      toast.success('Đã đổi tên nhóm')
      setRenameTarget(null)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  function move(list: CustomProperty[], index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= list.length) return
    const next = [...list]
    ;[next[index], next[target]] = [next[target], next[index]]
    reorder.mutate(
      next.map((p, i) => ({ id: p.id, sortOrder: i })),
      { onError: (err) => toast.error(apiError(err)) },
    )
  }

  const saving = createProp.isPending || updateProp.isPending
  const isSelectType = SELECT_TYPES.has(form.fieldType)

  if (propsQuery.isLoading) return <Loading label="Đang tải thuộc tính..." />
  if (propsQuery.isError) return <QueryError error={propsQuery.error} what="thuộc tính CDP" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {properties.length} thuộc tính · {grouped.length} nhóm
        </p>
        <Button onClick={() => openCreate()}>
          <Plus /> Thêm thuộc tính
        </Button>
      </div>

      {grouped.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Chưa có thuộc tính tuỳ chỉnh"
          description="Tạo thuộc tính để lưu thêm thông tin cho khách hàng, hoặc cài một gói Preset có sẵn."
          action={
            <Button onClick={() => openCreate()}>
              <Plus /> Thêm thuộc tính
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {grouped.map(([name, list]) => {
            const isOpen = !collapsed[name]
            return (
              <Card key={name}>
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => setCollapsed((s) => ({ ...s, [name]: isOpen }))}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-semibold">{name}</span>
                    <Badge variant="secondary">{list.length}</Badge>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    {name !== DEFAULT_GROUP_NAME && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRenameTarget(name)
                          setRenameValue(name)
                        }}
                      >
                        <Pencil className="!size-3.5" /> Đổi tên
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openCreate(name)}>
                      <Plus className="!size-3.5" /> Thêm
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <CardContent className="space-y-2 pt-0">
                    {list.map((p, i) => (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center gap-3 rounded-lg border bg-background px-3 py-2"
                      >
                        <div className="flex shrink-0 flex-col">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            disabled={i === 0 || reorder.isPending}
                            onClick={() => move(list, i, -1)}
                            aria-label="Lên"
                          >
                            <ArrowUp className="!size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            disabled={i === list.length - 1 || reorder.isPending}
                            onClick={() => move(list, i, 1)}
                            aria-label="Xuống"
                          >
                            <ArrowDown className="!size-3" />
                          </Button>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{p.name}</span>
                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {p.fieldKey}
                            </code>
                            <Badge variant={fieldTypeVariant(p.fieldType)}>
                              {FIELD_TYPE_LABELS[p.fieldType] ?? p.fieldType}
                            </Badge>
                            {p.isRequired && <Badge variant="outline">Bắt buộc</Badge>}
                          </div>
                          {p.description && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.description}</p>
                          )}
                          {SELECT_TYPES.has(p.fieldType) && Array.isArray(p.options) && p.options.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {p.options.slice(0, 8).map((o) => (
                                <Badge key={o.value} variant="secondary" className="font-normal">
                                  {o.label || o.value}
                                </Badge>
                              ))}
                              {p.options.length > 8 && (
                                <span className="text-xs text-muted-foreground">+{p.options.length - 8}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEdit(p)}
                            aria-label="Sửa"
                          >
                            <Pencil className="!size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(p)}
                            aria-label="Xóa"
                          >
                            <Trash2 className="!size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Dialog thêm/sửa thuộc tính */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Sửa thuộc tính' : 'Thêm thuộc tính'}</DialogTitle>
            {editTarget && (
              <DialogDescription>
                Đổi tên sẽ sinh lại khoá <code>{editTarget.fieldKey}</code>; segment hoặc tự động hoá đang dùng khoá cũ
                cần cập nhật lại.
              </DialogDescription>
            )}
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Tên thuộc tính">
              <Input
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                placeholder="VD: Ngân sách, Ngày sinh nhật..."
                maxLength={100}
                autoFocus
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kiểu dữ liệu">
                <Select value={form.fieldType} onValueChange={(v) => setForm((s) => ({ ...s, fieldType: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {FIELD_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Nhóm" hint="Để trống → nhóm “Chung”.">
                <Input
                  list="cdp-group-names"
                  value={form.groupName}
                  onChange={(e) => setForm((s) => ({ ...s, groupName: e.target.value }))}
                  placeholder={DEFAULT_GROUP_NAME}
                  maxLength={50}
                />
                <datalist id="cdp-group-names">
                  {groupNames.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </Field>
            </div>
            <Field label="Mô tả">
              <Textarea
                value={form.description}
                onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
                placeholder="Giải thích ngắn cho nhân viên..."
                className="min-h-[60px]"
              />
            </Field>

            {isSelectType && (
              <Field label="Tuỳ chọn" hint="Giá trị dùng để lưu, nhãn dùng để hiển thị.">
                <div className="space-y-2">
                  {form.options.map((o, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={o.value}
                        onChange={(e) =>
                          setForm((s) => ({
                            ...s,
                            options: s.options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                          }))
                        }
                        placeholder="Giá trị"
                        className="flex-1"
                      />
                      <Input
                        value={o.label}
                        onChange={(e) =>
                          setForm((s) => ({
                            ...s,
                            options: s.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                          }))
                        }
                        placeholder="Nhãn"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() =>
                          setForm((s) => ({
                            ...s,
                            options: s.options.filter((_, j) => j !== i),
                          }))
                        }
                        aria-label="Bỏ tuỳ chọn"
                      >
                        <X className="!size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setForm((s) => ({
                        ...s,
                        options: [...s.options, { value: '', label: '' }],
                      }))
                    }
                  >
                    <Plus className="!size-3.5" /> Thêm tuỳ chọn
                  </Button>
                </div>
              </Field>
            )}

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Bắt buộc nhập</p>
                <p className="text-xs text-muted-foreground">Nhắc nhân viên điền khi cập nhật khách hàng.</p>
              </div>
              <Switch checked={form.isRequired} onCheckedChange={(v) => setForm((s) => ({ ...s, isRequired: v }))} />
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

      {/* Dialog đổi tên nhóm */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Đổi tên nhóm</DialogTitle>
            <DialogDescription>
              Tất cả thuộc tính trong nhóm <span className="font-medium text-foreground">{renameTarget}</span> sẽ chuyển
              sang tên mới.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onRename} className="space-y-4">
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={50} autoFocus />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
                Hủy
              </Button>
              <Button type="submit" disabled={renameGroup.isPending}>
                {renameGroup.isPending && <Loader2 className="animate-spin" />}
                Lưu
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog xóa */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa thuộc tính</DialogTitle>
            <DialogDescription>
              Xóa <span className="font-medium text-foreground">{deleteTarget?.name}</span> sẽ xóa luôn giá trị đã nhập
              trên tất cả khách hàng. Không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={deleteProp.isPending}
              className={cn(deleteProp.isPending && 'opacity-80')}
            >
              {deleteProp.isPending && <Loader2 className="animate-spin" />}
              Xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
