/**
 * role-editor.tsx — Form tạo / sửa một vai trò.
 *
 * Ma trận tích chọn theo nhóm tính năng × hành động, kèm hai lối chọn nhanh:
 * "Tất cả quyền" cho cả vai trò và cho từng nhóm — bảng 67 ô mà tick tay từng
 * cái thì không ai dùng.
 *
 * Vai trò Chủ sở hữu không sửa được: gỡ nhầm quyền của nó là không còn ai vào
 * chỉnh lại (backend cũng chặn, đây chỉ là lớp trải nghiệm).
 */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Lock, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea, Checkbox } from '@/components/ui/misc'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loading, ErrorState } from '@/components/shared/feedback'
import {
  usePermissionCatalog, useRolePermissions, useCreateRole, useUpdateRole,
  useSetRolePermissions, type RoleSummary,
} from '@/hooks/use-settings'
import { apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const ACTIONS = ['view', 'create', 'update', 'delete', 'import', 'export', 'approve', 'send', 'monitor', 'impersonate'] as const
const ACTION_LABEL: Record<string, string> = {
  view: 'Xem', create: 'Thêm', update: 'Sửa', delete: 'Xoá', import: 'Nhập',
  export: 'Xuất', approve: 'Duyệt', send: 'Gửi', monitor: 'Giám sát', impersonate: 'Xem hộ',
}

const SCOPES = [
  { value: 'all', label: 'Toàn tổ chức', hint: 'Thấy mọi hội thoại và khách hàng' },
  { value: 'team', label: 'Nhóm mình quản lý', hint: 'Bản thân + nhân viên cấp dưới' },
  { value: 'own', label: 'Chỉ của mình', hint: 'Chỉ những gì được giao' },
]

export function RoleEditor({ role, onDone }: { role: RoleSummary | null; onDone: () => void }) {
  const isNew = !role
  const locked = role?.systemKey === 'owner'

  const { data: catalog, isLoading, isError } = usePermissionCatalog()
  const { data: current } = useRolePermissions(role?.id)
  const createRole = useCreateRole()
  const updateRole = useUpdateRole()
  const setPerms = useSetRolePermissions()

  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [dataScope, setDataScope] = useState(role?.dataScope ?? 'own')
  const [keys, setKeys] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  // Quyền hiện tại về sau khi mở form (query chạy song song) → nạp một lần.
  useEffect(() => { if (current) setKeys(new Set(current)) }, [current])

  /** Mỗi dòng của ma trận = một module; nhóm có thể chứa nhiều module. */
  const rows = useMemo(() => {
    if (!catalog) return []
    return catalog.groups.flatMap((g) => {
      const byModule = new Map<string, typeof g.permissions>()
      for (const p of g.permissions) {
        const l = byModule.get(p.module) ?? []
        l.push(p)
        byModule.set(p.module, l)
      }
      return [...byModule.entries()].map(([module, perms], i) => ({
        group: g.group, module, perms, firstOfGroup: i === 0,
      }))
    })
  }, [catalog])

  const allKeys = useMemo(
    () => (catalog?.groups.flatMap((g) => g.permissions.map((p) => p.key)) ?? []),
    [catalog],
  )

  const toggle = (key: string, on: boolean) =>
    setKeys((prev) => {
      const next = new Set(prev)
      if (on) next.add(key); else next.delete(key)
      return next
    })

  const toggleMany = (list: string[], on: boolean) =>
    setKeys((prev) => {
      const next = new Set(prev)
      for (const k of list) { if (on) next.add(k); else next.delete(k) }
      return next
    })

  const save = async () => {
    if (!name.trim()) return toast.error('Cần đặt tên vai trò')
    setSaving(true)
    try {
      if (isNew) {
        await createRole.mutateAsync({
          name: name.trim(), description: description.trim(), dataScope,
          permissionKeys: [...keys],
        })
        toast.success(`Đã tạo vai trò "${name.trim()}"`)
      } else {
        await updateRole.mutateAsync({
          id: role!.id, name: name.trim(), description: description.trim(), dataScope,
        })
        await setPerms.mutateAsync({ id: role!.id, permissionKeys: [...keys] })
        toast.success('Đã lưu vai trò')
      }
      onDone()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <Loading label="Đang tải danh mục quyền…" />
  if (isError || !catalog) return <ErrorState message="Không tải được danh mục quyền." />

  const allOn = allKeys.length > 0 && allKeys.every((k) => keys.has(k))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDone} aria-label="Quay lại">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <p className="flex-1 text-sm font-semibold">
          {isNew ? 'Tạo vai trò mới' : `Sửa vai trò: ${role!.name}`}
        </p>
        {!locked && (
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Lưu
          </Button>
        )}
      </div>

      {locked && (
        <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Vai trò <strong>Chủ sở hữu</strong> luôn giữ toàn quyền và không sửa được — gỡ nhầm quyền
            của nó thì không còn ai vào chỉnh lại được.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="role-name">Tên vai trò <span className="text-destructive">*</span></Label>
          <Input
            id="role-name" value={name} disabled={locked}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Kế toán, CSKH, Trưởng nhóm Sale"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="role-scope">Phạm vi dữ liệu</Label>
          <Select value={dataScope} onValueChange={setDataScope} disabled={locked}>
            <SelectTrigger id="role-scope" className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SCOPES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label} — <span className="text-muted-foreground">{s.hint}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="role-desc">Mô tả</Label>
        <Textarea
          id="role-desc" value={description} disabled={locked}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Vai trò này dành cho ai, làm gì"
          className="mt-1 min-h-[52px]"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label>Quyền hạn <span className="text-muted-foreground">({keys.size}/{allKeys.length})</span></Label>
        <Button
          variant="outline" size="sm" disabled={locked}
          onClick={() => toggleMany(allKeys, !allOn)}
        >
          {allOn ? 'Bỏ chọn tất cả' : 'Chọn tất cả quyền'}
        </Button>
      </div>

      <div className="max-h-[22rem] overflow-y-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Tính năng</th>
              <th className="px-2 py-2 text-center font-semibold">Tất cả</th>
              {ACTIONS.map((a) => (
                <th key={a} className="px-2 py-2 text-center font-semibold">{ACTION_LABEL[a]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rowKeys = r.perms.map((p) => p.key)
              const rowAll = rowKeys.every((k) => keys.has(k))
              return (
                <tr key={`${r.group}.${r.module}`} className="border-t">
                  <td className="px-3 py-1.5">
                    {r.firstOfGroup && <span className="block font-medium">{r.group}</span>}
                    <span className="text-[11px] text-muted-foreground">{r.module}</span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Checkbox
                      checked={rowAll} disabled={locked}
                      onCheckedChange={(v) => toggleMany(rowKeys, v === true)}
                      aria-label={`Tất cả quyền ${r.module}`}
                    />
                  </td>
                  {ACTIONS.map((a) => {
                    const p = r.perms.find((x) => x.action === a)
                    return (
                      <td key={a} className="px-2 py-1.5 text-center">
                        {p ? (
                          <Checkbox
                            checked={keys.has(p.key)} disabled={locked}
                            onCheckedChange={(v) => toggle(p.key, v === true)}
                            aria-label={p.label}
                          />
                        ) : (
                          <span className={cn('mx-auto block h-3 w-3 text-muted-foreground/30')}>—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
