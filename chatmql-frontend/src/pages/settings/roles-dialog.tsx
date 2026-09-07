/**
 * roles-dialog.tsx — "Quản lý quyền": danh sách vai trò + ma trận quyền.
 *
 * Toàn bộ chốt quyền trong backend đã đọc từ bảng này, nên sửa ở đây là có hiệu
 * lực ngay. Vai trò Chủ sở hữu bị khoá cứng — chống tự khoá cửa.
 */
import { useState } from 'react'
import { ArrowLeft, Check, Lock, Minus, Pencil, Plus, Shield, Trash2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loading, ErrorState } from '@/components/shared/feedback'
import { toast } from 'sonner'
import {
  useRoles, useRolePermissions, usePermissionCatalog, useDeleteRole, type RoleSummary,
} from '@/hooks/use-settings'
import { RoleEditor } from './role-editor'
import { apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const SCOPE_LABEL: Record<string, string> = {
  all: 'Toàn tổ chức',
  team: 'Nhóm mình quản lý',
  own: 'Chỉ của mình',
}

/** Thứ tự cột trên ma trận — trùng thứ tự người dùng quen đọc. */
const ACTIONS = ['view', 'create', 'update', 'delete', 'import', 'export', 'approve', 'send'] as const
const ACTION_LABEL: Record<string, string> = {
  view: 'Xem', create: 'Thêm', update: 'Sửa', delete: 'Xoá',
  import: 'Nhập', export: 'Xuất', approve: 'Duyệt', send: 'Gửi',
}

function RoleList({
  roles, onPick, onEdit, onDelete,
}: {
  roles: RoleSummary[]
  onPick: (r: RoleSummary) => void
  onEdit: (r: RoleSummary) => void
  onDelete: (r: RoleSummary) => void
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {roles.map((r) => (
        <li key={r.id} className="flex items-center">
          <button
            type="button"
            onClick={() => onPick(r)}
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Shield className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{r.name}</span>
                <Badge variant="secondary" className="text-[10px]">{r.userCount} người</Badge>
                {r.isSystem && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Lock className="h-2.5 w-2.5" /> Vai trò gốc
                  </Badge>
                )}
              </span>
              {r.description && (
                <span className="mt-0.5 block text-xs text-muted-foreground">{r.description}</span>
              )}
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {r.permissionCount} quyền · Phạm vi dữ liệu: {SCOPE_LABEL[r.dataScope] ?? r.dataScope}
              </span>
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 pr-2">
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => onEdit(r)}
              disabled={r.systemKey === 'owner'}
              aria-label={`Sửa ${r.name}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => onDelete(r)}
              disabled={r.isSystem}
              aria-label={`Xoá ${r.name}`}
            >
              <Trash2 className={cn('h-4 w-4', !r.isSystem && 'text-destructive')} />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function RoleMatrix({ role, onBack }: { role: RoleSummary; onBack: () => void }) {
  const { data: catalog, isLoading, isError } = usePermissionCatalog()
  const { data: granted } = useRolePermissions(role.id)
  const on = new Set(granted ?? [])

  if (isLoading) return <Loading label="Đang tải danh mục quyền…" />
  if (isError || !catalog) return <ErrorState message="Không tải được danh mục quyền." />

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Quay lại">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{role.name}</p>
          <p className="text-xs text-muted-foreground">
            {role.permissionCount}/{catalog.total} quyền · Phạm vi: {SCOPE_LABEL[role.dataScope] ?? role.dataScope}
          </p>
        </div>
      </div>

      <div className="max-h-[24rem] overflow-y-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Tính năng</th>
              {ACTIONS.map((a) => (
                <th key={a} className="px-2 py-2 text-center font-semibold">{ACTION_LABEL[a]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalog.groups.map(({ group, permissions }) => {
              // Nhiều module cùng một nhóm (ví dụ contacts + companies) → gộp dòng theo module.
              const byModule = new Map<string, typeof permissions>()
              for (const p of permissions) {
                const list = byModule.get(p.module) ?? []
                list.push(p)
                byModule.set(p.module, list)
              }
              return [...byModule.entries()].map(([module, perms], i) => (
                <tr key={`${group}.${module}`} className="border-t">
                  <td className="px-3 py-2">
                    {i === 0 && <span className="block font-medium">{group}</span>}
                    <span className="text-[11px] text-muted-foreground">{module}</span>
                  </td>
                  {ACTIONS.map((a) => {
                    const p = perms.find((x) => x.action === a)
                    return (
                      <td key={a} className="px-2 py-2 text-center">
                        {!p ? (
                          <Minus className="mx-auto h-3 w-3 text-muted-foreground/40" />
                        ) : on.has(p.key) ? (
                          <Check className="mx-auto h-4 w-4 text-success" />
                        ) : (
                          <span className="mx-auto block h-3 w-3 rounded border" />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function RolesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: roles, isLoading, isError } = useRoles(open)
  const deleteRole = useDeleteRole()
  const [picked, setPicked] = useState<RoleSummary | null>(null)
  /** null = danh sách · 'new' = tạo mới · RoleSummary = đang sửa */
  const [editing, setEditing] = useState<RoleSummary | 'new' | null>(null)

  const close = () => { setPicked(null); setEditing(null); onOpenChange(false) }

  const remove = async (r: RoleSummary) => {
    if (!window.confirm(`Xoá vai trò "${r.name}"?`)) return
    try {
      await deleteRole.mutateAsync(r.id)
      toast.success(`Đã xoá vai trò "${r.name}"`)
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className={cn('max-w-3xl', (picked || editing) && 'max-w-5xl')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-primary" /> Quản lý quyền
          </DialogTitle>
          <DialogDescription className="text-xs">
            Vai trò quyết định nhân viên dùng được tính năng nào và thấy dữ liệu tới đâu. Sửa ở đây
            có hiệu lực ngay.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Loading label="Đang tải vai trò…" />
        ) : isError || !roles ? (
          <ErrorState message="Không tải được danh sách vai trò." />
        ) : editing ? (
          <RoleEditor
            role={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        ) : picked ? (
          <RoleMatrix role={picked} onBack={() => setPicked(null)} />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {roles.length} vai trò · bấm để xem chi tiết, dùng biểu tượng bút để sửa
              </p>
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" /> Tạo vai trò
              </Button>
            </div>
            <RoleList
              roles={roles}
              onPick={setPicked}
              onEdit={setEditing}
              onDelete={remove}
            />
            <p className="text-[11px] text-muted-foreground">
              Vai trò gốc của hệ thống không xoá được; riêng <strong>Chủ sở hữu</strong> cũng không
              sửa được để tránh trường hợp gỡ nhầm quyền rồi không còn ai vào chỉnh lại.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
