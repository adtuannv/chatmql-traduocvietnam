import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Users } from 'lucide-react'
import dayjs from 'dayjs'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable, type Column } from '@/components/shared/data-table'
import { Pagination } from '@/components/shared/pagination'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { initials } from '@/lib/utils'
import {
  LIFECYCLE_STAGES,
  STAGE_LABELS,
  stageBadgeVariant,
  stageLabel,
  useContacts,
  type ContactListItem,
} from '@/hooks/use-contacts'

const LIMIT = 20
const ALL = '__all__'

export function CustomersPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState<string>(ALL)

  // Debounce ô tìm kiếm
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const params = useMemo(
    () => ({
      page,
      limit: LIMIT,
      search: search || undefined,
      lifecycleStage: stage === ALL ? undefined : stage,
    }),
    [page, search, stage],
  )

  const { data, isLoading, isError } = useContacts(params)

  const columns: Column<ContactListItem>[] = [
    {
      key: 'name',
      header: 'Khách hàng',
      cell: (c) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt={c.fullName ?? ''} />}
            <AvatarFallback>{initials(c.crmName || c.fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{c.crmName || c.fullName || 'Chưa có tên'}</p>
            {c.company?.name && (
              <p className="truncate text-xs text-muted-foreground">{c.company.name}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Số điện thoại',
      cell: (c) => <span className="tabular-nums">{c.phone || '—'}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      cell: (c) => <span className="truncate text-muted-foreground">{c.email || '—'}</span>,
    },
    {
      key: 'stage',
      header: 'Giai đoạn',
      cell: (c) => <Badge variant={stageBadgeVariant(c.lifecycleStage)}>{stageLabel(c.lifecycleStage)}</Badge>,
    },
    {
      key: 'score',
      header: 'Điểm',
      align: 'right',
      cell: (c) => <span className="font-semibold tabular-nums">{c.leadScore}</span>,
    },
    {
      key: 'assigned',
      header: 'Phụ trách',
      cell: (c) => <span className="text-muted-foreground">{c.assignedUser?.fullName || '—'}</span>,
    },
    {
      key: 'createdAt',
      header: 'Ngày tạo',
      cell: (c) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {dayjs(c.createdAt).format('DD/MM/YYYY')}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Khách hàng"
        description="Danh sách toàn bộ khách hàng và liên hệ của bạn."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo tên, số điện thoại, email..."
            className="pl-9"
          />
        </div>
        <Select
          value={stage}
          onValueChange={(v) => {
            setStage(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Giai đoạn" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả giai đoạn</SelectItem>
            {LIFECYCLE_STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.contacts ?? []}
        loading={isLoading}
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        emptyTitle={isError ? 'Không tải được dữ liệu' : 'Chưa có khách hàng nào'}
      />

      {!!data && data.total > 0 && (
        <Pagination page={page} limit={LIMIT} total={data.total} onPageChange={setPage} />
      )}

      {!isLoading && !data?.contacts.length && !isError && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" /> Thử thay đổi từ khóa hoặc bộ lọc.
        </p>
      )}
    </div>
  )
}
