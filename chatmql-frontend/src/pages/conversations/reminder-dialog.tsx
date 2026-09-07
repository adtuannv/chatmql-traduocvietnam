/**
 * reminder-dialog.tsx — Nhắc hẹn trong hội thoại (dùng được cả chat 1-1 và nhóm).
 *
 * API (zalo-thread-tools-routes.ts):
 *   GET    /conversations/:convId/reminders?page=1&count=20  → { success, reminders }
 *   POST   /conversations/:convId/reminders                  { title, emoji?, startTime?, repeat? }
 *   PUT    /conversations/:convId/reminders/:reminderId      { title, emoji?, startTime?, repeat? }
 *   DELETE /conversations/:convId/reminders/:reminderId
 *
 * `startTime` là epoch ms. `repeat`: 0 Không lặp / 1 Hàng ngày / 2 Hàng tuần / 3 Hàng tháng.
 *
 * Shape phần tử Zalo trả về KHÔNG chắc chắn (passthrough zca-js) → đọc phòng thủ
 * nhiều tên trường, thiếu dữ liệu thì bỏ qua dòng đó thay vì để crash.
 */
import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Loading, EmptyState, ErrorState } from '@/components/shared/feedback'
import { api, apiError } from '@/lib/api-client'

const PAGE = 1
const COUNT = 20

/** Chế độ lặp lại theo ReminderRepeatMode của zca-js. */
const REPEAT_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: 'Không lặp' },
  { value: '1', label: 'Hàng ngày' },
  { value: '2', label: 'Hàng tuần' },
  { value: '3', label: 'Hàng tháng' },
]

function repeatLabel(repeat: number | null): string | null {
  if (repeat == null || repeat === 0) return null
  return REPEAT_OPTIONS.find((o) => o.value === String(repeat))?.label ?? null
}

/** Phần tử nhắc hẹn là object passthrough từ zca-js — mọi field đều có thể vắng mặt. */
type RawReminder = Record<string, unknown>

interface Reminder {
  id: string
  title: string
  startTime: number | null
  emoji: string
  repeat: number | null
}

function pickString(obj: RawReminder, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return null
}

function pickNumber(obj: RawReminder, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return null
}

/** Chuẩn hoá 1 nhắc hẹn; trả null nếu thiếu id hoặc tiêu đề (dòng đó bị bỏ qua). */
function normalize(raw: unknown): Reminder | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as RawReminder

  const params = (obj.params && typeof obj.params === 'object'
    ? (obj.params as RawReminder)
    : {}) as RawReminder

  const id = pickString(obj, ['id', 'topicId', 'topic_id', 'reminderId', 'reminder_id'])
  if (!id) return null

  const title = pickString(obj, ['title']) ?? pickString(params, ['title'])
  if (!title) return null

  const startTime =
    pickNumber(obj, ['startTime', 'start_time']) ?? pickNumber(params, ['startTime', 'start_time'])

  return {
    id,
    title,
    // Một số bản trả epoch giây → quy về ms để định dạng đúng
    startTime: startTime == null ? null : startTime < 1e12 ? startTime * 1000 : startTime,
    emoji: pickString(obj, ['emoji']) ?? pickString(params, ['emoji']) ?? '',
    repeat: pickNumber(obj, ['repeat']) ?? pickNumber(params, ['repeat']),
  }
}

/** Định dạng thời điểm kiểu tiếng Việt: "14:30 · 05/09/2026". */
function formatDateTime(ms: number | null): string {
  if (ms == null) return 'Chưa đặt thời gian'
  const d = new Date(ms)
  if (isNaN(d.getTime())) return 'Chưa đặt thời gian'
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  const date = d.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return `${time} · ${date}`
}

/** epoch ms → giá trị cho <input type="datetime-local"> (giờ địa phương). */
function toLocalInput(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Giá trị datetime-local → epoch ms (chuỗi không có timezone = giờ địa phương). */
function fromLocalInput(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

interface Props {
  convId: string
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function ReminderDialog({ convId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [startAt, setStartAt] = useState('')
  const [repeat, setRepeat] = useState('0')
  const [emoji, setEmoji] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Reminder | null>(null)

  const queryKey = ['conversation-reminders', convId]

  const query = useQuery({
    queryKey,
    enabled: open && !!convId,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get<{ success?: boolean; reminders?: unknown }>(
        `/conversations/${convId}/reminders`,
        { params: { page: PAGE, count: COUNT } },
      )
      return Array.isArray(data?.reminders) ? (data.reminders as unknown[]) : []
    },
  })

  const reminders = useMemo(() => {
    const out: Reminder[] = []
    for (const raw of query.data ?? []) {
      const norm = normalize(raw)
      if (norm) out.push(norm)
    }
    return out
  }, [query.data])

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setStartAt('')
    setRepeat('0')
    setEmoji('')
  }

  // Mở lại popup → luôn bắt đầu bằng form trống
  useEffect(() => {
    if (open) resetForm()
  }, [open])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const startTime = fromLocalInput(startAt)
      const body: { title: string; emoji?: string; startTime?: number; repeat?: number } = {
        title: title.trim(),
        repeat: Number(repeat),
      }
      if (startTime != null) body.startTime = startTime
      if (emoji.trim()) body.emoji = emoji.trim()

      if (editingId) {
        await api.put(`/conversations/${convId}/reminders/${editingId}`, body)
      } else {
        await api.post(`/conversations/${convId}/reminders`, body)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey })
      toast.success(editingId ? 'Đã cập nhật nhắc hẹn' : 'Đã tạo nhắc hẹn')
      resetForm()
    },
    onError: (err) => toast.error(apiError(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: async (item: Reminder) => {
      await api.delete(`/conversations/${convId}/reminders/${item.id}`)
    },
    onSuccess: async (_data, item) => {
      await queryClient.invalidateQueries({ queryKey })
      toast.success('Đã xoá nhắc hẹn')
      if (editingId === item.id) resetForm()
      setConfirmDelete(null)
    },
    onError: (err) => toast.error(apiError(err)),
  })

  function startEdit(item: Reminder) {
    setEditingId(item.id)
    setTitle(item.title)
    setStartAt(toLocalInput(item.startTime))
    setRepeat(String(item.repeat ?? 0))
    setEmoji(item.emoji)
  }

  const notConnected = statusOf(query.error) === 503
  const pending = saveMutation.isPending
  const canSave = !!title.trim() && !pending

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nhắc hẹn</DialogTitle>
          </DialogHeader>

          {/* ── Danh sách nhắc hẹn hiện có ─────────────────────────── */}
          <div className="space-y-2">
            {notConnected ? (
              <ErrorState message="Tài khoản Zalo chưa kết nối" />
            ) : query.isError ? (
              <ErrorState message={apiError(query.error)} />
            ) : query.isPending ? (
              <Loading className="py-8" label="Đang tải nhắc hẹn..." />
            ) : reminders.length === 0 ? (
              <EmptyState icon={CalendarClock} title="Chưa có nhắc hẹn nào" />
            ) : (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                {reminders.map((item) => (
                  <li
                    key={item.id}
                    className="group flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2"
                  >
                    <span className="shrink-0 text-base leading-none">
                      {item.emoji || <CalendarClock className="h-4 w-4 text-muted-foreground" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDateTime(item.startTime)}
                        {repeatLabel(item.repeat) ? ` · ${repeatLabel(item.repeat)}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Sửa nhắc hẹn ${item.title}`}
                      onClick={() => startEdit(item)}
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Xoá nhắc hẹn ${item.title}`}
                      onClick={() => setConfirmDelete(item)}
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Form tạo / sửa ─────────────────────────────────────── */}
          <div className="space-y-3 border-t pt-4">
            <p className="text-sm font-medium">
              {editingId ? 'Sửa nhắc hẹn' : 'Tạo nhắc hẹn mới'}
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="reminder-title">
                Tiêu đề
              </label>
              <Input
                id="reminder-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nội dung nhắc hẹn"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="reminder-start">
                  Thời điểm
                </label>
                <Input
                  id="reminder-start"
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="reminder-repeat">
                  Lặp lại
                </label>
                <Select value={repeat} onValueChange={setRepeat}>
                  <SelectTrigger id="reminder-repeat" aria-label="Lặp lại">
                    <SelectValue placeholder="Không lặp" />
                  </SelectTrigger>
                  <SelectContent>
                    {REPEAT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="reminder-emoji">
                Biểu tượng (tuỳ chọn)
              </label>
              <Input
                id="reminder-emoji"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="vd: ⏰"
                className="w-24"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => (editingId ? resetForm() : onOpenChange(false))}
            >
              Huỷ
            </Button>
            <Button disabled={!canSave} onClick={() => saveMutation.mutate()}>
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Xác nhận xoá ───────────────────────────────────────────── */}
      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Xoá nhắc hẹn?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Nhắc hẹn <span className="font-medium text-foreground">{confirmDelete?.title}</span> sẽ
            bị xoá khỏi hội thoại. Không thể hoàn tác.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Huỷ
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete)}
            >
              Xoá
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
