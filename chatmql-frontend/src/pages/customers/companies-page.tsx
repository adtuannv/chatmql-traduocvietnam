import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Building2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import dayjs from 'dayjs'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable, type Column } from '@/components/shared/data-table'
import { Pagination } from '@/components/shared/pagination'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/misc'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiError } from '@/lib/api-client'
import {
  useCompanies,
  useCreateCompany,
  useDeleteCompany,
  useUpdateCompany,
  type CompanyInput,
  type CompanyListItem,
} from '@/hooks/use-companies'

const LIMIT = 20

export function CompaniesPage() {
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<{ open: boolean; company: CompanyListItem | null }>({
    open: false,
    company: null,
  })
  const del = useDeleteCompany()

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const params = useMemo(
    () => ({ page, limit: LIMIT, search: search || undefined }),
    [page, search],
  )
  const { data, isLoading, isError } = useCompanies(params)

  const onDelete = (c: CompanyListItem) => {
    if (!confirm(`Xóa công ty "${c.name}"?`)) return
    del.mutate(c.id, {
      onSuccess: () => toast.success('Đã xóa công ty'),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  const columns: Column<CompanyListItem>[] = [
    {
      key: 'name',
      header: 'Công ty',
      cell: (c) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{c.name}</p>
            {c.website && <p className="truncate text-xs text-muted-foreground">{c.website}</p>}
          </div>
        </div>
      ),
    },
    { key: 'taxCode', header: 'Mã số thuế', cell: (c) => c.taxCode || '—' },
    { key: 'industry', header: 'Ngành', cell: (c) => c.industry || '—' },
    {
      key: 'contacts',
      header: 'Liên hệ',
      align: 'right',
      cell: (c) => <Badge variant="secondary">{c._count?.contacts ?? 0}</Badge>,
    },
    { key: 'phone', header: 'Điện thoại', cell: (c) => c.phone || '—' },
    {
      key: 'createdAt',
      header: 'Ngày tạo',
      cell: (c) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {dayjs(c.createdAt).format('DD/MM/YYYY')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (c) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDialog({ open: true, company: c })}
            title="Sửa"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(c)} title="Xóa">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Công ty"
        description="Quản lý danh sách công ty (B2B)."
        actions={
          <Button onClick={() => setDialog({ open: true, company: null })}>
            <Plus className="h-4 w-4" /> Thêm công ty
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Tìm theo tên, mã số thuế, email..."
          className="pl-9"
        />
      </div>

      <DataTable
        columns={columns}
        rows={data?.companies ?? []}
        loading={isLoading}
        rowKey={(c) => c.id}
        emptyTitle={isError ? 'Không tải được dữ liệu' : 'Chưa có công ty nào'}
      />

      {!!data && data.total > 0 && (
        <Pagination page={page} limit={LIMIT} total={data.total} onPageChange={setPage} />
      )}

      {dialog.open && (
        <CompanyDialog
          company={dialog.company}
          open={dialog.open}
          onOpenChange={(open) => setDialog({ open, company: open ? dialog.company : null })}
        />
      )}
    </div>
  )
}

function CompanyDialog({
  company,
  open,
  onOpenChange,
}: {
  company: CompanyListItem | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const create = useCreateCompany()
  const update = useUpdateCompany()
  const isEdit = !!company
  const pending = create.isPending || update.isPending

  const [form, setForm] = useState<CompanyInput>({
    name: company?.name ?? '',
    taxCode: company?.taxCode ?? '',
    industry: company?.industry ?? '',
    size: company?.size ?? '',
    website: company?.website ?? '',
    phone: company?.phone ?? '',
    email: company?.email ?? '',
    address: company?.address ?? '',
    notes: company?.notes ?? '',
  })
  const set = (k: keyof CompanyInput, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const onSubmit = () => {
    if (!form.name?.trim()) {
      toast.error('Vui lòng nhập tên công ty')
      return
    }
    const cb = {
      onSuccess: () => {
        toast.success(isEdit ? 'Đã cập nhật công ty' : 'Đã thêm công ty')
        onOpenChange(false)
      },
      onError: (e: unknown) => toast.error(apiError(e)),
    }
    if (isEdit && company) update.mutate({ id: company.id, data: form }, cb)
    else create.mutate(form, cb)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Chỉnh sửa công ty' : 'Thêm công ty'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <F label="Tên công ty *">
            <Input value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </F>
          <div className="grid grid-cols-2 gap-3">
            <F label="Mã số thuế">
              <Input value={form.taxCode ?? ''} onChange={(e) => set('taxCode', e.target.value)} />
            </F>
            <F label="Ngành">
              <Input value={form.industry ?? ''} onChange={(e) => set('industry', e.target.value)} />
            </F>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Quy mô">
              <Input value={form.size ?? ''} onChange={(e) => set('size', e.target.value)} />
            </F>
            <F label="Website">
              <Input value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} />
            </F>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Điện thoại">
              <Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
            </F>
            <F label="Email">
              <Input value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
            </F>
          </div>
          <F label="Địa chỉ">
            <Input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          </F>
          <F label="Ghi chú">
            <Textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </F>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
