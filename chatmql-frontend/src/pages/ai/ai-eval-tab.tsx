/**
 * ai-eval-tab.tsx — Tab "Kiểm định": bộ câu hỏi vàng + lịch sử chạy.
 *
 * Vì sao tồn tại: sửa tài liệu logic / kịch bản / model xong, không ai biết các
 * câu cũ còn được trả lời đúng không. Tab này giữ vài chục câu hỏi thật kèm
 * tiêu chí chấm; một nút chạy toàn bộ qua đường MÔ PHỎNG (không gửi gì ra
 * khách) rồi LLM chấm đạt/trượt từng câu.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { FlaskConical, Loader2, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch, Textarea } from '@/components/ui/misc'
import { EmptyState, ErrorState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { FEATURES } from '@/lib/features'
import { useAiBots } from '@/hooks/use-ai'
import {
  EVAL_STATUS_LABELS, EVAL_VERDICT_LABELS, evalVerdictVariant,
  useCreateEvalCase, useDeleteEvalCase, useEvalCases, useEvalRunDetail, useEvalRuns,
  useStartEvalRun, useUpdateEvalCase,
  type EvalCase, type EvalRun,
} from '@/hooks/use-ai-eval'

const NO_BOT = '__none__'

function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '—'
    : `${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
}

export function AiEvalTab({ canEdit }: { canEdit: boolean }) {
  const casesQ = useEvalCases()
  const runsQ = useEvalRuns()
  const start = useStartEvalRun()
  const del = useDeleteEvalCase()

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<EvalCase | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const cases = casesQ.data?.cases ?? []
  const runs = runsQ.data?.runs ?? []
  const running = runs.some((r) => r.status === 'running')
  const enabledCount = cases.filter((c) => c.enabled).length

  const handleRun = () => {
    start.mutate(
      {},
      {
        onSuccess: () => toast.success('Đã bắt đầu chạy kiểm định — kết quả cập nhật dần bên dưới'),
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Bộ câu hỏi vàng lấy từ hội thoại thật. Chạy sau mỗi lần sửa tài liệu logic, kịch bản hoặc đổi
            model để chắc chắn không làm hỏng câu trả lời cũ.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Mỗi câu tốn 2 lời gọi AI (sinh trả lời + chấm điểm). Toàn bộ chạy trong sandbox mô phỏng —
            không gửi gì ra khách.
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => { setEditing(null); setEditorOpen(true) }}>
              <Plus /> Thêm câu hỏi
            </Button>
            <Button onClick={handleRun} disabled={running || start.isPending || enabledCount === 0}>
              {running ? <Loader2 className="animate-spin" /> : <Play />}
              {running ? 'Đang chạy…' : `Chạy toàn bộ (${enabledCount} câu)`}
            </Button>
          </div>
        )}
      </div>

      {/* ── Danh sách câu hỏi ── */}
      {casesQ.isLoading ? (
        <Loading />
      ) : casesQ.isError ? (
        <ErrorState message={apiError(casesQ.error)} />
      ) : cases.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="Chưa có câu hỏi kiểm định nào"
          description="Thêm những câu khách hỏi thường xuyên kèm tiêu chí một câu trả lời đúng phải đạt."
        />
      ) : (
        <div className="space-y-2">
          {cases.map((c) => (
            <div key={c.id} className="flex items-start gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{c.name}</span>
                  {!c.enabled && <Badge variant="secondary" className="text-[10px]">Tạm tắt</Badge>}
                  {c.botId && <Badge variant="outline" className="text-[10px]">Agent riêng</Badge>}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground" title={c.question}>
                  Hỏi: {c.question}
                </p>
                <p className="truncate text-xs text-muted-foreground" title={c.criteria}>
                  Chấm: {c.criteria}
                </p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    aria-label="Sửa câu hỏi"
                    onClick={() => { setEditing(c); setEditorOpen(true) }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                    aria-label="Xoá câu hỏi"
                    onClick={() =>
                      del.mutate(c.id, {
                        onSuccess: () => toast.success('Đã xoá câu hỏi'),
                        onError: (e) => toast.error(apiError(e)),
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Lịch sử chạy ── */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Lịch sử kiểm định
        </p>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa chạy lần nào.</p>
        ) : (
          <div className="space-y-1.5">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} onOpen={() => setDetailId(r.id)} />
            ))}
          </div>
        )}
      </div>

      <CaseEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
      />
      <RunDetailDialog runId={detailId} onClose={() => setDetailId(null)} />
    </div>
  )
}

function RunRow({ run, onOpen }: { run: EvalRun; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
    >
      <span className="text-xs text-muted-foreground">{fmtTime(run.startedAt)}</span>
      <Badge
        variant={run.status === 'done' ? 'success' : run.status === 'failed' ? 'destructive' : 'warning'}
        className="text-[10px]"
      >
        {run.status === 'running' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {EVAL_STATUS_LABELS[run.status]}
      </Badge>
      <span className="tabular-nums">
        {run.total} câu · <span className="text-success">{run.passed} đạt</span> ·{' '}
        <span className="text-destructive">{run.failed} trượt</span>
        {run.errored > 0 && <> · <span className="text-warning">{run.errored} lỗi</span></>}
      </span>
      {run.trigger === 'proposal' && <Badge variant="outline" className="text-[10px]">Theo đề xuất</Badge>}
      {run.model && <span className="text-xs text-muted-foreground">{run.model}</span>}
      {run.note && (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={run.note}>
          {run.note}
        </span>
      )}
    </button>
  )
}

function CaseEditorDialog({
  open, onOpenChange, editing,
}: { open: boolean; onOpenChange: (o: boolean) => void; editing: EvalCase | null }) {
  const create = useCreateEvalCase()
  const update = useUpdateEvalCase()
  const botsQ = useAiBots()

  // key trên Dialog remount form theo case đang sửa — tránh bẫy "dialog giữ ảnh chụp prop cũ".
  const [name, setName] = useState(editing?.name ?? '')
  const [question, setQuestion] = useState(editing?.question ?? '')
  const [criteria, setCriteria] = useState(editing?.criteria ?? '')
  const [conversationId, setConversationId] = useState(editing?.conversationId ?? '')
  const [botId, setBotId] = useState(editing?.botId ?? NO_BOT)
  const [enabled, setEnabled] = useState(editing?.enabled ?? true)

  const pending = create.isPending || update.isPending

  const save = () => {
    const input = {
      name: name.trim(),
      question: question.trim(),
      criteria: criteria.trim(),
      conversationId: conversationId.trim() || null,
      botId: botId === NO_BOT ? null : botId,
      enabled,
    }
    const done = {
      onSuccess: () => { toast.success('Đã lưu câu hỏi kiểm định'); onOpenChange(false) },
      onError: (e: unknown) => toast.error(apiError(e)),
    }
    if (editing) update.mutate({ id: editing.id, ...input }, done)
    else create.mutate(input, done)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} key={editing?.id ?? 'new'}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Sửa câu hỏi kiểm định' : 'Thêm câu hỏi kiểm định'}</DialogTitle>
          <DialogDescription>
            Lấy câu khách hỏi thật, ghi rõ một câu trả lời đúng phải đạt những gì.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Tên (để nhận ra trong kết quả)</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Hỏi giá Trà Đinh Ngọc" className="mt-1" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Câu hỏi của khách</label>
            <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Trà Đinh Ngọc hộp 100g giá bao nhiêu vậy shop?" className="mt-1 min-h-[64px]" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Tiêu chí chấm (một câu trả lời đúng phải…)</label>
            <Textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="Nêu đúng giá 300.000đ/hộp thiếc 100g, không bịa khuyến mãi, xưng em và mời chốt đơn." className="mt-1 min-h-[64px]" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Hội thoại ngữ cảnh (tuỳ chọn)</label>
            <Input value={conversationId ?? ''} onChange={(e) => setConversationId(e.target.value)} placeholder="Dán id hội thoại từ URL màn Hội thoại (/conversations/<id>)" className="mt-1" />
          </div>
          {FEATURES.AI_BOTS && (
            <div>
              <label className="text-xs text-muted-foreground">Agent trả lời (tuỳ chọn)</label>
              <Select value={botId ?? NO_BOT} onValueChange={setBotId}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_BOT}>Theo kênh / cấu hình chung</SelectItem>
                  {(botsQ.data?.bots ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={enabled} onCheckedChange={setEnabled} /> Đưa vào lượt chạy
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button onClick={save} disabled={pending || !name.trim() || !question.trim() || !criteria.trim()}>
            {pending ? 'Đang lưu…' : 'Lưu câu hỏi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RunDetailDialog({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const detailQ = useEvalRunDetail(runId)
  const run = detailQ.data?.run
  const results = detailQ.data?.results ?? []

  return (
    <Dialog open={!!runId} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Kết quả kiểm định</DialogTitle>
          <DialogDescription>
            {run
              ? `${fmtTime(run.startedAt)} · ${run.total} câu · ${run.passed} đạt · ${run.failed} trượt${run.errored ? ` · ${run.errored} lỗi` : ''}${run.model ? ` · ${run.model}` : ''}`
              : 'Đang tải…'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {detailQ.isLoading ? (
            <Loading />
          ) : run?.note && results.length === 0 ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{run.note}</p>
          ) : (
            results.map((r) => (
              <div key={r.id} className="rounded-lg border p-3 text-sm">
                <div className="mb-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.caseName}</span>
                  <Badge variant={evalVerdictVariant(r.verdict)} className="shrink-0 text-[10px]">
                    {EVAL_VERDICT_LABELS[r.verdict]}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Hỏi: {r.question}</p>
                {r.reply && (
                  <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-xs leading-relaxed">
                    {r.reply}
                  </p>
                )}
                <p className="mt-1.5 text-xs">
                  <span className="text-muted-foreground">Nhận xét chấm:</span> {r.reason}
                </p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
