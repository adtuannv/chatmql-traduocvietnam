import { useState } from 'react'
import { Loader2, Pencil, Plus, Shield, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/misc'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DataTable, type Column } from '@/components/shared/data-table'
import { ErrorState } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { FEATURES } from '@/lib/features'
import { initials } from '@/lib/utils'
import type { Role } from '@/types/api'
import {
  useTeam,
  useInviteMember,
  useUpdateMember,
  useDeleteMember,
  useRoles,
  type TeamMember,
} from '@/hooks/use-settings'
import { ASSIGNABLE_ROLES, ROLE_LABELS, avatarSrc } from './settings-utils'
import { PLATFORM_LABEL } from './settings-utils'
import { EmployeeAccountsDialog } from './employee-accounts-dialog'
import { RolesDialog } from './roles-dialog'

function roleBadgeVariant(role: Role): 'default' | 'secondary' | 'success' | 'warning' {
  switch (role) {
    case 'owner':
      return 'warning'
    case 'admin':
      return 'default'
    case 'manager':
      return 'success'
    default:
      return 'secondary'
  }
}

export function TeamTab() {
  // Nhân viên đang mở popup giao tài khoản giao tiếp.
  const [accountsTarget, setAccountsTarget] = useState<TeamMember | null>(null)
  const [rolesOpen, setRolesOpen] = useState(false)

  const { data: members, isLoading, isError } = useTeam()
  const invite = useInviteMember()
  const updateMember = useUpdateMember()
  const deleteMember = useDeleteMember()

  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<TeamMember | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null)

  // Vai trò động (hệ thống + tuỳ chỉnh) cho ô chọn trong dialog sửa. Chỉ tải
  // khi dialog mở — manager xem được danh sách nhân sự nhưng GET /roles sẽ 403.
  const { data: dynRoles } = useRoles(FEATURES.ROLES_PERMISSIONS && !!editTarget)

  // ── Form thêm ────────────────────────────────────────────────────
  const [addForm, setAddForm] = useState<{ fullName: string; email: string; role: Role; password: string }>({
    fullName: '',
    email: '',
    role: 'member',
    password: '',
  })

  function resetAdd() {
    setAddForm({ fullName: '', email: '', role: 'member', password: '' })
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addForm.email.trim()) {
      toast.error('Vui lòng nhập email')
      return
    }
    try {
      const res = await invite.mutateAsync({
        email: addForm.email.trim(),
        fullName: addForm.fullName.trim() || undefined,
        role: addForm.role,
        password: addForm.password.trim() || undefined,
      })
      if (res.generatedPassword) {
        toast.success(`Đã thêm thành viên. Mật khẩu tạm: ${res.generatedPassword}`, { duration: 12000 })
      } else {
        toast.success('Đã thêm thành viên mới')
      }
      setAddOpen(false)
      resetAdd()
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  // ── Form sửa ─────────────────────────────────────────────────────
  const [editForm, setEditForm] = useState<{
    fullName: string
    role: Role
    roleId: string | null
    password: string
    isActive: boolean
  }>({
    fullName: '',
    role: 'member',
    roleId: null,
    password: '',
    isActive: true,
  })

  function openEdit(m: TeamMember) {
    setEditForm({
      fullName: m.fullName,
      role: m.role,
      roleId: m.roleId ?? null,
      password: '',
      isActive: m.status === 'active',
    })
    setEditTarget(m)
  }

  async function onEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    const isOwner = editTarget.role === 'owner'
    try {
      await updateMember.mutateAsync({
        id: editTarget.id,
        fullName: editForm.fullName.trim() || undefined,
        role: isOwner ? undefined : editForm.role,
        // Chỉ gửi roleId khi thực sự thay đổi để không ghi đè vô cớ.
        roleId:
          !isOwner && FEATURES.ROLES_PERMISSIONS && editForm.roleId !== (editTarget.roleId ?? null)
            ? editForm.roleId
            : undefined,
        password: editForm.password.trim() || undefined,
        isActive: isOwner ? undefined : editForm.isActive,
      })
      toast.success('Đã cập nhật thành viên')
      setEditTarget(null)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function onDelete() {
    if (!deleteTarget) return
    try {
      await deleteMember.mutateAsync(deleteTarget.id)
      toast.success('Đã xóa thành viên')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const columns: Column<TeamMember>[] = [
    {
      key: 'name',
      header: 'Thành viên',
      cell: (m) => (
        <div className="flex items-center gap-3">
          <Avatar>
            {m.avatarUrl && <AvatarImage src={avatarSrc(m.avatarUrl)} />}
            <AvatarFallback>{initials(m.fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{m.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">{m.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Vai trò',
      // Vai trò động (tuỳ chỉnh) nếu đã gán, ngược lại nhãn vai trò cố định.
      cell: (m) => <Badge variant={roleBadgeVariant(m.role)}>{m.roleName ?? ROLE_LABELS[m.role]}</Badge>,
    },
    {
      key: 'accounts',
      header: 'Tài khoản phụ trách',
      cell: (m) => {
        // owner/admin/manager bỏ qua ACL nên không cần giao riêng — nói rõ thay vì
        // hiện danh sách rỗng khiến người dùng tưởng họ không vào được gì.
        if (m.role !== 'member') {
          return <span className="text-xs text-muted-foreground">Toàn bộ tài khoản</span>
        }
        return (
          <button
            type="button"
            onClick={() => setAccountsTarget(m)}
            title="Bấm để giao / gỡ tài khoản"
            className="flex max-w-[22rem] flex-wrap items-center gap-1 rounded-md p-1 text-left transition-colors hover:bg-accent"
          >
            {m.accounts.length === 0 ? (
              <span className="text-xs text-muted-foreground">Chưa giao tài khoản nào</span>
            ) : (
              m.accounts.map((a) => (
                <span
                  key={a.id}
                  title={PLATFORM_LABEL[a.platform] ?? ''}
                  className="max-w-[11rem] truncate rounded-full border bg-muted/60 px-2 py-0.5 text-[11px]"
                >
                  {a.displayName || 'Không tên'}
                </span>
              ))
            )}
            <span className="rounded-full border border-dashed px-1.5 py-0.5 text-[11px] text-primary">+</span>
          </button>
        )
      },
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (m) =>
        m.status === 'active' ? (
          <Badge variant="success">Hoạt động</Badge>
        ) : (
          <Badge variant="secondary">Ngừng</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (m) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => openEdit(m)} aria-label="Sửa">
            <Pencil />
          </Button>
          {m.role !== 'owner' && (
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteTarget(m)}
              aria-label="Xóa"
            >
              <Trash2 />
            </Button>
          )}
        </div>
      ),
    },
  ]

  if (isError) return <ErrorState />

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {members ? `${members.length} thành viên` : 'Danh sách thành viên'}
          </p>
          {/* Vai trò động (/roles, /permissions) — backend TDVN chưa có */}
          {FEATURES.ROLES_PERMISSIONS && (
            <Button variant="outline" onClick={() => setRolesOpen(true)}>
              <Shield /> Quản lý quyền
            </Button>
          )}
          <Button
            onClick={() => {
              resetAdd()
              setAddOpen(true)
            }}
          >
            <Plus /> Thêm thành viên
          </Button>
        </div>

        <DataTable
          columns={columns}
          rows={members ?? []}
          loading={isLoading}
          rowKey={(m) => m.id}
          emptyTitle="Chưa có thành viên nào"
        />
      </CardContent>

      {/* Dialog thêm */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thêm thành viên</DialogTitle>
            <DialogDescription>
              Bỏ trống mật khẩu để hệ thống tự tạo mật khẩu tạm cho thành viên.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onAdd} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="add-name">Họ tên</Label>
              <Input
                id="add-name"
                value={addForm.fullName}
                onChange={(e) => setAddForm((s) => ({ ...s, fullName: e.target.value }))}
                placeholder="Nguyễn Văn A"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-email">Email *</Label>
              <Input
                id="add-email"
                type="email"
                required
                value={addForm.email}
                onChange={(e) => setAddForm((s) => ({ ...s, email: e.target.value }))}
                placeholder="email@company.vn"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vai trò</Label>
              <Select value={addForm.role} onValueChange={(v) => setAddForm((s) => ({ ...s, role: v as Role }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-pass">Mật khẩu (tùy chọn)</Label>
              <Input
                id="add-pass"
                type="text"
                value={addForm.password}
                onChange={(e) => setAddForm((s) => ({ ...s, password: e.target.value }))}
                placeholder="Tối thiểu 8 ký tự"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
                Thêm
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog sửa */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sửa thành viên</DialogTitle>
            <DialogDescription>{editTarget?.email}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Họ tên</Label>
              <Input
                id="edit-name"
                value={editForm.fullName}
                onChange={(e) => setEditForm((s) => ({ ...s, fullName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vai trò</Label>
              {FEATURES.ROLES_PERMISSIONS && dynRoles?.length ? (
                // Danh sách vai trò động: 4 vai trò gốc + vai trò tuỳ chỉnh của tổ
                // chức. Chọn vai trò gốc thì đồng bộ luôn cột `role` cũ (systemKey).
                <Select
                  value={
                    editForm.roleId ??
                    dynRoles.find((r) => r.systemKey === editForm.role)?.id ??
                    ''
                  }
                  onValueChange={(v) => {
                    const picked = dynRoles.find((r) => r.id === v)
                    setEditForm((s) => ({
                      ...s,
                      roleId: v,
                      role: (picked?.systemKey as Role | null) ?? s.role,
                    }))
                  }}
                  disabled={editTarget?.role === 'owner'}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dynRoles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                        {!r.isSystem && ' (tuỳ chỉnh)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={editForm.role}
                  onValueChange={(v) => setEditForm((s) => ({ ...s, role: v as Role }))}
                  disabled={editTarget?.role === 'owner'}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {editTarget?.role === 'owner' && (
                <p className="text-xs text-muted-foreground">Không thể đổi vai trò của chủ sở hữu.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-pass">Đặt lại mật khẩu (tùy chọn)</Label>
              <Input
                id="edit-pass"
                type="text"
                value={editForm.password}
                onChange={(e) => setEditForm((s) => ({ ...s, password: e.target.value }))}
                placeholder="Để trống nếu không đổi"
                disabled={editTarget?.role === 'owner'}
              />
            </div>
            {editTarget?.role !== 'owner' && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>Kích hoạt</Label>
                  <p className="text-xs text-muted-foreground">Tắt để tạm ngừng truy cập của thành viên.</p>
                </div>
                <Switch
                  checked={editForm.isActive}
                  onCheckedChange={(v) => setEditForm((s) => ({ ...s, isActive: v }))}
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                Hủy
              </Button>
              <Button type="submit" disabled={updateMember.isPending}>
                {updateMember.isPending && <Loader2 className="animate-spin" />}
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
            <DialogTitle>Xóa thành viên</DialogTitle>
            <DialogDescription>
              Bạn có chắc muốn xóa <span className="font-medium text-foreground">{deleteTarget?.fullName}</span>? Hành
              động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={deleteMember.isPending}>
              {deleteMember.isPending && <Loader2 className="animate-spin" />}
              Xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EmployeeAccountsDialog member={accountsTarget} onClose={() => setAccountsTarget(null)} />
      {FEATURES.ROLES_PERMISSIONS && <RolesDialog open={rolesOpen} onOpenChange={setRolesOpen} />}
    </Card>
  )
}
