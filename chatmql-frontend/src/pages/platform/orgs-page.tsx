/**
 * orgs-page.tsx — Danh sách tổ chức (Platform). Route `/platform/companies`.
 * Bảng: tên, trạng thái, gói, ngày hết hạn, số user. Tìm kiếm + "Vào công ty".
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, LogIn, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable, type Column } from '@/components/shared/data-table'
import { Pagination } from '@/components/shared/pagination'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { formatNumber } from '@/lib/utils'
import { platformApiError } from '@/lib/platform-client'
import {
  usePlatformOrgs,
  useEnterCompany,
  useCreateOrg,
  type OrgListItem,
} from '@/hooks/use-platform'
import { OrgStatusBadge, formatDate } from './org-status'

const PAGE_SIZE = 20

export function OrgsPage() {
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading, isFetching } = usePlatformOrgs({ search, page, pageSize: PAGE_SIZE })
  const enterCompany = useEnterCompany()

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  async function handleEnter(org: OrgListItem) {
    try {
      await enterCompany.mutateAsync({ orgId: org.id })
      toast.success(`Đang mở CRM của "${org.name}"...`)
      // Full reload để CRM nạp lại token company vừa ghi.
      window.location.href = '/dashboard'
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  const columns: Column<OrgListItem>[] = [
    {
      key: 'name',
      header: 'Tổ chức',
      cell: (o) => (
        <div>
          <p className="font-medium">{o.name}</p>
          <p className="text-xs text-muted-foreground">Tạo ngày {formatDate(o.createdAt)}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Trạng thái', cell: (o) => <OrgStatusBadge status={o.displayStatus} /> },
    { key: 'plan', header: 'Gói', cell: (o) => o.plan || <span className="text-muted-foreground">—</span> },
    {
      key: 'expiresAt',
      header: 'Hết hạn',
      cell: (o) => (
        <span className={o.expiringSoon ? 'font-medium text-warning' : undefined}>
          {formatDate(o.expiresAt)}
        </span>
      ),
    },
    { key: 'users', header: 'Số user', align: 'right', cell: (o) => formatNumber(o.stats.users) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (o) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              handleEnter(o)
            }}
            disabled={enterCompany.isPending}
          >
            <LogIn className="h-4 w-4" /> Vào công ty
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tổ chức"
        description="Quản lý toàn bộ tổ chức trên hệ thống."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Tạo tổ chức
          </Button>
        }
      />

      <form onSubmit={onSearch} className="flex gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm theo tên tổ chức..."
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          Tìm kiếm
        </Button>
      </form>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        loading={isLoading}
        rowKey={(o) => o.id}
        emptyTitle="Chưa có tổ chức nào"
        onRowClick={(o) => navigate(`/platform/companies/${o.id}`)}
      />

      {data && data.meta.total > 0 && (
        <div className="flex items-center justify-between">
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <div className="ml-auto">
            <Pagination
              page={page}
              limit={PAGE_SIZE}
              total={data.meta.total}
              onPageChange={setPage}
            />
          </div>
        </div>
      )}

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function CreateOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const createOrg = useCreateOrg()
  const [form, setForm] = useState({
    orgName: '',
    ownerFullName: '',
    ownerEmail: '',
    ownerPassword: '',
    plan: '',
    expiresAt: '',
  })

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      await createOrg.mutateAsync({
        orgName: form.orgName.trim(),
        ownerFullName: form.ownerFullName.trim(),
        ownerEmail: form.ownerEmail.trim(),
        ownerPassword: form.ownerPassword,
        plan: form.plan.trim() || null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      })
      toast.success('Đã tạo tổ chức mới')
      onOpenChange(false)
      setForm({ orgName: '', ownerFullName: '', ownerEmail: '', ownerPassword: '', plan: '', expiresAt: '' })
    } catch (err) {
      toast.error(platformApiError(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo tổ chức mới</DialogTitle>
          <DialogDescription>Tạo tổ chức kèm tài khoản chủ sở hữu đầu tiên.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="orgName">Tên tổ chức</Label>
            <Input id="orgName" value={form.orgName} onChange={(e) => set('orgName', e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ownerFullName">Tên chủ sở hữu</Label>
              <Input id="ownerFullName" value={form.ownerFullName} onChange={(e) => set('ownerFullName', e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ownerEmail">Email chủ sở hữu</Label>
              <Input id="ownerEmail" type="email" value={form.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ownerPassword">Mật khẩu (≥ 8 ký tự)</Label>
              <Input id="ownerPassword" type="password" value={form.ownerPassword} onChange={(e) => set('ownerPassword', e.target.value)} required minLength={8} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan">Gói (tùy chọn)</Label>
              <Input id="plan" value={form.plan} onChange={(e) => set('plan', e.target.value)} placeholder="VD: Pro" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expiresAt">Ngày hết hạn (bỏ trống = không giới hạn)</Label>
            <Input id="expiresAt" type="date" value={form.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Hủy
            </Button>
            <Button type="submit" disabled={createOrg.isPending}>
              {createOrg.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Tạo tổ chức
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
