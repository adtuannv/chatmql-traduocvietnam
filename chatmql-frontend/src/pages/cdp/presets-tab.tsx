import { useEffect, useMemo, useState } from 'react'
import { Check, Download, Eye, Loader2, Package, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/misc'
import { EmptyState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import {
  FIELD_TYPE_LABELS,
  fieldTypeVariant,
  useApplyPreset,
  usePresetDetail,
  usePresetStatus,
  usePresets,
  useUninstallPreset,
  type PresetStatus,
  type PresetSummary,
} from '@/hooks/use-cdp'
import { QueryError } from './cdp-shared'

function statusBadge(p: PresetSummary, st?: PresetStatus) {
  if (!st) return <Badge variant="secondary">Chưa cài</Badge>
  if (st.installed) return <Badge variant="success">Đã cài</Badge>
  const total = p.counts.properties + p.counts.events
  const done = st.propsInstalled + st.eventsInstalled
  if (done > 0)
    return (
      <Badge variant="warning">
        Một phần · {done}/{total}
      </Badge>
    )
  return <Badge variant="secondary">Chưa cài</Badge>
}

export function PresetsTab() {
  const presetsQuery = usePresets()
  const statusQuery = usePresetStatus()
  const apply = useApplyPreset()
  const uninstall = useUninstallPreset()

  const [detailKey, setDetailKey] = useState<string | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<PresetSummary | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const status = statusQuery.data?.status ?? {}
  const presets = presetsQuery.data?.presets ?? []

  function applyAll(p: PresetSummary) {
    setBusyKey(p.key)
    apply.mutate(
      { key: p.key },
      {
        onSuccess: (r) =>
          toast.success(
            `Đã cài “${p.name}”: ${r.created.props} thuộc tính, ${r.created.events} sự kiện, ${r.created.automations} tự động hoá` +
              (r.skipped.props + r.skipped.events > 0
                ? ` (bỏ qua ${r.skipped.props + r.skipped.events} mục đã có)`
                : ''),
          ),
        onError: (err) => toast.error(apiError(err)),
        onSettled: () => setBusyKey(null),
      },
    )
  }

  async function onUninstall() {
    if (!uninstallTarget) return
    try {
      const r = await uninstall.mutateAsync(uninstallTarget.key)
      toast.success(
        `Đã gỡ “${uninstallTarget.name}”: ${r.deleted.props} thuộc tính, ${r.deleted.events} sự kiện, ${r.deleted.automations} tự động hoá`,
      )
      setUninstallTarget(null)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  if (presetsQuery.isLoading) return <Loading label="Đang tải gói preset..." />
  if (presetsQuery.isError) return <QueryError error={presetsQuery.error} what="gói preset" />

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Gói cấu hình mẫu theo ngành: cài một lần để có sẵn thuộc tính, sự kiện và luồng tự động hoá.
      </p>
      {statusQuery.isError && !statusQuery.isLoading && (
        <p className="text-xs text-warning">Không lấy được trạng thái cài đặt — vẫn có thể cài/gỡ.</p>
      )}

      {presets.length === 0 ? (
        <EmptyState icon={Package} title="Chưa có gói preset nào" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {presets.map((p) => {
            const st = status[p.key]
            const busy = busyKey === p.key && apply.isPending
            return (
              <Card key={p.key} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 pt-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-2xl">
                      {p.icon || <Package className="h-5 w-5 text-primary" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{p.name}</p>
                        {statusBadge(p, st)}
                      </div>
                      <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{p.description}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <Badge variant="outline">{p.counts.properties} thuộc tính</Badge>
                    <Badge variant="outline">{p.counts.events} sự kiện</Badge>
                    <Badge variant="outline">{p.counts.automations} tự động hoá</Badge>
                    <Badge variant="secondary" className="font-normal">
                      Nhóm: {p.groupName}
                    </Badge>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
                    <Button variant="outline" size="sm" onClick={() => setDetailKey(p.key)}>
                      <Eye className="!size-3.5" /> Chi tiết
                    </Button>
                    {st?.installed ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setUninstallTarget(p)}
                      >
                        <Trash2 className="!size-3.5" /> Gỡ
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => applyAll(p)}>
                          {busy ? <Loader2 className="!size-3.5 animate-spin" /> : <Download className="!size-3.5" />}
                          Cài đặt
                        </Button>
                        {st && st.propsInstalled + st.eventsInstalled > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setUninstallTarget(p)}
                          >
                            <Trash2 className="!size-3.5" /> Gỡ
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <PresetDetailDialog
        presetKey={detailKey}
        summary={presets.find((p) => p.key === detailKey) ?? null}
        status={detailKey ? status[detailKey] : undefined}
        onClose={() => setDetailKey(null)}
      />

      <Dialog open={!!uninstallTarget} onOpenChange={(o) => !o && setUninstallTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Gỡ gói preset</DialogTitle>
            <DialogDescription>
              Gỡ <span className="font-medium text-foreground">{uninstallTarget?.name}</span> sẽ xóa các thuộc tính (kèm
              giá trị đã nhập), định nghĩa sự kiện và luồng tự động hoá cùng tên do gói này tạo. Không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUninstallTarget(null)}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={onUninstall} disabled={uninstall.isPending}>
              {uninstall.isPending && <Loader2 className="animate-spin" />}
              Gỡ gói
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PresetDetailDialog({
  presetKey,
  summary,
  status,
  onClose,
}: {
  presetKey: string | null
  summary: PresetSummary | null
  status?: PresetStatus
  onClose: () => void
}) {
  const { data, isLoading, isError, error } = usePresetDetail(presetKey)
  const apply = useApplyPreset()
  const preset = data?.preset

  const [props, setProps] = useState<Set<string>>(new Set())
  const [events, setEvents] = useState<Set<string>>(new Set())
  const [autos, setAutos] = useState<Set<string>>(new Set())

  // Mặc định chọn tất cả khi mở/đổi preset
  useEffect(() => {
    if (!preset) return
    setProps(new Set(preset.properties.map((p) => p.fieldKey)))
    setEvents(new Set(preset.events.map((e) => e.eventName)))
    setAutos(new Set(preset.automations.map((a) => a.name)))
  }, [preset])

  const selectedCount = props.size + events.size + autos.size
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setter(next)
  }

  const canApply = useMemo(() => selectedCount > 0 && !apply.isPending, [selectedCount, apply.isPending])

  function onApply() {
    if (!preset) return
    apply.mutate(
      {
        key: preset.key,
        selectedProperties: [...props],
        selectedEvents: [...events],
        selectedAutomations: [...autos],
      },
      {
        onSuccess: (r) => {
          toast.success(
            `Đã cài: ${r.created.props} thuộc tính, ${r.created.events} sự kiện, ${r.created.automations} tự động hoá`,
          )
          onClose()
        },
        onError: (err) => toast.error(apiError(err)),
      },
    )
  }

  return (
    <Dialog open={!!presetKey} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {summary?.icon && <span className="text-xl">{summary.icon}</span>}
            {summary?.name ?? 'Chi tiết gói'}
          </DialogTitle>
          <DialogDescription>{summary?.description}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <QueryError error={error} what="chi tiết preset" />
        ) : preset ? (
          <div className="space-y-5">
            <Section title={`Thuộc tính (${preset.properties.length})`}>
              {preset.properties.map((p) => (
                <label
                  key={p.fieldKey}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={props.has(p.fieldKey)}
                    onCheckedChange={() => toggle(props, setProps, p.fieldKey)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{p.name}</span>
                      <code className="text-xs text-muted-foreground">{p.fieldKey}</code>
                      <Badge variant={fieldTypeVariant(p.fieldType)}>
                        {FIELD_TYPE_LABELS[p.fieldType] ?? p.fieldType}
                      </Badge>
                    </div>
                    {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                  </div>
                </label>
              ))}
            </Section>

            <Section title={`Sự kiện (${preset.events.length})`}>
              {preset.events.map((e) => (
                <label
                  key={e.eventName}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={events.has(e.eventName)}
                    onCheckedChange={() => toggle(events, setEvents, e.eventName)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{e.displayName}</span>
                      <code className="text-xs text-muted-foreground">{e.eventName}</code>
                    </div>
                    {e.description && <p className="text-xs text-muted-foreground">{e.description}</p>}
                  </div>
                </label>
              ))}
            </Section>

            <Section title={`Tự động hoá (${preset.automations.length})`}>
              {preset.automations.map((a) => (
                <label
                  key={a.name}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={autos.has(a.name)}
                    onCheckedChange={() => toggle(autos, setAutos, a.name)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{a.name}</span>
                      <Badge variant="outline" className="font-normal">
                        khi: {a.trigger}
                      </Badge>
                    </div>
                    {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
                  </div>
                </label>
              ))}
            </Section>

            {status && (status.propsInstalled > 0 || status.eventsInstalled > 0) && (
              <p className="text-xs text-muted-foreground">
                Đã có {status.propsInstalled} thuộc tính, {status.eventsInstalled} sự kiện của gói này — mục trùng sẽ
                được bỏ qua khi cài.
              </p>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button onClick={onApply} disabled={!canApply || !preset}>
            {apply.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            Cài {selectedCount} mục đã chọn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="rounded-lg border">{children}</div>
    </div>
  )
}
