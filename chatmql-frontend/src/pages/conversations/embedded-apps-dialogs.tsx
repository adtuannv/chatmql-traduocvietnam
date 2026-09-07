import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox, Switch, Textarea } from '@/components/ui/misc'
import { EmptyState, Loading } from '@/components/shared/feedback'
import { api, apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import type { MiniApp } from './app-rail'

// ── Hằng số lưu trữ ────────────────────────────────────────────────

/** Khoá cấu hình cấp tổ chức (AppSetting) — chỉ owner/admin ghi được. */
export const EMBEDDED_APPS_KEY = 'org.embedded_apps'
/** Khoá dự phòng khi người dùng không đủ quyền ghi cấu hình tổ chức. */
export const EMBEDDED_APPS_LOCAL_KEY = 'chatmql_embedded_apps'

/**
 * Danh sách mặc định khi tổ chức chưa cấu hình gì — CỐ Ý RỖNG.
 * Trước đây seed sẵn "App Evotech" khiến mọi tổ chức mới đều dính một kết nối
 * không liên quan tới họ; giờ để trống, ai cần kết nối nền tảng nào thì tự
 * thêm qua "Kết nối nền tảng mới" — thêm được BẤT KỲ kênh nào, không giới hạn.
 */
export const DEFAULT_MINI_APPS: MiniApp[] = []

/** Nền tảng hỗ trợ — hiện chỉ có webview/form nhúng. */
const PLATFORMS = [{ value: 'webview', label: 'Nhúng Webview/Form' }]

interface SettingsResponse {
  settings: Record<string, string | null>
}

// ── Tiện ích ───────────────────────────────────────────────────────

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Parse JSON danh sách app, bỏ qua phần tử sai định dạng. */
function parseApps(raw: string | null | undefined): MiniApp[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter(
        (x): x is MiniApp =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as MiniApp).id === 'string' &&
          typeof (x as MiniApp).name === 'string' &&
          typeof (x as MiniApp).url === 'string',
      )
      .map((x) => ({ ...x, active: x.active !== false }))
  } catch {
    return []
  }
}

function readLocalApps(): MiniApp[] {
  try {
    return parseApps(localStorage.getItem(EMBEDDED_APPS_LOCAL_KEY))
  } catch {
    return []
  }
}

/** Gộp 2 nguồn, ưu tiên bản của tổ chức, loại trùng theo `id`. */
function mergeApps(org: MiniApp[], local: MiniApp[]): MiniApp[] {
  const seen = new Set(org.map((a) => a.id))
  return [...org, ...local.filter((a) => !seen.has(a.id))]
}

/** Sắp xếp theo `order` (thiếu thì giữ nguyên vị trí tương đối). */
function sortApps(list: MiniApp[]): MiniApp[] {
  return list
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.order ?? x.i) - (y.a.order ?? y.i) || x.i - y.i)
    .map(({ a }) => a)
}

/** Chuẩn hoá `order` liên tục 0..n-1 theo thứ tự mảng hiện tại. */
function reindex(list: MiniApp[]): MiniApp[] {
  return list.map((a, i) => ({ ...a, order: i }))
}

// ── Hook dùng chung ────────────────────────────────────────────────

/**
 * Đọc/ghi danh sách mini-app nhúng.
 *
 * - Đọc: `GET /settings` → key `org.embedded_apps`, gộp thêm bản lưu cục bộ
 *   (ưu tiên bản của tổ chức, loại trùng theo `id`). Chưa có gì → mặc định.
 * - Ghi: `PUT /settings`; gặp 403 (không phải owner/admin) thì lưu
 *   `localStorage` và báo "Đã lưu cho riêng bạn".
 */
export function useMiniApps() {
  const qc = useQueryClient()

  const query = useQuery<MiniApp[]>({
    queryKey: ['mini-apps'],
    queryFn: async () => {
      let org: MiniApp[] = []
      try {
        const { data } = await api.get<SettingsResponse>('/settings')
        org = parseApps(data?.settings?.[EMBEDDED_APPS_KEY])
      } catch {
        // Không đọc được cấu hình tổ chức → vẫn dùng bản cục bộ/mặc định.
        org = []
      }
      const local = readLocalApps()
      // DEFAULT_MINI_APPS hiện rỗng — giữ ternary để tương lai có muốn seed
      // sẵn danh sách khuyến nghị thì chỉ cần đổi ở một chỗ (DEFAULT_MINI_APPS).
      const merged = mergeApps(org, local)
      return sortApps(merged.length ? merged : DEFAULT_MINI_APPS)
    },
  })

  const save = useMutation<{ scope: 'org' | 'local' }, unknown, MiniApp[]>({
    mutationFn: async (list) => {
      const value = JSON.stringify(reindex(list))
      try {
        await api.put('/settings', { key: EMBEDDED_APPS_KEY, value })
        return { scope: 'org' }
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 403) {
          localStorage.setItem(EMBEDDED_APPS_LOCAL_KEY, value)
          return { scope: 'local' }
        }
        throw err
      }
    },
    onSuccess: (res) => {
      toast.success(res.scope === 'local' ? 'Đã lưu cho riêng bạn' : 'Đã lưu')
      qc.invalidateQueries({ queryKey: ['mini-apps'] })
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (err) => toast.error(apiError(err)),
  })

  const data = query.data
  const apps = useMemo(() => data ?? [], [data])
  /** Chỉ các app đang bật, đã sắp xếp — dùng cho `AppRail`. */
  const activeApps = useMemo(() => apps.filter((a) => a.active), [apps])

  return {
    apps,
    activeApps,
    isLoading: query.isLoading,
    isError: query.isError,
    save: save.mutateAsync,
    saving: save.isPending,
  }
}

// ── Popup "Danh sách nhúng form" ───────────────────────────────────

interface DialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** Popup quản lý các kết nối nền tảng (webview/form) nhúng vào cột phải. */
export function ConnectionsDialog({ open, onOpenChange }: DialogProps) {
  const { apps, isLoading, save, saving } = useMiniApps()
  const [keyword, setKeyword] = useState('')
  const [editing, setEditing] = useState<MiniApp | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [removing, setRemoving] = useState<MiniApp | null>(null)

  useEffect(() => {
    if (!open) setKeyword('')
  }, [open])

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return apps
    return apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.url.toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q),
    )
  }, [apps, keyword])

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (app: MiniApp) => {
    setEditing(app)
    setFormOpen(true)
  }

  const handleSubmit = async (value: MiniApp) => {
    const next = editing
      ? apps.map((a) => (a.id === editing.id ? { ...a, ...value, id: editing.id } : a))
      : [...apps, value]
    await save(next)
    setFormOpen(false)
    setEditing(null)
  }

  const handleRemove = async () => {
    if (!removing) return
    await save(apps.filter((a) => a.id !== removing.id))
    setRemoving(null)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Danh sách nhúng form</DialogTitle>
            <DialogDescription>
              Quản lý các nền tảng được nhúng vào cột phải của màn hội thoại.
            </DialogDescription>
          </DialogHeader>

          {/* Chú thích */}
          <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p>
              Bạn có thể tạo webview hoặc form kết nối tới CRM để tạo lead, tạo đơn hàng ngay
              trong khung chat. Mỗi kết nối sẽ hiện thành một icon ở cột phải; bấm icon để mở
              trang tương ứng mà không cần rời khỏi hội thoại.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Tìm kiếm kết nối…"
                className="pl-8"
              />
            </div>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Kết nối nền tảng mới
            </Button>
          </div>

          {isLoading ? (
            <Loading label="Đang tải danh sách…" />
          ) : filtered.length === 0 ? (
            <EmptyState title="Không tìm thấy kết nối nào" />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Tên</th>
                    <th className="px-3 py-2 font-medium">Đường dẫn</th>
                    <th className="w-24 px-3 py-2 text-right font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((app) => (
                    <tr key={app.id} className="border-t">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase">
                            {app.icon ? (
                              <img src={app.icon} alt="" className="h-4 w-4 object-contain" />
                            ) : (
                              app.name.trim().charAt(0) || '?'
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{app.name}</p>
                            {app.description && (
                              <p className="truncate text-xs text-muted-foreground">
                                {app.description}
                              </p>
                            )}
                          </div>
                          {!app.active && (
                            <Badge variant="secondary" className="shrink-0">
                              Tắt
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="max-w-[18rem] px-3 py-2">
                        <a
                          href={app.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="block truncate text-primary hover:underline"
                        >
                          {app.url}
                        </a>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Sửa"
                            onClick={() => openEdit(app)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            title="Xoá"
                            onClick={() => setRemoving(app)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConnectionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        value={editing}
        saving={saving}
        onSubmit={handleSubmit}
      />

      {/* Xác nhận xoá */}
      <Dialog open={!!removing} onOpenChange={(v) => !v && setRemoving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Xoá kết nối?</DialogTitle>
            <DialogDescription>
              Kết nối “{removing?.name}” sẽ bị gỡ khỏi cột phải. Bạn có chắc chắn?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Thoát
            </Button>
            <Button variant="destructive" disabled={saving} onClick={handleRemove}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Xoá
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Form thêm/sửa kết nối ──────────────────────────────────────────

function ConnectionFormDialog({
  open,
  onOpenChange,
  value,
  saving,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  value: MiniApp | null
  saving: boolean
  onSubmit: (app: MiniApp) => Promise<void> | void
}) {
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState(PLATFORMS[0].value)
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [icon, setIcon] = useState('')
  const [active, setActive] = useState(true)
  const [errors, setErrors] = useState<{ name?: string; url?: string }>({})

  useEffect(() => {
    if (!open) return
    setName(value?.name || '')
    setPlatform(PLATFORMS[0].value)
    setDescription(value?.description || '')
    setUrl(value?.url || '')
    setIcon(value?.icon || '')
    setActive(value ? value.active : true)
    setErrors({})
  }, [open, value])

  const submit = async () => {
    const next: { name?: string; url?: string } = {}
    if (!name.trim()) next.name = 'Vui lòng nhập tên kết nối.'
    if (!url.trim()) next.url = 'Vui lòng nhập đường dẫn.'
    else if (!isValidUrl(url)) next.url = 'Đường dẫn phải bắt đầu bằng http:// hoặc https://'
    setErrors(next)
    if (Object.keys(next).length) return

    await onSubmit({
      id: value?.id || `app_${Date.now().toString(36)}`,
      name: name.trim(),
      url: url.trim(),
      icon: icon.trim() || undefined,
      description: description.trim() || undefined,
      active,
      order: value?.order,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{value ? 'Sửa kết nối' : 'Thêm kết nối mới'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="conn-name">
              Tên <span className="text-destructive">*</span>
            </Label>
            <Input
              id="conn-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ví dụ: CRM nội bộ, Form đặt lịch…"
              className={cn(errors.name && 'border-destructive')}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Nền tảng</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn nền tảng" />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conn-desc">Mô tả</Label>
            <Textarea
              id="conn-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả ngắn về kết nối này"
              className="min-h-[64px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conn-url">
              URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="conn-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className={cn(errors.url && 'border-destructive')}
            />
            {errors.url && <p className="text-xs text-destructive">{errors.url}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conn-icon">Icon (đường dẫn ảnh)</Label>
            <Input
              id="conn-icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="https://…/icon.png (để trống dùng chữ cái đầu)"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />
            Active
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Thoát
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Popup "Cài đặt danh sách" ──────────────────────────────────────

/** Popup bật/tắt và sắp xếp thứ tự icon mini-app hiển thị ở cột phải. */
export function AppSettingsDialog({ open, onOpenChange }: DialogProps) {
  const { apps, isLoading, save, saving } = useMiniApps()

  const toggle = (id: string, next: boolean) =>
    save(apps.map((a) => (a.id === id ? { ...a, active: next } : a)))

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= apps.length) return
    const next = [...apps]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    return save(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cài đặt danh sách</DialogTitle>
          <DialogDescription>
            Bật/tắt và sắp xếp thứ tự icon hiển thị ở cột phải.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Loading label="Đang tải danh sách…" />
        ) : apps.length === 0 ? (
          <EmptyState title="Chưa có ứng dụng nào" description="Hãy thêm kết nối nền tảng mới." />
        ) : (
          <ul className="divide-y rounded-lg border">
            {apps.map((app, i) => (
              <li key={app.id} className="flex items-center gap-2 px-3 py-2">
                <Switch
                  checked={app.active}
                  disabled={saving}
                  onCheckedChange={(v) => toggle(app.id, v)}
                />
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase">
                  {app.icon ? (
                    <img src={app.icon} alt="" className="h-4 w-4 object-contain" />
                  ) : (
                    app.name.trim().charAt(0) || '?'
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{app.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Lên"
                  disabled={saving || i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Xuống"
                  disabled={saving || i === apps.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
