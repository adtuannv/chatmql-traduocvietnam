import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, BookOpen, Loader2, Pencil, Plus, Trash2, Zap } from 'lucide-react'
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
import { StatCard } from '@/components/shared/stat-card'
import { DataTable, type Column } from '@/components/shared/data-table'
import { Pagination } from '@/components/shared/pagination'
import { EmptyState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { formatNumber } from '@/lib/utils'
import {
  useCdpEventStats,
  useCdpEvents,
  useCreateEventDefinition,
  useDeleteEventDefinition,
  useEventDefinitions,
  useUpdateEventDefinition,
  isForbidden,
  type CdpEvent,
  type EventDefinition,
} from '@/hooks/use-cdp'
import { Field, ForbiddenNotice, QueryError, formatDateTime, shortJson } from './cdp-shared'

const ALL = '__all__'
const LIMIT = 20
const DAYS_OPTIONS = [7, 30, 90] as const

interface DefForm {
  eventName: string
  displayName: string
  description: string
  isActive: boolean
  schema: string
}
const EMPTY_DEF: DefForm = {
  eventName: '',
  displayName: '',
  description: '',
  isActive: true,
  schema: '',
}

export function EventsTab() {
  const [days, setDays] = useState<number>(30)
  const statsQuery = useCdpEventStats(days)
  const defsQuery = useEventDefinitions()

  const stats = statsQuery.data
  const topEvent = stats?.byEventName[0]
  const maxCount = stats?.byEventName[0]?.count ?? 0

  return (
    <div className="space-y-6">
      {/* Thống kê */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Thống kê</h2>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_OPTIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d} ngày qua
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {statsQuery.isError ? (
          <QueryError error={statsQuery.error} what="thống kê sự kiện" />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Tổng sự kiện"
                value={statsQuery.isLoading ? '…' : (stats?.totalEvents ?? 0)}
                icon={Activity}
                hint={`${days} ngày qua`}
              />
              <StatCard
                label="Loại sự kiện có phát sinh"
                value={statsQuery.isLoading ? '…' : (stats?.byEventName.length ?? 0)}
                icon={Zap}
                tone="success"
                hint={defsQuery.data ? `${defsQuery.data.length} định nghĩa trong từ điển` : undefined}
              />
              <StatCard
                label="Sự kiện phổ biến nhất"
                value={statsQuery.isLoading ? '…' : topEvent ? formatNumber(topEvent.count) : 0}
                icon={BookOpen}
                tone="warning"
                hint={topEvent ? topEvent.name : 'Chưa có dữ liệu'}
              />
            </div>
            {!!stats?.byEventName.length && (
              <Card>
                <CardContent className="space-y-2 pt-5">
                  {stats.byEventName.map((e) => (
                    <div key={e.name} className="flex items-center gap-3 text-sm">
                      <span className="w-48 truncate font-medium" title={e.name}>
                        {e.name}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${maxCount ? Math.max(2, (e.count / maxCount) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <span className="w-16 text-right tabular-nums text-muted-foreground">
                        {formatNumber(e.count)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </section>

      <EventDefinitionsSection />
      <RecentEventsSection />
    </div>
  )
}

// ── Từ điển sự kiện ──────────────────────────────────────────────────
function EventDefinitionsSection() {
  const defsQuery = useEventDefinitions()
  const createDef = useCreateEventDefinition()
  const updateDef = useUpdateEventDefinition()
  const deleteDef = useDeleteEventDefinition()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EventDefinition | null>(null)
  const [form, setForm] = useState<DefForm>(EMPTY_DEF)
  const [deleteTarget, setDeleteTarget] = useState<EventDefinition | null>(null)

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_DEF)
    setDialogOpen(true)
  }
  function openEdit(d: EventDefinition) {
    setEditTarget(d)
    const hasSchema = d.schema && Object.keys(d.schema).length > 0
    setForm({
      eventName: d.eventName,
      displayName: d.displayName,
      description: d.description ?? '',
      isActive: d.isActive,
      schema: hasSchema ? JSON.stringify(d.schema, null, 2) : '',
    })
    setDialogOpen(true)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const eventName = form.eventName.trim()
    const displayName = form.displayName.trim()
    if (!editTarget && !/^[a-z0-9_]+$/.test(eventName)) {
      toast.error('Mã sự kiện chỉ gồm chữ thường, số và dấu gạch dưới (vd: order_paid)')
      return
    }
    if (!displayName) {
      toast.error('Vui lòng nhập tên hiển thị')
      return
    }
    let schema: Record<string, unknown> = {}
    if (form.schema.trim()) {
      try {
        const parsed = JSON.parse(form.schema)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
        schema = parsed
      } catch {
        toast.error('Schema phải là JSON object hợp lệ (JSON Schema)')
        return
      }
    }
    try {
      if (editTarget) {
        await updateDef.mutateAsync({
          id: editTarget.id,
          data: {
            displayName,
            description: form.description.trim(),
            schema,
            isActive: form.isActive,
          },
        })
        toast.success('Đã cập nhật định nghĩa sự kiện')
      } else {
        await createDef.mutateAsync({
          eventName,
          displayName,
          description: form.description.trim(),
          schema,
          isActive: form.isActive,
        })
        toast.success('Đã thêm sự kiện vào từ điển')
      }
      setDialogOpen(false)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  function toggleActive(d: EventDefinition, isActive: boolean) {
    updateDef.mutate(
      {
        id: d.id,
        data: {
          displayName: d.displayName,
          description: d.description ?? undefined,
          schema: d.schema ?? {},
          isActive,
        },
      },
      { onError: (err) => toast.error(apiError(err)) },
    )
  }

  async function onDelete() {
    if (!deleteTarget) return
    try {
      await deleteDef.mutateAsync(deleteTarget.id)
      toast.success('Đã xóa định nghĩa sự kiện')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const defs = defsQuery.data ?? []
  const saving = createDef.isPending || updateDef.isPending

  const columns: Column<EventDefinition>[] = [
    {
      key: 'name',
      header: 'Sự kiện',
      cell: (d) => (
        <div className="min-w-0">
          <p className="font-medium">{d.displayName}</p>
          <code className="text-xs text-muted-foreground">{d.eventName}</code>
        </div>
      ),
    },
    {
      key: 'desc',
      header: 'Mô tả',
      cell: (d) => <span className="line-clamp-2 text-muted-foreground">{d.description || '—'}</span>,
    },
    {
      key: 'schema',
      header: 'Schema',
      cell: (d) =>
        d.schema && Object.keys(d.schema).length > 0 ? (
          <Badge variant="outline">Có kiểm tra</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Tự do</span>
        ),
    },
    {
      key: 'active',
      header: 'Kích hoạt',
      align: 'center',
      cell: (d) => (
        <Switch
          checked={d.isActive}
          onCheckedChange={(v) => toggleActive(d, v)}
          disabled={updateDef.isPending}
          aria-label="Kích hoạt"
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (d) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(d)} aria-label="Sửa">
            <Pencil className="!size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget(d)}
            aria-label="Xóa"
          >
            <Trash2 className="!size-3.5" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Từ điển sự kiện</h2>
          <p className="text-xs text-muted-foreground">
            Định nghĩa các sự kiện hệ thống ghi nhận; schema (JSON Schema) dùng để kiểm tra dữ liệu gửi lên.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus /> Thêm sự kiện
        </Button>
      </div>

      {defsQuery.isError ? (
        <QueryError error={defsQuery.error} what="từ điển sự kiện" />
      ) : (
        <DataTable
          columns={columns}
          rows={defs}
          loading={defsQuery.isLoading}
          rowKey={(d) => d.id}
          emptyTitle="Chưa có định nghĩa sự kiện"
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Sửa định nghĩa sự kiện' : 'Thêm sự kiện'}</DialogTitle>
            <DialogDescription>
              Mã sự kiện dùng trong API/tự động hoá; tên hiển thị dùng trên giao diện.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mã sự kiện" hint="vd: order_paid">
                <Input
                  value={form.eventName}
                  onChange={(e) => setForm((s) => ({ ...s, eventName: e.target.value }))}
                  disabled={!!editTarget}
                  placeholder="order_paid"
                  autoFocus={!editTarget}
                />
              </Field>
              <Field label="Tên hiển thị">
                <Input
                  value={form.displayName}
                  onChange={(e) => setForm((s) => ({ ...s, displayName: e.target.value }))}
                  placeholder="Đã thanh toán đơn"
                  autoFocus={!!editTarget}
                />
              </Field>
            </div>
            <Field label="Mô tả">
              <Textarea
                value={form.description}
                onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
                className="min-h-[60px]"
              />
            </Field>
            <Field label="Schema (JSON Schema, tuỳ chọn)" hint="Để trống nếu không cần kiểm tra dữ liệu.">
              <Textarea
                value={form.schema}
                onChange={(e) => setForm((s) => ({ ...s, schema: e.target.value }))}
                placeholder='{"type":"object","properties":{"amount":{"type":"number"}}}'
                className="min-h-[100px] font-mono text-xs"
              />
            </Field>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Kích hoạt</p>
                <p className="text-xs text-muted-foreground">Tắt để ngừng kiểm tra schema cho sự kiện này.</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((s) => ({ ...s, isActive: v }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="animate-spin" />}
                {editTarget ? 'Lưu' : 'Thêm'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa định nghĩa sự kiện</DialogTitle>
            <DialogDescription>
              Xóa <span className="font-medium text-foreground">{deleteTarget?.displayName}</span> khỏi từ điển. Các sự
              kiện đã ghi nhận vẫn được giữ.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={deleteDef.isPending}>
              {deleteDef.isPending && <Loader2 className="animate-spin" />}
              Xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── Sự kiện gần đây ──────────────────────────────────────────────────
function RecentEventsSection() {
  const defsQuery = useEventDefinitions()
  const [page, setPage] = useState(1)
  const [eventName, setEventName] = useState<string>(ALL)
  const [source, setSource] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const params = useMemo(
    () => ({
      eventName: eventName === ALL ? undefined : eventName,
      source: source.trim() || undefined,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      limit: LIMIT,
      offset: (page - 1) * LIMIT,
    }),
    [eventName, source, from, to, page],
  )
  const { data, isLoading, isError, error } = useCdpEvents(params)

  const defs = defsQuery.data ?? []
  const defLabel = (name: string) => defs.find((d) => d.eventName === name)?.displayName

  const columns: Column<CdpEvent>[] = [
    {
      key: 'time',
      header: 'Thời gian',
      cell: (e) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(e.timestamp)}</span>,
    },
    {
      key: 'contact',
      header: 'Khách hàng',
      cell: (e) =>
        e.contact ? (
          <Link to={`/customers/${e.contact.id}`} className="font-medium hover:underline">
            {e.contact.fullName || 'Chưa có tên'}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'event',
      header: 'Sự kiện',
      cell: (e) => {
        const label = defLabel(e.eventName)
        return (
          <div className="min-w-0">
            <p className="font-medium">{label ?? e.eventName}</p>
            {label && <code className="text-xs text-muted-foreground">{e.eventName}</code>}
          </div>
        )
      },
    },
    {
      key: 'source',
      header: 'Nguồn',
      cell: (e) => (e.source ? <Badge variant="secondary">{e.source}</Badge> : '—'),
    },
    {
      key: 'props',
      header: 'Dữ liệu',
      cell: (e) => {
        const s = shortJson(e.properties)
        return s ? (
          <code
            className="block max-w-[320px] truncate text-xs text-muted-foreground"
            title={JSON.stringify(e.properties)}
          >
            {s}
          </code>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )
      },
    },
  ]

  if (isError && isForbidden(error)) return <ForbiddenNotice what="sự kiện đã ghi nhận" />

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Sự kiện gần đây</h2>
        <p className="text-xs text-muted-foreground">Dòng sự kiện toàn tổ chức, mới nhất trước.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={eventName}
          onValueChange={(v) => {
            setEventName(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Loại sự kiện" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả sự kiện</SelectItem>
            {defs.map((d) => (
              <SelectItem key={d.id} value={d.eventName}>
                {d.displayName}
              </SelectItem>
            ))}
            {!defs.some((d) => d.eventName === 'lifecycle_change') && (
              <SelectItem value="lifecycle_change">Đổi giai đoạn (hệ thống)</SelectItem>
            )}
          </SelectContent>
        </Select>
        <Input
          value={source}
          onChange={(e) => {
            setSource(e.target.value)
            setPage(1)
          }}
          placeholder="Nguồn (api, system, widget…)"
          className="w-[200px]"
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value)
            setPage(1)
          }}
          className="w-[160px]"
          aria-label="Từ ngày"
        />
        <span className="text-sm text-muted-foreground">→</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value)
            setPage(1)
          }}
          className="w-[160px]"
          aria-label="Đến ngày"
        />
        {(eventName !== ALL || source || from || to) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEventName(ALL)
              setSource('')
              setFrom('')
              setTo('')
              setPage(1)
            }}
          >
            Xoá lọc
          </Button>
        )}
      </div>

      {isError ? (
        <QueryError error={error} what="sự kiện" />
      ) : isLoading ? (
        <Loading label="Đang tải sự kiện..." />
      ) : !data?.events.length ? (
        <EmptyState
          icon={Activity}
          title="Chưa có sự kiện"
          description="Sự kiện sẽ xuất hiện khi khách hàng tương tác hoặc API ghi nhận."
        />
      ) : (
        <>
          <DataTable columns={columns} rows={data.events} rowKey={(e) => e.id} />
          <Pagination page={page} limit={LIMIT} total={data.total} onPageChange={setPage} />
        </>
      )}
    </section>
  )
}
