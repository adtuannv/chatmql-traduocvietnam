/**
 * ai-schedule-card.tsx — Card "Lịch trình tự động theo khung giờ".
 *
 * Port từ `inject-schedule-ui.js`: GET/PUT /ai/schedule. Ban ngày (trong giờ
 * làm việc) nhân viên trực, AI gợi ý nháp; ngoài giờ AI tự trả lời.
 * Chỉ owner/admin được lưu (backend chặn 403).
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Clock, Loader2, Moon, Save, Sun } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loading, ErrorState } from '@/components/shared/feedback'
import { api, apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

export type AiScheduleMode = 'manual' | 'suggest' | 'auto'

export interface AiScheduleConfig {
  enabled: boolean
  startHour: number
  endHour: number
  daytimeMode: AiScheduleMode
  nighttimeMode: AiScheduleMode
  timezone: string
}

export interface AiScheduleResponse {
  schedule: AiScheduleConfig
  isAfterHours: boolean
  currentServerTime?: string
}

export const SCHEDULE_MODE_LABELS: Record<AiScheduleMode, string> = {
  manual: 'Thủ công',
  suggest: 'Gợi ý',
  auto: 'Tự động',
}

const MODE_HINTS: Record<AiScheduleMode, string> = {
  manual: 'Tắt AI — nhân viên tự soạn và gửi',
  suggest: 'AI soạn nháp, nhân viên duyệt rồi gửi',
  auto: 'AI tự trả lời khách ngay lập tức',
}

const MODES: AiScheduleMode[] = ['manual', 'suggest', 'auto']
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const pad = (h: number) => `${String(h).padStart(2, '0')}:00`

export const aiScheduleKey = ['ai', 'schedule'] as const

function useAiSchedule() {
  return useQuery<AiScheduleResponse>({
    queryKey: aiScheduleKey,
    queryFn: async () => (await api.get<AiScheduleResponse>('/ai/schedule')).data,
  })
}

function useSaveAiSchedule() {
  const qc = useQueryClient()
  return useMutation<AiScheduleResponse, unknown, Partial<AiScheduleConfig>>({
    mutationFn: async (body) => (await api.put<AiScheduleResponse>('/ai/schedule', body)).data,
    onSuccess: (data) => {
      qc.setQueryData(aiScheduleKey, data)
      // Cấu hình AI chung có trường isAfterHours — cho khớp ngay.
      qc.invalidateQueries({ queryKey: ['ai', 'config'] })
    },
  })
}

export function AiScheduleCard() {
  const role = useAuthStore((s) => s.user?.role)
  const canEdit = role === 'owner' || role === 'admin'

  const { data, isLoading, isError, error } = useAiSchedule()
  const save = useSaveAiSchedule()

  const [enabled, setEnabled] = useState(true)
  const [startHour, setStartHour] = useState(8)
  const [endHour, setEndHour] = useState(18)
  const [daytimeMode, setDaytimeMode] = useState<AiScheduleMode>('suggest')
  const [nighttimeMode, setNighttimeMode] = useState<AiScheduleMode>('auto')

  // Đổ dữ liệu server vào form mỗi khi query có bản mới.
  useEffect(() => {
    if (!data?.schedule) return
    setEnabled(data.schedule.enabled ?? true)
    setStartHour(data.schedule.startHour ?? 8)
    setEndHour(data.schedule.endHour ?? 18)
    setDaytimeMode(data.schedule.daytimeMode ?? 'suggest')
    setNighttimeMode(data.schedule.nighttimeMode ?? 'auto')
  }, [data])

  const isAfterHours = data?.isAfterHours ?? false

  const dirty =
    !!data?.schedule &&
    (enabled !== data.schedule.enabled ||
      startHour !== data.schedule.startHour ||
      endHour !== data.schedule.endHour ||
      daytimeMode !== data.schedule.daytimeMode ||
      nighttimeMode !== data.schedule.nighttimeMode)

  const handleSave = () => {
    save.mutate(
      { enabled, startHour, endHour, daytimeMode, nighttimeMode },
      {
        onSuccess: () => toast.success('Đã lưu lịch trình tự động theo khung giờ'),
        onError: (err) => toast.error(apiError(err)),
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" /> Lịch trình tự động theo khung giờ
            </CardTitle>
            <CardDescription>
              Tự động chuyển giữa nhân viên trực (trong giờ làm việc) và AI tự trả lời (ngoài giờ).
              Múi giờ {data?.schedule?.timezone || 'Asia/Ho_Chi_Minh'}.
            </CardDescription>
          </div>
          {data && (
            <Badge variant={isAfterHours ? 'warning' : 'success'} className="gap-1">
              {isAfterHours ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
              {isAfterHours ? 'Đang ngoài giờ' : 'Đang trong giờ làm việc'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Loading label="Đang tải lịch trình..." />
        ) : isError ? (
          <ErrorState message={apiError(error)} />
        ) : (
          <>
            <div
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 text-sm',
                isAfterHours ? 'border-warning/40 bg-warning/10' : 'border-primary/30 bg-primary/5',
              )}
            >
              {isAfterHours ? (
                <Moon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              ) : (
                <Sun className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              )}
              <div>
                <p className="font-medium">
                  {isAfterHours
                    ? `Hiện tại: ngoài giờ làm việc — chế độ ${SCHEDULE_MODE_LABELS[nighttimeMode]}`
                    : `Hiện tại: trong giờ làm việc (${pad(startHour)} – ${pad(endHour)}) — chế độ ${SCHEDULE_MODE_LABELS[daytimeMode]}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {enabled
                    ? MODE_HINTS[isAfterHours ? nighttimeMode : daytimeMode]
                    : 'Lịch trình đang tắt — dùng chế độ AI mặc định của hệ thống.'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Bật điều khiển theo khung giờ</p>
                <p className="text-xs text-muted-foreground">
                  Tự chuyển chế độ AI theo giờ làm việc mỗi ngày.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
            </div>

            <div className={cn('grid gap-4 lg:grid-cols-2', !enabled && 'opacity-60')}>
              <div className="space-y-3 rounded-lg border p-4">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Sun className="h-4 w-4 text-warning" /> Giờ làm việc (nhân viên trực)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Từ</Label>
                    <Select
                      value={String(startHour)}
                      onValueChange={(v) => setStartHour(Number(v))}
                      disabled={!canEdit || !enabled}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HOURS.map((h) => (
                          <SelectItem key={h} value={String(h)}>{pad(h)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Đến</Label>
                    <Select
                      value={String(endHour)}
                      onValueChange={(v) => setEndHour(Number(v))}
                      disabled={!canEdit || !enabled}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HOURS.map((h) => (
                          <SelectItem key={h} value={String(h)}>{pad(h)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Chế độ ban ngày</Label>
                  <Select
                    value={daytimeMode}
                    onValueChange={(v) => setDaytimeMode(v as AiScheduleMode)}
                    disabled={!canEdit || !enabled}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODES.map((m) => (
                        <SelectItem key={m} value={m}>{SCHEDULE_MODE_LABELS[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{MODE_HINTS[daytimeMode]}</p>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Moon className="h-4 w-4 text-primary" /> Ngoài giờ
                </p>
                <p className="text-xs text-muted-foreground">
                  Từ {pad(endHour)} đến {pad(startHour)} hôm sau.
                </p>
                <div className="space-y-1.5">
                  <Label>Chế độ ngoài giờ</Label>
                  <Select
                    value={nighttimeMode}
                    onValueChange={(v) => setNighttimeMode(v as AiScheduleMode)}
                    disabled={!canEdit || !enabled}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODES.map((m) => (
                        <SelectItem key={m} value={m}>{SCHEDULE_MODE_LABELS[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{MODE_HINTS[nighttimeMode]}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              {!canEdit && (
                <span className="text-xs text-muted-foreground">Chỉ chủ tài khoản / quản trị viên được chỉnh.</span>
              )}
              <Button onClick={handleSave} disabled={!canEdit || save.isPending || !dirty}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                Lưu lịch trình
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
