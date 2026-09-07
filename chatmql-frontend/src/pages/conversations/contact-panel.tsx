/**
 * contact-panel.tsx — Hồ sơ khách hàng ở cột phải màn Hội thoại.
 *
 * Bố cục bám khối nghiệp vụ SaaS trong BRD §4.5, dựng bằng dữ liệu ĐANG CÓ:
 *  1. Nhận diện — tên (kèm icon mở hồ sơ), chức danh, nhiệt độ mua
 *     + các trường ghim: điện thoại · email · ngày sinh (sửa tại chỗ)
 *  2. Lịch hẹn  — danh sách lịch sắp tới, nút Đặt lịch ngay trong thẻ
 *  3. Ghi chú   — hiển thị lần lượt trong thẻ (ghim trước), nút Thêm
 *  4. Tín hiệu bán hàng — tín hiệu mua, bài toán, đối thủ (AI rút từ hội thoại)
 *  5. Tóm tắt AI
 *
 * Khối "Tài khoản dùng thử" (BRD §4.5.1) CHƯA dựng được: cần telemetry sản phẩm
 * (ADM-13), backend chưa có nguồn dữ liệu này.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Cake, CalendarClock, ExternalLink, Flame, Mail,
  Phone, Pin, Plus, Radar, Snowflake, Sparkles, StickyNote, Swords, TrendingUp,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/misc'
import { Separator, ScrollArea } from '@/components/ui/misc'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  useUpdateContact, useCreateNote, useCreateAppointment,
  useNotes, useAppointments, APPOINTMENT_TYPE_LABELS, APPOINTMENT_STATUS_LABELS,
  appointmentStatusVariant,
} from '@/hooks/use-contacts'
import { apiError } from '@/lib/api-client'
import { initials, cn } from '@/lib/utils'
import type { ConversationDetail } from '@/hooks/use-conversations'

/** `ai_intent` = nhiệt độ mua. Chỉ báo quan trọng nhất khi bán SaaS. */
const INTENT: Record<string, { label: string; icon: typeof Flame; cls: string }> = {
  hot: { label: 'Nóng — nên thúc chốt', icon: Flame, cls: 'bg-destructive/10 text-destructive' },
  warm: { label: 'Ấm — đang cân nhắc', icon: TrendingUp, cls: 'bg-warning/15 text-warning' },
  cold: { label: 'Nguội — cần hâm nóng', icon: Snowflake, cls: 'bg-muted text-muted-foreground' },
}

const SENTIMENT: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  positive: { label: 'Tích cực', variant: 'success' },
  neutral: { label: 'Trung lập', variant: 'secondary' },
  negative: { label: 'Tiêu cực', variant: 'destructive' },
}

/** Chuẩn hoá trường Json — backend trả mảng, nhưng có thể null/không phải mảng. */
function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
}

function formatDate(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Ngày + giờ:phút — dùng cho mốc thời gian ghi chú. */
function formatDateTime(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return `${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
}

export function ContactPanel({ conv }: { conv?: ConversationDetail }) {
  const contact = conv?.contact
  const [noteOpen, setNoteOpen] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)

  const updateContact = useUpdateContact()
  const createNote = useCreateNote()
  const createAppointment = useCreateAppointment(contact?.id ?? '')
  const { data: notesData } = useNotes(contact?.id)
  const { data: apptData } = useAppointments(contact?.id)

  if (!contact) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Hội thoại nhóm chưa gắn với khách hàng nào.
      </div>
    )
  }

  const name = contact.fullName || conv?.displayName || 'Không tên'
  const intent = contact.aiIntent ? INTENT[contact.aiIntent] : undefined
  const sentiment = contact.aiSentimentLabel ? SENTIMENT[contact.aiSentimentLabel] : undefined
  const signals = asList(contact.aiSignals)
  const painPoints = asList(contact.aiPainPoints)
  const competitors = asList(contact.aiCompetitors)
  // Lịch hẹn sắp tới: đã lên lịch + chưa qua ngày, gần nhất trước, tối đa 4.
  const todayStr = new Date().toISOString().slice(0, 10)
  const upcomingAppts = (apptData?.appointments ?? [])
    .filter((a) => a.status === 'scheduled' && a.appointmentDate.slice(0, 10) >= todayStr)
    .sort((a, b) =>
      (a.appointmentDate.slice(0, 10) + (a.appointmentTime ?? '')).localeCompare(
        b.appointmentDate.slice(0, 10) + (b.appointmentTime ?? ''),
      ))
    .slice(0, 4)

  // Ghi chú: ghim trước, còn lại mới nhất trước, tối đa 5 (xem hết ở Hồ sơ).
  const notes = [...(notesData?.notes ?? [])]
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)
  const totalNotes = notesData?.total ?? 0

  const handleBirthdayChange = async (value: string) => {
    try {
      await updateContact.mutateAsync({ id: contact.id, data: { birthday: value || null } })
      toast.success(value ? 'Đã lưu ngày sinh' : 'Đã xoá ngày sinh')
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const savePinnedField = async (field: 'phone' | 'email', value: string, label: string) => {
    try {
      await updateContact.mutateAsync({ id: contact.id, data: { [field]: value } })
      toast.success(`Đã lưu ${label.toLowerCase()}`)
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4">
          {/* ── 1. Nhận diện ─────────────────────────────────────── */}
          <div className="flex items-start gap-3">
            <Avatar className="h-12 w-12 shrink-0">
              {contact.avatarUrl && <AvatarImage src={contact.avatarUrl} alt={name} />}
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-semibold" title={name}>{name}</p>
                {/* Nút mở hồ sơ đầy đủ — chỉ icon, đặt cạnh tên */}
                <Link
                  to={`/customers/${contact.id}`}
                  title="Mở hồ sơ đầy đủ"
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {[contact.jobTitle, contact.company?.name].filter(Boolean).join(' · ') || 'Chưa có chức danh'}
              </p>
              {intent && (
                <span className={cn('mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', intent.cls)}>
                  <intent.icon className="h-3 w-3" />
                  {intent.label}
                </span>
              )}
            </div>
          </div>

          {/* ── 1b. Trường ghim ngay dưới tên: điện thoại · email · ngày sinh.
               SĐT/email sửa được tại chỗ; tin khách nhắn có SĐT/email cũng được
               backend tự bắt điền vào (chỉ khi trường trống). ── */}
          <div className="space-y-1.5 rounded-lg border p-3">
            <EditableRow
              icon={Phone} label="Điện thoại" value={contact.phone}
              placeholder="Nhập SĐT…" inputMode="tel"
              onSave={(v) => savePinnedField('phone', v, 'Số điện thoại')}
            />
            <EditableRow
              icon={Mail} label="Email" value={contact.email}
              placeholder="Nhập email…" inputMode="email"
              onSave={(v) => savePinnedField('email', v, 'Email')}
            />
            <div className="flex items-center gap-2">
              <Cake className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="w-[72px] shrink-0 text-[11px] text-muted-foreground">Ngày sinh</span>
              <input
                key={contact.id}
                type="date"
                defaultValue={contact.birthday?.slice(0, 10) ?? ''}
                onChange={(e) => handleBirthdayChange(e.target.value)}
                className="h-6 min-w-0 flex-1 rounded border bg-transparent px-1.5 text-xs text-foreground [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>
          </div>

          {/* ── 2. Lịch hẹn — nút đặt lịch nằm ngay trong thẻ ────── */}
          <section className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <CalendarClock className="h-3.5 w-3.5 text-primary" /> Lịch hẹn
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px]"
                onClick={() => setDemoOpen(true)}
              >
                <Plus className="h-3 w-3" /> Đặt lịch
              </Button>
            </div>
            {upcomingAppts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Chưa có lịch hẹn — bấm Đặt lịch để lên lịch demo / tư vấn.
              </p>
            ) : (
              upcomingAppts.map((a) => (
                <div key={a.id} className="rounded-md bg-muted/50 px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">
                      {formatDate(a.appointmentDate)}
                      {a.appointmentTime ? ` · ${a.appointmentTime}` : ''}
                    </span>
                    <Badge variant={appointmentStatusVariant(a.status)} className="shrink-0 text-[10px]">
                      {APPOINTMENT_TYPE_LABELS[a.type] ?? APPOINTMENT_STATUS_LABELS[a.status] ?? a.type}
                    </Badge>
                  </div>
                  {a.notes && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground" title={a.notes}>
                      {a.notes}
                    </p>
                  )}
                </div>
              ))
            )}
          </section>

          {/* ── 2c. Ghi chú — hiển thị lần lượt ngay trong thẻ ───── */}
          <section className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <StickyNote className="h-3.5 w-3.5 text-primary" /> Ghi chú
                {totalNotes > 0 && <span className="font-normal text-muted-foreground">({totalNotes})</span>}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px]"
                onClick={() => setNoteOpen(true)}
              >
                <Plus className="h-3 w-3" /> Thêm
              </Button>
            </div>
            {notes.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Chưa có ghi chú — bấm Thêm để lưu thông tin về khách.
              </p>
            ) : (
              notes.map((n) => (
                <div key={n.id} className="rounded-md bg-muted/50 px-2.5 py-1.5">
                  <p className="whitespace-pre-wrap text-xs leading-relaxed">
                    {n.isPinned && <Pin className="mr-1 inline h-3 w-3 text-primary" />}
                    {n.content}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {n.createdBy?.fullName ?? 'Không rõ'} · {formatDateTime(n.createdAt)}
                  </p>
                </div>
              ))
            )}
            {totalNotes > notes.length && (
              <Link
                to={`/customers/${contact.id}`}
                className="block text-right text-[11px] text-primary hover:underline"
              >
                Xem tất cả {totalNotes} ghi chú →
              </Link>
            )}
          </section>

          {/* ── 4. Tín hiệu bán hàng (chỉ hiện khi AI có rút được) ── */}
          {(signals.length > 0 || painPoints.length > 0 || competitors.length > 0) && (
            <section className="space-y-2.5 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <Radar className="h-3.5 w-3.5 text-primary" /> Tín hiệu bán hàng
              </p>
              <ChipList label="Tín hiệu mua" items={signals} cls="bg-success/10 text-success" />
              <ChipList label="Bài toán đang gặp" items={painPoints} cls="bg-warning/15 text-warning" />
              {competitors.length > 0 && (
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Swords className="h-3 w-3" /> Đối thủ đang cân nhắc
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {competitors.map((c) => (
                      <span key={c} className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-destructive/10 text-destructive">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── 6. Tóm tắt AI ────────────────────────────────────── */}
          {(contact.aiSummary || sentiment) && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Tóm tắt AI
                </p>
                {sentiment && (
                  <Badge variant={sentiment.variant} className="text-[11px]">
                    Cảm xúc: {sentiment.label}
                  </Badge>
                )}
                {contact.aiSummary && (
                  <p className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                    {contact.aiSummary}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <NoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        pending={createNote.isPending}
        onSubmit={async (content) => {
          await createNote.mutateAsync({ contactId: contact.id, content })
          toast.success('Đã lưu ghi chú')
        }}
      />
      <DemoDialog
        open={demoOpen}
        onOpenChange={setDemoOpen}
        pending={createAppointment.isPending}
        onSubmit={async (date, time, notes) => {
          await createAppointment.mutateAsync({
            contactId: contact.id,
            appointmentDate: date,
            appointmentTime: time || undefined,
            type: 'demo',
            notes: notes || undefined,
          })
          toast.success('Đã đặt lịch demo')
        }}
      />
    </>
  )
}

// ── Thành phần phụ ────────────────────────────────────────────────────

/**
 * Dòng thông tin ghim dưới tên, sửa được tại chỗ: gõ xong rời ô (hoặc Enter)
 * là lưu. `key={value}` để giá trị auto-bắt từ chat (realtime) đè vào ô khi
 * người dùng chưa gõ gì.
 */
function EditableRow({
  icon: Icon, label, value, placeholder, inputMode, onSave,
}: {
  icon: typeof Phone; label: string; value?: string | null
  placeholder: string; inputMode: 'tel' | 'email'
  onSave: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="w-[72px] shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <input
        key={value ?? ''}
        type="text"
        inputMode={inputMode}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (v !== (value ?? '')) onSave(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className="h-6 min-w-0 flex-1 rounded border bg-transparent px-1.5 text-xs text-foreground placeholder:text-muted-foreground/60"
      />
    </div>
  )
}

function ChipList({ label, items, cls }: { label: string; items: string[]; cls: string }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="mb-1 text-[11px] text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((it) => (
          <span key={it} className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', cls)}>{it}</span>
        ))}
      </div>
    </div>
  )
}

function NoteDialog({
  open, onOpenChange, pending, onSubmit,
}: { open: boolean; onOpenChange: (o: boolean) => void; pending: boolean; onSubmit: (c: string) => Promise<void> }) {
  const [content, setContent] = useState('')
  const save = async () => {
    if (!content.trim()) return
    try {
      await onSubmit(content.trim())
      setContent('')
      onOpenChange(false)
    } catch (e) {
      toast.error(apiError(e))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">Ghi chú về khách hàng</DialogTitle></DialogHeader>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Ví dụ: khách cần 30 user, đang dùng phần mềm X, muốn xem demo phân hệ kho…"
          className="min-h-[120px]"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button onClick={save} disabled={pending || !content.trim()}>Lưu ghi chú</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DemoDialog({
  open, onOpenChange, pending, onSubmit,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; pending: boolean
  onSubmit: (date: string, time: string, notes: string) => Promise<void>
}) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [notes, setNotes] = useState('')
  const save = async () => {
    if (!date) return
    try {
      await onSubmit(date, time, notes)
      setDate(''); setTime(''); setNotes('')
      onOpenChange(false)
    } catch (e) {
      toast.error(apiError(e))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">Đặt lịch demo / tư vấn</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Ngày</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Giờ</label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Nội dung</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Demo phân hệ nào, ai tham dự…"
              className="mt-1 min-h-[80px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button onClick={save} disabled={pending || !date}>Đặt lịch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
