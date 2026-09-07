import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Pencil, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react'
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { DataTable, type Column } from '@/components/shared/data-table'
import { Pagination } from '@/components/shared/pagination'
import { EmptyState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { formatNumber, initials } from '@/lib/utils'
import { stageBadgeVariant, stageLabel } from '@/hooks/use-contacts'
import {
  CONDITION_TYPE_LABELS,
  CONTACT_FIELDS,
  LIFECYCLE_STAGES,
  SEGMENT_OPERATORS,
  STAGE_LABELS,
  emptyCondition,
  emptyGroup,
  operatorLabel,
  operatorsFor,
  useCdpProperties,
  useCreateSegment,
  useDeleteSegment,
  useEventDefinitions,
  useRecalculateSegment,
  useSegmentContacts,
  useSegments,
  useUpdateSegment,
  type Segment,
  type SegmentCondition,
  type SegmentConditionGroup,
  type SegmentConditionType,
  type SegmentContact,
} from '@/hooks/use-cdp'
import { Field, QueryError, formatDateTime } from './cdp-shared'

const CONDITION_TYPES = Object.keys(CONDITION_TYPE_LABELS) as SegmentConditionType[]
const PREVIEW_LIMIT = 20

function cloneGroups(groups: SegmentConditionGroup[]): SegmentConditionGroup[] {
  return groups.map((g) => ({
    logic: g.logic,
    conditions: g.conditions.map((c) => ({ ...c })),
  }))
}

function conditionSummary(c: SegmentCondition, fieldLabel: (c: SegmentCondition) => string): string {
  const op = SEGMENT_OPERATORS.find((o) => o.value === c.operator)
  const noValue = op?.noValue
  if (c.type === 'lifecycle') return `Giai đoạn = ${STAGE_LABELS[String(c.value)] ?? c.value}`
  const val = c.field === 'lifecycleStage' ? (STAGE_LABELS[String(c.value)] ?? String(c.value)) : String(c.value)
  return `${fieldLabel(c)} ${operatorLabel(c.operator)}${noValue ? '' : ` ${val}`}`
}

export function SegmentsTab() {
  const segmentsQuery = useSegments()
  const propsQuery = useCdpProperties()
  const defsQuery = useEventDefinitions()
  const createSeg = useCreateSegment()
  const updateSeg = useUpdateSegment()
  const deleteSeg = useDeleteSegment()
  const recalc = useRecalculateSegment()

  const [builderOpen, setBuilderOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Segment | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [groups, setGroups] = useState<SegmentConditionGroup[]>([emptyGroup()])
  const [deleteTarget, setDeleteTarget] = useState<Segment | null>(null)
  const [previewTarget, setPreviewTarget] = useState<Segment | null>(null)
  const [recalcId, setRecalcId] = useState<string | null>(null)

  const properties = propsQuery.data?.properties ?? []
  const eventDefs = defsQuery.data ?? []

  const fieldLabel = useMemo(
    () => (c: SegmentCondition) => {
      if (c.type === 'contact') return CONTACT_FIELDS.find((f) => f.value === c.field)?.label ?? c.field
      if (c.type === 'property') return properties.find((p) => p.fieldKey === c.field)?.name ?? c.field
      if (c.type === 'event') return eventDefs.find((d) => d.eventName === c.field)?.displayName ?? c.field
      return 'Giai đoạn'
    },
    [properties, eventDefs],
  )

  function openCreate() {
    setEditTarget(null)
    setName('')
    setDescription('')
    setGroups([emptyGroup()])
    setBuilderOpen(true)
  }

  function openEdit(s: Segment) {
    setEditTarget(s)
    setName(s.name)
    setDescription(s.description ?? '')
    setGroups(Array.isArray(s.conditions) && s.conditions.length ? cloneGroups(s.conditions) : [emptyGroup()])
    setBuilderOpen(true)
  }

  function patchCondition(gi: number, ci: number, patch: Partial<SegmentCondition>) {
    setGroups((gs) =>
      gs.map((g, i) =>
        i !== gi
          ? g
          : {
              ...g,
              conditions: g.conditions.map((c, j) => (j !== ci ? c : { ...c, ...patch })),
            },
      ),
    )
  }

  function changeType(gi: number, ci: number, type: SegmentConditionType) {
    const ops = operatorsFor(type)
    let field = ''
    if (type === 'contact') field = CONTACT_FIELDS[0].value
    else if (type === 'property') field = properties[0]?.fieldKey ?? ''
    else if (type === 'event') field = eventDefs[0]?.eventName ?? ''
    else field = 'lifecycleStage'
    patchCondition(gi, ci, {
      type,
      field,
      operator: ops[0]?.value ?? 'equals',
      value: type === 'lifecycle' ? LIFECYCLE_STAGES[0] : '',
    })
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) {
      toast.error('Vui lòng nhập tên segment')
      return
    }
    // Chuẩn hoá: bỏ điều kiện thiếu trường, ép số cho toán tử số
    const cleaned: SegmentConditionGroup[] = groups
      .map((g) => ({
        logic: g.logic,
        conditions: g.conditions
          .filter((c) => c.field)
          .map((c) => {
            const op = SEGMENT_OPERATORS.find((o) => o.value === c.operator)
            if (op?.noValue) return { ...c, value: '' }
            const numeric = ['gt', 'gte', 'lt', 'lte', 'event_count_gte'].includes(c.operator)
            return { ...c, value: numeric ? Number(c.value) : String(c.value) }
          }),
      }))
      .filter((g) => g.conditions.length > 0)
    if (!cleaned.length) {
      toast.error('Cần ít nhất một điều kiện')
      return
    }
    const bad = cleaned.some((g) =>
      g.conditions.some((c) => {
        const op = SEGMENT_OPERATORS.find((o) => o.value === c.operator)
        if (op?.noValue) return false
        return c.value === '' || (typeof c.value === 'number' && Number.isNaN(c.value))
      }),
    )
    if (bad) {
      toast.error('Có điều kiện chưa nhập giá trị')
      return
    }
    try {
      if (editTarget) {
        await updateSeg.mutateAsync({
          id: editTarget.id,
          data: {
            name: n,
            description: description.trim(),
            conditions: cleaned,
          },
        })
        toast.success('Đã cập nhật segment')
      } else {
        const created = await createSeg.mutateAsync({
          name: n,
          description: description.trim(),
          conditions: cleaned,
        })
        toast.success(`Đã tạo segment · ${formatNumber(created.contactCount)} khách hàng`)
      }
      setBuilderOpen(false)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  function onRecalc(s: Segment) {
    setRecalcId(s.id)
    recalc.mutate(s.id, {
      onSuccess: (r) => toast.success(`${s.name}: ${formatNumber(r.contactCount)} khách hàng`),
      onError: (err) => toast.error(apiError(err)),
      onSettled: () => setRecalcId(null),
    })
  }

  async function onDelete() {
    if (!deleteTarget) return
    try {
      await deleteSeg.mutateAsync(deleteTarget.id)
      toast.success('Đã xóa segment')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const saving = createSeg.isPending || updateSeg.isPending
  const segments = segmentsQuery.data?.segments ?? []

  if (segmentsQuery.isLoading) return <Loading label="Đang tải segment..." />
  if (segmentsQuery.isError) return <QueryError error={segmentsQuery.error} what="segment" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {segments.length} segment · nhóm khách hàng theo điều kiện, dùng cho ZNS và tự động hoá.
        </p>
        <Button onClick={openCreate}>
          <Plus /> Tạo segment
        </Button>
      </div>

      {segments.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Chưa có segment nào"
          description="Tạo segment để nhóm khách hàng theo thuộc tính, sự kiện hoặc giai đoạn."
          action={
            <Button onClick={openCreate}>
              <Plus /> Tạo segment
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {segments.map((s) => {
            const conds = Array.isArray(s.conditions) ? s.conditions : []
            return (
              <Card key={s.id}>
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{s.name}</p>
                      {s.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-2xl font-bold tabular-nums">{formatNumber(s.contactCount)}</p>
                      <p className="text-xs text-muted-foreground">khách hàng</p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {conds.map((g, gi) => (
                      <div key={gi} className="flex flex-wrap items-center gap-1">
                        {gi > 0 && <span className="mr-1 text-xs font-semibold text-muted-foreground">VÀ</span>}
                        {g.conditions.map((c, ci) => (
                          <span key={ci} className="flex items-center gap-1">
                            {ci > 0 && (
                              <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                                {g.logic === 'OR' ? 'hoặc' : 'và'}
                              </span>
                            )}
                            <Badge variant="secondary" className="font-normal">
                              {conditionSummary(c, fieldLabel)}
                            </Badge>
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <span className="text-xs text-muted-foreground">Tính lúc {formatDateTime(s.lastCalculatedAt)}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setPreviewTarget(s)}>
                        <Users className="!size-3.5" /> Xem KH
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={recalc.isPending && recalcId === s.id}
                        onClick={() => onRecalc(s)}
                      >
                        <RefreshCw
                          className={recalc.isPending && recalcId === s.id ? '!size-3.5 animate-spin' : '!size-3.5'}
                        />
                        Tính lại
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(s)}
                        aria-label="Sửa"
                      >
                        <Pencil className="!size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(s)}
                        aria-label="Xóa"
                      >
                        <Trash2 className="!size-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Builder */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Sửa segment' : 'Tạo segment'}</DialogTitle>
            <DialogDescription>
              Các nhóm điều kiện được kết hợp bằng VÀ; trong mỗi nhóm chọn VÀ / HOẶC.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tên segment">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Khách VIP Hà Nội"
                  autoFocus
                />
              </Field>
              <Field label="Mô tả">
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tuỳ chọn" />
              </Field>
            </div>

            <div className="space-y-3">
              {groups.map((g, gi) => (
                <div key={gi} className="space-y-2">
                  {gi > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-border" />
                      <Badge variant="outline">VÀ</Badge>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">Nhóm {gi + 1}</span>
                        <Select
                          value={g.logic}
                          onValueChange={(v) =>
                            setGroups((gs) => gs.map((x, i) => (i === gi ? { ...x, logic: v as 'AND' | 'OR' } : x)))
                          }
                        >
                          <SelectTrigger className="h-7 w-[150px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="AND">Thoả tất cả (VÀ)</SelectItem>
                            <SelectItem value="OR">Thoả một (HOẶC)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {groups.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setGroups((gs) => gs.filter((_, i) => i !== gi))}
                        >
                          <X className="!size-3.5" /> Bỏ nhóm
                        </Button>
                      )}
                    </div>

                    {g.conditions.map((c, ci) => {
                      const ops = operatorsFor(c.type)
                      const op = ops.find((o) => o.value === c.operator)
                      const contactField = CONTACT_FIELDS.find((f) => f.value === c.field)
                      const numeric =
                        ['gt', 'gte', 'lt', 'lte', 'event_count_gte'].includes(c.operator) || !!contactField?.numeric
                      const stageSelect =
                        c.type === 'lifecycle' || (c.type === 'contact' && c.field === 'lifecycleStage')
                      return (
                        <div key={ci} className="grid gap-2 sm:grid-cols-[150px_1fr_150px_1fr_auto]">
                          <Select value={c.type} onValueChange={(v) => changeType(gi, ci, v as SegmentConditionType)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CONDITION_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {CONDITION_TYPE_LABELS[t]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {/* Trường */}
                          {c.type === 'contact' && (
                            <Select
                              value={c.field}
                              onValueChange={(v) => patchCondition(gi, ci, { field: v, value: '' })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CONTACT_FIELDS.map((f) => (
                                  <SelectItem key={f.value} value={f.value}>
                                    {f.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          {c.type === 'property' &&
                            (properties.length ? (
                              <Select value={c.field} onValueChange={(v) => patchCondition(gi, ci, { field: v })}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Chọn thuộc tính" />
                                </SelectTrigger>
                                <SelectContent>
                                  {properties.map((p) => (
                                    <SelectItem key={p.id} value={p.fieldKey}>
                                      {p.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                value={c.field}
                                onChange={(e) =>
                                  patchCondition(gi, ci, {
                                    field: e.target.value,
                                  })
                                }
                                placeholder="fieldKey thuộc tính"
                              />
                            ))}
                          {c.type === 'event' &&
                            (eventDefs.length ? (
                              <Select value={c.field} onValueChange={(v) => patchCondition(gi, ci, { field: v })}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Chọn sự kiện" />
                                </SelectTrigger>
                                <SelectContent>
                                  {eventDefs.map((d) => (
                                    <SelectItem key={d.id} value={d.eventName}>
                                      {d.displayName}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                value={c.field}
                                onChange={(e) =>
                                  patchCondition(gi, ci, {
                                    field: e.target.value,
                                  })
                                }
                                placeholder="Tên sự kiện (eventName)"
                              />
                            ))}
                          {c.type === 'lifecycle' && (
                            <Input value="Giai đoạn hiện tại" disabled className="text-muted-foreground" />
                          )}

                          {/* Toán tử */}
                          <Select value={c.operator} onValueChange={(v) => patchCondition(gi, ci, { operator: v })}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ops.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {/* Giá trị */}
                          {op?.noValue ? (
                            <div />
                          ) : stageSelect ? (
                            <Select
                              value={String(c.value) || LIFECYCLE_STAGES[0]}
                              onValueChange={(v) => patchCondition(gi, ci, { value: v })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {LIFECYCLE_STAGES.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {STAGE_LABELS[s]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              type={numeric ? 'number' : 'text'}
                              value={String(c.value)}
                              onChange={(e) =>
                                patchCondition(gi, ci, {
                                  value: e.target.value,
                                })
                              }
                              placeholder={numeric ? '0' : 'Giá trị'}
                            />
                          )}

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                            disabled={g.conditions.length <= 1}
                            onClick={() =>
                              setGroups((gs) =>
                                gs.map((x, i) =>
                                  i === gi
                                    ? {
                                        ...x,
                                        conditions: x.conditions.filter((_, j) => j !== ci),
                                      }
                                    : x,
                                ),
                              )
                            }
                            aria-label="Bỏ điều kiện"
                          >
                            <X className="!size-3.5" />
                          </Button>
                        </div>
                      )
                    })}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setGroups((gs) =>
                          gs.map((x, i) =>
                            i === gi
                              ? {
                                  ...x,
                                  conditions: [...x.conditions, emptyCondition()],
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      <Plus className="!size-3.5" /> Thêm điều kiện
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setGroups((gs) => [...gs, emptyGroup()])}
              >
                <Plus className="!size-3.5" /> Thêm nhóm điều kiện (VÀ)
              </Button>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBuilderOpen(false)}>
                Hủy
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="animate-spin" />}
                {editTarget ? 'Lưu & tính lại' : 'Tạo segment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Xem khách hàng trong segment */}
      <SegmentContactsDialog segment={previewTarget} onClose={() => setPreviewTarget(null)} />

      {/* Xóa */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa segment</DialogTitle>
            <DialogDescription>
              Xóa <span className="font-medium text-foreground">{deleteTarget?.name}</span>? Chiến dịch ZNS hoặc tự động
              hoá đang dùng segment này sẽ mất nguồn khách hàng.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={deleteSeg.isPending}>
              {deleteSeg.isPending && <Loader2 className="animate-spin" />}
              Xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SegmentContactsDialog({ segment, onClose }: { segment: Segment | null; onClose: () => void }) {
  const [page, setPage] = useState(1)
  const id = segment?.id ?? null
  const { data, isLoading, isError, error } = useSegmentContacts(id, PREVIEW_LIMIT, (page - 1) * PREVIEW_LIMIT)

  const columns: Column<SegmentContact>[] = [
    {
      key: 'name',
      header: 'Khách hàng',
      cell: (c) => (
        <Link to={`/customers/${c.id}`} className="flex items-center gap-2 hover:underline" onClick={onClose}>
          <Avatar className="h-7 w-7">
            {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt={c.fullName ?? ''} />}
            <AvatarFallback className="text-[10px]">{initials(c.fullName)}</AvatarFallback>
          </Avatar>
          <span className="truncate font-medium">{c.fullName || 'Chưa có tên'}</span>
        </Link>
      ),
    },
    {
      key: 'phone',
      header: 'SĐT',
      cell: (c) => <span className="tabular-nums">{c.phone || '—'}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      cell: (c) => <span className="text-muted-foreground">{c.email || '—'}</span>,
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
      cell: (c) => <span className="font-semibold">{c.leadScore}</span>,
    },
  ]

  return (
    <Dialog
      open={!!segment}
      onOpenChange={(o) => {
        if (!o) {
          setPage(1)
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Khách hàng trong “{segment?.name}”</DialogTitle>
          <DialogDescription>Danh sách được tính lại theo điều kiện hiện tại của segment.</DialogDescription>
        </DialogHeader>
        {isError ? (
          <QueryError error={error} what="khách hàng trong segment" />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={data?.contacts ?? []}
              loading={isLoading}
              rowKey={(c) => c.id}
              emptyTitle="Không có khách hàng nào thoả điều kiện"
            />
            {!!data && data.total > PREVIEW_LIMIT && (
              <Pagination page={page} limit={PREVIEW_LIMIT} total={data.total} onPageChange={setPage} />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
