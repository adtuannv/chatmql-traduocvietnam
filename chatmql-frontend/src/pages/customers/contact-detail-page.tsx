import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Brain,
  Building2,
  CalendarClock,
  Mail,
  Pencil,
  Phone,
  Sparkles,
  Trash2,
  Pin,
  PinOff,
  Plus,
} from 'lucide-react'
import dayjs from 'dayjs'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { Loading, ErrorState, EmptyState } from '@/components/shared/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Textarea, Separator } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { initials } from '@/lib/utils'
import { apiError } from '@/lib/api-client'
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  appointmentStatusVariant,
  INTENT_LABELS,
  intentBadgeVariant,
  LIFECYCLE_STAGES,
  SENTIMENT_LABELS,
  sentimentBadgeVariant,
  STAGE_LABELS,
  stageBadgeVariant,
  stageLabel,
  useAppointments,
  useContact,
  useCreateAppointment,
  useCreateNote,
  useDeleteAppointment,
  useDeleteContact,
  useDeleteNote,
  useNotes,
  useToggleNotePin,
  useUpdateAppointment,
  useUpdateContact,
  type Appointment,
  type ContactDetail,
  type ContactUpdateInput,
  type Note,
} from '@/hooks/use-contacts'

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, isLoading, isError } = useContact(id)
  const [editOpen, setEditOpen] = useState(false)
  const deleteContact = useDeleteContact()

  if (isLoading) return <Loading label="Đang tải khách hàng..." />
  if (isError || !data)
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState message="Không tìm thấy khách hàng." />
      </div>
    )

  const name = data.crmName || data.fullName || 'Chưa có tên'

  const onDelete = () => {
    if (!id) return
    if (!confirm('Xóa khách hàng này? Dữ liệu hội thoại vẫn được giữ lại.')) return
    deleteContact.mutate(id, {
      onSuccess: () => {
        toast.success('Đã xóa khách hàng')
        navigate('/customers')
      },
      onError: (e) => toast.error(apiError(e)),
    })
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeader
        title={name}
        description={data.company?.name || 'Chi tiết khách hàng'}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Chỉnh sửa
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={deleteContact.isPending}>
              <Trash2 className="h-4 w-4" /> Xóa
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <BasicInfoCard contact={data} />
          <AiInsightsCard contact={data} />
        </div>

        <div className="lg:col-span-2">
          <Tabs defaultValue="notes">
            <TabsList>
              <TabsTrigger value="notes">Ghi chú</TabsTrigger>
              <TabsTrigger value="appointments">Lịch hẹn</TabsTrigger>
            </TabsList>
            <TabsContent value="notes">
              <NotesTab contactId={data.id} />
            </TabsContent>
            <TabsContent value="appointments">
              <AppointmentsTab contactId={data.id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {editOpen && (
        <EditContactDialog contact={data} open={editOpen} onOpenChange={setEditOpen} />
      )}
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/customers"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Danh sách khách hàng
    </Link>
  )
}

// ── Thông tin cơ bản ─────────────────────────────────────────────────
function BasicInfoCard({ contact }: { contact: ContactDetail }) {
  const name = contact.crmName || contact.fullName || 'Chưa có tên'
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <Avatar className="mx-auto h-16 w-16">
          {contact.avatarUrl && <AvatarImage src={contact.avatarUrl} alt={name} />}
          <AvatarFallback className="text-lg">{initials(name)}</AvatarFallback>
        </Avatar>
        <CardTitle className="mt-2">{name}</CardTitle>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <Badge variant={stageBadgeVariant(contact.lifecycleStage)}>
            {stageLabel(contact.lifecycleStage)}
          </Badge>
          <Badge variant="outline">Điểm: {contact.leadScore}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <InfoRow icon={Phone} label="Số điện thoại" value={contact.phone} />
        <InfoRow icon={Mail} label="Email" value={contact.email} />
        <InfoRow icon={Building2} label="Công ty" value={contact.company?.name} />
        <InfoRow icon={Sparkles} label="Chức danh" value={contact.jobTitle} />
        <InfoRow icon={Sparkles} label="Nguồn" value={contact.source} />
        <InfoRow icon={Sparkles} label="Phụ trách" value={contact.assignedUser?.fullName} />
        <Separator />
        <div className="text-xs text-muted-foreground">
          Tạo lúc {dayjs(contact.createdAt).format('HH:mm DD/MM/YYYY')}
        </div>
        {contact.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {contact.tags.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone
  label: string
  value?: string | null
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="break-words font-medium">{value || '—'}</p>
      </div>
    </div>
  )
}

// ── AI insights ──────────────────────────────────────────────────────
function AiInsightsCard({ contact }: { contact: ContactDetail }) {
  const hasAi = contact.aiSummary || contact.aiSentimentLabel || contact.aiIntent
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" /> AI insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!hasAi ? (
          <p className="text-muted-foreground">Chưa có phân tích AI cho khách hàng này.</p>
        ) : (
          <>
            {contact.aiSummary && <p className="leading-relaxed">{contact.aiSummary}</p>}

            <div className="flex flex-wrap gap-2">
              {contact.aiSentimentLabel && (
                <Badge variant={sentimentBadgeVariant(contact.aiSentimentLabel)}>
                  Cảm xúc: {SENTIMENT_LABELS[contact.aiSentimentLabel] ?? contact.aiSentimentLabel}
                </Badge>
              )}
              {contact.aiIntent && (
                <Badge variant={intentBadgeVariant(contact.aiIntent)}>
                  Nhu cầu: {INTENT_LABELS[contact.aiIntent] ?? contact.aiIntent}
                </Badge>
              )}
            </div>

            {contact.aiSentimentReason && (
              <p className="text-xs text-muted-foreground">{contact.aiSentimentReason}</p>
            )}

            {contact.aiPainPoints?.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Điểm đau</p>
                <ul className="list-inside list-disc space-y-1">
                  {contact.aiPainPoints.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            {contact.aiAnalyzedAt && (
              <p className="text-xs text-muted-foreground">
                Phân tích lúc {dayjs(contact.aiAnalyzedAt).format('HH:mm DD/MM/YYYY')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Dialog chỉnh sửa ─────────────────────────────────────────────────
function EditContactDialog({
  contact,
  open,
  onOpenChange,
}: {
  contact: ContactDetail
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const update = useUpdateContact()
  const [form, setForm] = useState<ContactUpdateInput>({
    fullName: contact.fullName ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    jobTitle: contact.jobTitle ?? '',
    source: contact.source ?? '',
    lifecycleStage: contact.lifecycleStage,
    notes: contact.notes ?? '',
  })

  const set = (k: keyof ContactUpdateInput, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const onSubmit = () => {
    update.mutate(
      { id: contact.id, data: form },
      {
        onSuccess: () => {
          toast.success('Đã cập nhật khách hàng')
          onOpenChange(false)
        },
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chỉnh sửa khách hàng</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <Field label="Họ tên">
            <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Số điện thoại">
              <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="Email">
              <Input value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Chức danh">
              <Input value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
            </Field>
            <Field label="Nguồn">
              <Input value={form.source} onChange={(e) => set('source', e.target.value)} />
            </Field>
          </div>
          <Field label="Giai đoạn">
            <Select
              value={form.lifecycleStage}
              onValueChange={(v) => set('lifecycleStage', v)}
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
          </Field>
          <Field label="Ghi chú nội bộ">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={onSubmit} disabled={update.isPending}>
            {update.isPending ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

// ── Tab Ghi chú ──────────────────────────────────────────────────────
function NotesTab({ contactId }: { contactId: string }) {
  const { data, isLoading } = useNotes(contactId)
  const create = useCreateNote()
  const togglePin = useToggleNotePin(contactId)
  const del = useDeleteNote(contactId)
  const [content, setContent] = useState('')

  const onAdd = () => {
    if (!content.trim()) return
    create.mutate(
      { contactId, content },
      {
        onSuccess: () => {
          setContent('')
          toast.success('Đã thêm ghi chú')
        },
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Thêm ghi chú về khách hàng này..."
          />
          <div className="flex justify-end">
            <Button onClick={onAdd} disabled={create.isPending || !content.trim()}>
              <Plus className="h-4 w-4" /> Thêm ghi chú
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Loading />
      ) : !data?.notes.length ? (
        <EmptyState title="Chưa có ghi chú" description="Hãy thêm ghi chú đầu tiên." />
      ) : (
        <div className="space-y-3">
          {data.notes.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              onPin={() => togglePin.mutate(n.id)}
              onDelete={() => {
                if (confirm('Xóa ghi chú này?'))
                  del.mutate(n.id, {
                    onSuccess: () => toast.success('Đã xóa ghi chú'),
                    onError: (e) => toast.error(apiError(e)),
                  })
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteRow({
  note,
  onPin,
  onDelete,
}: {
  note: Note
  onPin: () => void
  onDelete: () => void
}) {
  return (
    <Card className={note.isPinned ? 'border-primary/40' : undefined}>
      <CardContent className="flex items-start justify-between gap-3 pt-6">
        <div className="min-w-0 space-y-1">
          <p className="whitespace-pre-wrap break-words text-sm">{note.content}</p>
          <p className="text-xs text-muted-foreground">
            {note.createdBy?.fullName || 'Ẩn danh'} ·{' '}
            {dayjs(note.createdAt).format('HH:mm DD/MM/YYYY')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onPin} title={note.isPinned ? 'Bỏ ghim' : 'Ghim'}>
            {note.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} title="Xóa">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Tab Lịch hẹn ─────────────────────────────────────────────────────
function AppointmentsTab({ contactId }: { contactId: string }) {
  const { data, isLoading } = useAppointments(contactId)
  const create = useCreateAppointment(contactId)
  const update = useUpdateAppointment(contactId)
  const del = useDeleteAppointment(contactId)

  const [date, setDate] = useState('')
  const [type, setType] = useState('meeting')
  const [notes, setNotes] = useState('')

  const onAdd = () => {
    if (!date) {
      toast.error('Vui lòng chọn thời gian hẹn')
      return
    }
    create.mutate(
      {
        contactId,
        appointmentDate: new Date(date).toISOString(),
        type,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          setDate('')
          setNotes('')
          setType('meeting')
          toast.success('Đã tạo lịch hẹn')
        },
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Thời gian">
              <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Loại">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(APPOINTMENT_TYPE_LABELS).map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Ghi chú">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nội dung buổi hẹn..." />
          </Field>
          <div className="flex justify-end">
            <Button onClick={onAdd} disabled={create.isPending}>
              <Plus className="h-4 w-4" /> Tạo lịch hẹn
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Loading />
      ) : !data?.appointments.length ? (
        <EmptyState title="Chưa có lịch hẹn" description="Tạo lịch hẹn đầu tiên với khách hàng." />
      ) : (
        <div className="space-y-3">
          {data.appointments.map((a) => (
            <AppointmentRow
              key={a.id}
              appt={a}
              onStatus={(status) => update.mutate({ id: a.id, data: { status } })}
              onDelete={() => {
                if (confirm('Xóa lịch hẹn này?'))
                  del.mutate(a.id, {
                    onSuccess: () => toast.success('Đã xóa lịch hẹn'),
                    onError: (e) => toast.error(apiError(e)),
                  })
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AppointmentRow({
  appt,
  onStatus,
  onDelete,
}: {
  appt: Appointment
  onStatus: (status: string) => void
  onDelete: () => void
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-6">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {dayjs(appt.appointmentDate).format('HH:mm DD/MM/YYYY')}
            </span>
            <Badge variant="outline">{APPOINTMENT_TYPE_LABELS[appt.type] ?? appt.type}</Badge>
            <Badge variant={appointmentStatusVariant(appt.status)}>
              {APPOINTMENT_STATUS_LABELS[appt.status] ?? appt.status}
            </Badge>
          </div>
          {appt.notes && <p className="whitespace-pre-wrap break-words text-sm">{appt.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select value={appt.status} onValueChange={onStatus}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(APPOINTMENT_STATUS_LABELS).map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={onDelete} title="Xóa">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
