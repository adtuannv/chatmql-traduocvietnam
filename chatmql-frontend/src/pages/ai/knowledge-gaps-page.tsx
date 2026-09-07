/**
 * KnowledgeGapsPage — Lỗ hổng kiến thức của AI (route mong muốn: /ai/knowledge-gaps).
 * Danh sách các câu hỏi AI không đủ dữ kiện để trả lời. Owner/admin xử lý:
 *  - Giải quyết (resolve): nhập nội dung → tạo tri thức.
 *  - Bỏ qua (dismiss).
 */
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CircleHelp, Check, X, BookOpenCheck } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable, type Column } from '@/components/shared/data-table'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/misc'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { apiError } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import {
  aiKeys, useKnowledgeGaps, dismissGap, resolveGap,
  type KnowledgeGap, type GapStatus,
} from '@/hooks/use-ai'

const STATUS_LABEL: Record<GapStatus, string> = {
  open: 'Đang mở',
  resolved: 'Đã xử lý',
  dismissed: 'Đã bỏ qua',
}

function statusBadge(s: GapStatus) {
  if (s === 'resolved') return <Badge variant="success">{STATUS_LABEL[s]}</Badge>
  if (s === 'dismissed') return <Badge variant="secondary">{STATUS_LABEL[s]}</Badge>
  return <Badge variant="warning">{STATUS_LABEL[s]}</Badge>
}

export function KnowledgeGapsPage() {
  const role = useAuthStore((s) => s.user?.role)
  const canEdit = role === 'owner' || role === 'admin'
  const qc = useQueryClient()

  const [status, setStatus] = useState<GapStatus>('open')
  const { data, isLoading, isError } = useKnowledgeGaps(status)

  const [resolving, setResolving] = useState<KnowledgeGap | null>(null)
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const total = data?.total ?? 0

  function openResolve(gap: KnowledgeGap) {
    setResolving(gap)
    setTitle(gap.question.slice(0, 120))
    setContent(gap.suggestion ?? '')
  }

  async function handleResolve() {
    if (!resolving) return
    if (!content.trim()) {
      toast.error('Nội dung là bắt buộc')
      return
    }
    setBusy(true)
    try {
      await resolveGap(resolving.id, content.trim(), title.trim() || undefined)
      await qc.invalidateQueries({ queryKey: aiKeys.knowledgeGaps(status) })
      toast.success('Đã tạo tri thức từ lỗ hổng này')
      setResolving(null)
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDismiss(gap: KnowledgeGap) {
    setBusy(true)
    try {
      await dismissGap(gap.id)
      await qc.invalidateQueries({ queryKey: aiKeys.knowledgeGaps(status) })
      toast.success('Đã bỏ qua')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  const cols: Column<KnowledgeGap>[] = useMemo(() => [
    {
      key: 'question', header: 'Câu hỏi / thiếu hụt',
      cell: (r) => (
        <div>
          <div className="font-medium">{r.question}</div>
          {r.suggestion && <div className="text-xs text-muted-foreground line-clamp-1">Gợi ý: {r.suggestion}</div>}
        </div>
      ),
    },
    { key: 'gapType', header: 'Loại', cell: (r) => <Badge variant="outline">{r.gapType}</Badge> },
    { key: 'occurrences', header: 'Số lần', align: 'right', cell: (r) => r.occurrences },
    {
      key: 'lastSeenAt', header: 'Gần nhất',
      cell: (r) => <span className="text-muted-foreground">{new Date(r.lastSeenAt).toLocaleString('vi-VN')}</span>,
    },
    { key: 'status', header: 'Trạng thái', cell: (r) => statusBadge(r.status) },
    {
      key: 'actions', header: '', align: 'right',
      cell: (r) =>
        canEdit && r.status === 'open' ? (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => openResolve(r)} title="Giải quyết">
              <Check className="h-4 w-4 text-success" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => handleDismiss(r)} disabled={busy} title="Bỏ qua">
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canEdit, busy, status])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lỗ hổng kiến thức"
        description="Những câu hỏi AI chưa đủ dữ kiện để trả lời — hãy bổ sung tri thức hoặc bỏ qua."
      />

      <div className="flex items-center justify-between">
        <Tabs value={status} onValueChange={(v) => setStatus(v as GapStatus)}>
          <TabsList>
            <TabsTrigger value="open">Đang mở</TabsTrigger>
            <TabsTrigger value="resolved">Đã xử lý</TabsTrigger>
            <TabsTrigger value="dismissed">Đã bỏ qua</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-sm text-muted-foreground">Tổng: <b className="text-foreground">{total}</b></span>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isError ? (
            <DataTable columns={cols} rows={[]} rowKey={(r) => r.id} emptyTitle="Không tải được danh sách" />
          ) : (
            <DataTable
              columns={cols} rows={data?.data ?? []} rowKey={(r) => r.id}
              loading={isLoading} emptyTitle="Không có lỗ hổng nào"
            />
          )}
        </CardContent>
      </Card>

      {/* Dialog giải quyết */}
      <Dialog open={!!resolving} onOpenChange={(o) => !o && setResolving(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpenCheck className="h-4 w-4 text-primary" /> Giải quyết lỗ hổng
            </DialogTitle>
            <DialogDescription className="flex items-start gap-2">
              <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{resolving?.question}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>Tiêu đề</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tiêu đề tri thức" />
            </div>
            <div className="grid gap-2">
              <Label>Nội dung tri thức *</Label>
              <Textarea
                className="min-h-[140px]" value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Nhập câu trả lời/kiến thức để AI dùng lần sau..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)}>Huỷ</Button>
            <Button onClick={handleResolve} disabled={busy || !content.trim()}>
              <Check className="h-4 w-4" /> {busy ? 'Đang lưu...' : 'Tạo tri thức'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
