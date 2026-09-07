import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, GitBranch, History, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DataTable, type Column } from '@/components/shared/data-table'
import { EmptyState, Loading } from '@/components/shared/feedback'
import { formatNumber } from '@/lib/utils'
import { stageBadgeVariant, stageLabel } from '@/hooks/use-contacts'
import { LIFECYCLE_STAGES, useLifecyclePipeline, useRecentLifecycleChanges, type CdpEvent } from '@/hooks/use-cdp'
import { QueryError, formatDateTime } from './cdp-shared'

interface LifecycleChangeProps {
  fromStage?: string | null
  toStage?: string | null
  reason?: string | null
}

export function LifecycleTab() {
  const pipelineQuery = useLifecyclePipeline()
  const changesQuery = useRecentLifecycleChanges(30)

  const { counts, total, unknown } = useMemo(() => {
    const map: Record<string, number> = {}
    let sum = 0
    let other = 0
    for (const row of pipelineQuery.data ?? []) {
      const stage = row.lifecycleStage ?? row.status
      const n = row._count?._all ?? 0
      sum += n
      if ((LIFECYCLE_STAGES as readonly string[]).includes(stage)) map[stage] = (map[stage] ?? 0) + n
      else other += n
    }
    return { counts: map, total: sum, unknown: other }
  }, [pipelineQuery.data])

  const maxCount = Math.max(1, ...LIFECYCLE_STAGES.map((s) => counts[s] ?? 0))

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
      key: 'change',
      header: 'Chuyển đổi',
      cell: (e) => {
        const p = (e.properties ?? {}) as LifecycleChangeProps
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {p.fromStage ? (
              <Badge variant={stageBadgeVariant(p.fromStage)}>{stageLabel(p.fromStage)}</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">(mới)</span>
            )}
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <Badge variant={stageBadgeVariant(p.toStage)}>{stageLabel(p.toStage)}</Badge>
          </div>
        )
      },
    },
    {
      key: 'reason',
      header: 'Lý do',
      cell: (e) => {
        const p = (e.properties ?? {}) as LifecycleChangeProps
        return <span className="text-muted-foreground">{p.reason || '—'}</span>
      },
    },
  ]

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Phễu vòng đời</h2>
          <p className="text-xs text-muted-foreground">Số khách hàng đang ở từng giai đoạn.</p>
        </div>
        {pipelineQuery.isLoading ? (
          <Loading label="Đang tải phễu..." />
        ) : pipelineQuery.isError ? (
          <QueryError error={pipelineQuery.error} what="phễu vòng đời" />
        ) : (
          <Card>
            <CardContent className="space-y-4 pt-5">
              <div className="flex flex-wrap items-baseline gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">{formatNumber(total)}</span>
                <span className="text-sm text-muted-foreground">khách hàng</span>
                {unknown > 0 && (
                  <span className="text-xs text-muted-foreground">
                    · {formatNumber(unknown)} chưa xác định giai đoạn
                  </span>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                {LIFECYCLE_STAGES.map((s, i) => {
                  const n = counts[s] ?? 0
                  const pct = total ? Math.round((n / total) * 100) : 0
                  return (
                    <div key={s} className="rounded-lg border bg-background p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={stageBadgeVariant(s)}>{stageLabel(s)}</Badge>
                        <span className="text-[10px] text-muted-foreground">#{i + 1}</span>
                      </div>
                      <p className="mt-2 text-2xl font-bold tabular-nums">{formatNumber(n)}</p>
                      <p className="text-xs text-muted-foreground">{pct}%</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.max(n ? 3 : 0, (n / maxCount) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Chuyển đổi gần đây</h2>
          <p className="text-xs text-muted-foreground">
            30 lần đổi giai đoạn mới nhất (ghi nhận qua sự kiện <code>lifecycle_change</code>).
          </p>
        </div>
        {changesQuery.isError ? (
          <QueryError error={changesQuery.error} what="lịch sử đổi giai đoạn" />
        ) : changesQuery.isLoading ? (
          <Loading label="Đang tải lịch sử..." />
        ) : !changesQuery.data?.events.length ? (
          <EmptyState
            icon={History}
            title="Chưa có chuyển đổi nào"
            description="Khi bạn đổi giai đoạn khách hàng (thủ công hoặc qua tự động hoá), lịch sử sẽ hiện ở đây."
          />
        ) : (
          <DataTable columns={columns} rows={changesQuery.data.events} rowKey={(e) => e.id} />
        )}
      </section>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" /> Đổi giai đoạn cho từng khách hàng tại trang chi tiết khách hàng.
      </p>
    </div>
  )
}
