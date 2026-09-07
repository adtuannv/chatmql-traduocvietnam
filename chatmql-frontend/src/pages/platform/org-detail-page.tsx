/**
 * org-detail-page.tsx — Chi tiết 1 tổ chức (Platform).
 * Route `/platform/companies/:orgId`.
 * Gồm: thông tin, cấp phép (gia hạn/khóa), và quản lý người dùng.
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Loader2,
  Lock,
  Unlock,
  KeyRound,
  LogIn,
  Plus,
  Save,
  Users,
  Contact,
  MessageSquare,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { StatCard } from '@/components/shared/stat-card'
import { DataTable, type Column } from '@/components/shared/data-table'
import { Loading, ErrorState } from '@/components/shared/feedback'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { platformApiError } from '@/lib/platform-client'
import {
  usePlatformOrg,
  useUpdateOrg,
  useUpdateOrgLicense,
  useAddOrgUser,
  useSetOrgUserActive,
  useResetOrgUserPassword,
  useEnterCompany,
  type OrgUser,
} from '@/hooks/use-platform'
import { OrgStatusBadge, roleLabel, formatDate, toDateInput } from './org-status'

export function OrgDetailPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const navigate = useNavigate()
  const { data: org, isLoading, isError } = usePlatformOrg(orgId)

  if (isLoading) return <Loading label="Đang tải..." />
  if (isError || !org) return <ErrorState message="Không tìm thấy tổ chức." />

  return (
    <div className="space-y-6">
      <PageHeader
        title={org.name}
        description={`Chi tiết tổ chức · ${roleLabelStatus(org.displayStatus)}`}
        actions={
          <Button variant="outline" onClick={() => navigate('/platform/companies')}>
            <ArrowLeft className="h-4 w-4" /> Danh sách
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <OrgStatusBadge status={org.displayStatus} />
        {org.plan && <Badge variant="outline">Gói: {org.plan}</Badge>}
        <Badge variant="outline">Hết hạn: {formatDate(org.expiresAt)}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Người dùng" value={org.stats.users} icon={Users} />
        <StatCard label="Khách hàng" value={org.stats.contacts} icon={Contact} />
        <StatCard label="Hội thoại" value={org.stats.conversations} icon={MessageSquare} />
      </div>

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Thông tin & Cấp phép</TabsTrigger>
          <TabsTrigger value="users">Người dùng ({org.users.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <OrgInfoCard orgId={org.id} name={org.name} plan={org.plan} adminNotes={org.adminNotes} />
            <OrgLicenseCard orgId={org.id} status={org.status} expiresAt={org.expiresAt} />
          </div>
        </TabsContent>

        <TabsContent value="users">
          <OrgUsersSection orgId={org.id} users={org.users} orgName={org.name} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function roleLabelStatus(status: string) {
  const map: Record<string, string> = {
    active: 'Đang hoạt động',
    unlimited: 'Không giới hạn',
    expired: 'Đã hết hạn',
    suspended: 'Đã khóa',
  }
  return map[status] ?? status
}

// ── Thông tin cơ bản ──────────────────────────────────────────────
function OrgInfoCard({
  orgId,
  name,
  plan,
  adminNotes,
}: {
  orgId: string
  name: string
  plan: string | null
  adminNotes: string | null
}) {
  const update = useUpdateOrg(orgId)
  const [form, setForm] = useState({ name, plan: plan ?? '', adminNotes: adminNotes ?? '' })

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    try {
      await update.mutateAsync({
        name: form.name.trim(),
        plan: form.plan.trim() || null,
        adminNotes: form.adminNotes.trim() || null,
      })
      toast.success('Đã lưu thông tin tổ chức')
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thông tin tổ chức</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Tên tổ chức</Label>
            <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan">Gói dịch vụ</Label>
            <Input id="plan" value={form.plan} onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))} placeholder="VD: Pro" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adminNotes">Ghi chú nội bộ</Label>
            <Input id="adminNotes" value={form.adminNotes} onChange={(e) => setForm((f) => ({ ...f, adminNotes: e.target.value }))} />
          </div>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Lưu thay đổi
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Cấp phép: gia hạn / khóa ──────────────────────────────────────
function OrgLicenseCard({
  orgId,
  status,
  expiresAt,
}: {
  orgId: string
  status: string
  expiresAt: string | null
}) {
  const license = useUpdateOrgLicense(orgId)
  const [expires, setExpires] = useState(toDateInput(expiresAt))
  const suspended = status === 'suspended'

  async function saveExpiry(unlimited: boolean) {
    try {
      await license.mutateAsync({
        expiresAt: unlimited ? null : expires ? new Date(expires).toISOString() : null,
      })
      toast.success(unlimited ? 'Đã đặt không giới hạn' : 'Đã cập nhật ngày hết hạn')
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  async function toggleSuspend() {
    try {
      await license.mutateAsync({ status: suspended ? 'active' : 'suspended' })
      toast.success(suspended ? 'Đã mở khóa tổ chức' : 'Đã khóa tổ chức')
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cấp phép</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="expiresAt">Ngày hết hạn</Label>
          <div className="flex gap-2">
            <Input id="expiresAt" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            <Button variant="outline" onClick={() => saveExpiry(false)} disabled={license.isPending}>
              Gia hạn
            </Button>
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => saveExpiry(true)}
          >
            Đặt không giới hạn (xóa hạn)
          </button>
        </div>

        <div className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{suspended ? 'Tổ chức đang bị khóa' : 'Tổ chức đang hoạt động'}</p>
              <p className="text-xs text-muted-foreground">
                Khóa sẽ chặn tất cả người dùng của tổ chức đăng nhập CRM.
              </p>
            </div>
            <Button
              variant={suspended ? 'default' : 'destructive'}
              onClick={toggleSuspend}
              disabled={license.isPending}
            >
              {license.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : suspended ? (
                <Unlock className="h-4 w-4" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              {suspended ? 'Mở khóa' : 'Khóa tổ chức'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Người dùng ────────────────────────────────────────────────────
function OrgUsersSection({ orgId, users, orgName }: { orgId: string; users: OrgUser[]; orgName: string }) {
  const setActive = useSetOrgUserActive(orgId)
  const enterCompany = useEnterCompany()
  const [addOpen, setAddOpen] = useState(false)
  const [resetUser, setResetUser] = useState<OrgUser | null>(null)

  async function toggleActive(u: OrgUser) {
    try {
      await setActive.mutateAsync({ userId: u.id, isActive: !u.isActive })
      toast.success(u.isActive ? 'Đã khóa người dùng' : 'Đã mở khóa người dùng')
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  async function enterAsUser(u: OrgUser) {
    try {
      await enterCompany.mutateAsync({ orgId, userId: u.id })
      toast.success(`Đang mở CRM với tài khoản ${u.fullName}...`)
      window.location.href = '/dashboard'
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  const columns: Column<OrgUser>[] = [
    {
      key: 'user',
      header: 'Người dùng',
      cell: (u) => (
        <div>
          <p className="font-medium">{u.fullName}</p>
          <p className="text-xs text-muted-foreground">{u.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Vai trò', cell: (u) => <Badge variant="outline">{roleLabel(u.role)}</Badge> },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (u) =>
        u.isActive ? <Badge variant="success">Hoạt động</Badge> : <Badge variant="destructive">Đã khóa</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => enterAsUser(u)} disabled={!u.isActive || enterCompany.isPending}>
            <LogIn className="h-4 w-4" /> Vào
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setResetUser(u)}>
            <KeyRound className="h-4 w-4" /> Đổi MK
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggleActive(u)} disabled={setActive.isPending}>
            {u.isActive ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            {u.isActive ? 'Khóa' : 'Mở'}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Quản lý tài khoản của {orgName}.</p>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Thêm người dùng
        </Button>
      </div>

      <DataTable columns={columns} rows={users} rowKey={(u) => u.id} emptyTitle="Chưa có người dùng" />

      <AddUserDialog orgId={orgId} open={addOpen} onOpenChange={setAddOpen} />
      <ResetPasswordDialog orgId={orgId} user={resetUser} onClose={() => setResetUser(null)} />
    </div>
  )
}

function AddUserDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const addUser = useAddOrgUser(orgId)
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'member' })

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await addUser.mutateAsync({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
      })
      toast.success('Đã thêm người dùng')
      onOpenChange(false)
      setForm({ fullName: '', email: '', password: '', role: 'member' })
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thêm người dùng</DialogTitle>
          <DialogDescription>Tạo tài khoản mới trong tổ chức này.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Họ tên</Label>
            <Input id="u-name" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="u-password">Mật khẩu (≥ 8 ký tự)</Label>
              <Input id="u-password" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required minLength={8} />
            </div>
            <div className="space-y-1.5">
              <Label>Vai trò</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Chủ sở hữu</SelectItem>
                  <SelectItem value="admin">Quản trị</SelectItem>
                  <SelectItem value="manager">Quản lý</SelectItem>
                  <SelectItem value="member">Nhân viên</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Hủy
            </Button>
            <Button type="submit" disabled={addUser.isPending}>
              {addUser.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Thêm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({
  orgId,
  user,
  onClose,
}: {
  orgId: string
  user: OrgUser | null
  onClose: () => void
}) {
  const reset = useResetOrgUserPassword(orgId)
  const [newPassword, setNewPassword] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    try {
      await reset.mutateAsync({ userId: user.id, newPassword })
      toast.success('Đã đổi mật khẩu')
      setNewPassword('')
      onClose()
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đổi mật khẩu</DialogTitle>
          <DialogDescription>{user ? `Đặt mật khẩu mới cho ${user.fullName}.` : ''}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Mật khẩu mới (≥ 8 ký tự)</Label>
            <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" disabled={reset.isPending}>
              {reset.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Đổi mật khẩu
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
