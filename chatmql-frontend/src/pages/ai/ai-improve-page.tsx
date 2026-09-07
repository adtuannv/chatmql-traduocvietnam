/**
 * ai-improve-page.tsx — "Cải thiện AI": học từ lịch sử tin nhắn + duyệt đề xuất.
 *
 * Backend đã có sẵn hai luồng nhưng chưa từng có giao diện:
 *  1. Học: phân tích hội thoại trong hệ thống (chọn kênh/số ngày) hoặc tệp
 *     xuất chat đầy đủ → AI đề xuất persona mới, KHÔNG tự áp dụng.
 *  2. Duyệt: mọi đề xuất (từ học lịch sử, phản hồi nhân viên, phiên AI Master)
 *     nằm chờ ở đây; người thật đọc diff rồi Áp dụng hoặc Từ chối.
 */
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BookOpenCheck, Check, ChevronDown, ChevronUp, FileUp, GraduationCap, Loader2, Sparkles, X,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/misc'
import { EmptyState, ErrorState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import {
  PROPOSAL_SOURCE_LABELS, PROPOSAL_STATUS_LABELS, PROPOSAL_SUBTYPE_LABELS, PROPOSAL_TARGET_LABELS,
  useAnalyzeHistory, useAnalyzeHistoryFile, useApplyProposal, useLearnChannels,
  useLogicProposals, useRejectProposal,
  type LogicProposal, type ProposalStatus,
} from '@/hooks/use-ai-improve'

const ALL_CHANNELS = '__all__'
const STATUS_TABS: Array<{ value: ProposalStatus | 'all'; label: string }> = [
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'applied', label: 'Đã áp dụng' },
  { value: 'rejected', label: 'Đã từ chối' },
  { value: 'all', label: 'Tất cả' },
]

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? ''
    : `${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
}

export function AiImprovePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cải thiện AI"
        description="AI học từ hội thoại thật rồi ĐỀ XUẤT thay đổi — chỉ áp dụng khi người thật duyệt."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <LearnFromSystemCard />
        <LearnFromFileCard />
      </div>
      <ProposalsSection />
    </div>
  )
}

// ── Học từ hội thoại trong hệ thống ─────────────────────────────────

function LearnFromSystemCard() {
  const channelsQ = useLearnChannels()
  const analyze = useAnalyzeHistory()
  const [channelId, setChannelId] = useState<string>(ALL_CHANNELS)
  const [days, setDays] = useState(90)
  const [preferOrders, setPreferOrders] = useState(true)

  const run = () => {
    analyze.mutate(
      { channelId: channelId === ALL_CHANNELS ? undefined : channelId, days, preferOrders },
      {
        onSuccess: (r) =>
          toast.success('Đã tạo đề xuất từ lịch sử — kéo xuống mục "Đề xuất" để duyệt', {
            description: r.rationale,
          }),
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GraduationCap className="h-4 w-4 text-primary" /> Học từ lịch sử tin nhắn
        </CardTitle>
        <CardDescription>
          Lấy hội thoại của nhân viên bán tốt trong hệ thống, ẩn danh rồi cho AI rút ra persona.
          Tốn 1 lời gọi AI mỗi lần chạy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Học theo kênh</label>
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CHANNELS}>Mọi kênh có hội thoại</SelectItem>
              {(channelsQ.data?.channels ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name || 'Không tên'} · {c.conversations} hội thoại
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-4">
          <div>
            <label className="text-xs text-muted-foreground">Trong bao nhiêu ngày</label>
            <Input
              type="number" min={7} max={365} value={days}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 90))}
              className="mt-1 w-28"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch checked={preferOrders} onCheckedChange={setPreferOrders} />
            Ưu tiên hội thoại đã chốt đơn
          </label>
        </div>
        <Button onClick={run} disabled={analyze.isPending} className="w-full">
          {analyze.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {analyze.isPending ? 'Đang phân tích…' : 'Phân tích & tạo đề xuất'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ── Học từ tệp xuất chat đầy đủ ─────────────────────────────────────

function LearnFromFileCard() {
  const analyzeFile = useAnalyzeHistoryFile()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const onPick = (f: File | undefined) => {
    if (!f) return
    setFileName(f.name)
    analyzeFile.mutate(f, {
      onSuccess: (r) =>
        toast.success('Đã tạo đề xuất từ tệp — kéo xuống mục "Đề xuất" để duyệt', {
          description: r.rationale,
        }),
      onError: (e) => toast.error(apiError(e)),
      onSettled: () => setFileName(null),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileUp className="h-4 w-4 text-primary" /> Học từ tệp chat đầy đủ
        </CardTitle>
        <CardDescription>
          Tải lên tệp xuất chat (.txt hoặc .json) từ Zalo/nguồn khác khi dữ liệu chưa nằm trong hệ
          thống. Nội dung được ẩn danh trước khi phân tích.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.json,text/plain,application/json"
          className="hidden"
          onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = '' }}
        />
        <Button
          variant="outline"
          className="w-full"
          disabled={analyzeFile.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {analyzeFile.isPending ? <Loader2 className="animate-spin" /> : <FileUp />}
          {analyzeFile.isPending ? `Đang phân tích ${fileName ?? 'tệp'}…` : 'Chọn tệp & phân tích'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Tệp quá ngắn sẽ bị từ chối — cần ít nhất vài lượt hội thoại của nhân viên để học được gì đó.
        </p>
      </CardContent>
    </Card>
  )
}

// ── Đề xuất chờ duyệt ───────────────────────────────────────────────

function ProposalsSection() {
  const [status, setStatus] = useState<ProposalStatus | 'all'>('pending')
  const listQ = useLogicProposals(status === 'all' ? undefined : status)
  const items = listQ.data?.items ?? []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-2 flex items-center gap-1.5 text-sm font-semibold">
          <BookOpenCheck className="h-4 w-4 text-primary" /> Đề xuất cải thiện
        </p>
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setStatus(t.value)}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              status === t.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-transparent bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {listQ.isLoading ? (
        <Loading />
      ) : listQ.isError ? (
        <ErrorState message={apiError(listQ.error)} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BookOpenCheck}
          title={status === 'pending' ? 'Không có đề xuất nào chờ duyệt' : 'Chưa có đề xuất nào'}
          description="Đề xuất sinh ra từ học lịch sử, phản hồi của nhân viên và phiên AI Master sẽ nằm ở đây."
        />
      ) : (
        <div className="space-y-2">
          {items.map((p) => <ProposalCard key={p.id} proposal={p} />)}
        </div>
      )}
    </div>
  )
}

function ProposalCard({ proposal: p }: { proposal: LogicProposal }) {
  const apply = useApplyProposal()
  const reject = useRejectProposal()
  const [openDiff, setOpenDiff] = useState(p.status === 'pending')
  const [confirming, setConfirming] = useState(false)
  const pending = apply.isPending || reject.isPending

  const target = [
    PROPOSAL_TARGET_LABELS[p.targetType] ?? p.targetType,
    p.targetSubtype ? PROPOSAL_SUBTYPE_LABELS[p.targetSubtype] ?? p.targetSubtype : null,
  ].filter(Boolean).join(' · ')

  const doApply = () =>
    apply.mutate(p.id, {
      onSuccess: () => { toast.success('Đã áp dụng đề xuất vào bộ não AI'); setConfirming(false) },
      onError: (e) => toast.error(apiError(e)),
    })

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px]">{PROPOSAL_SOURCE_LABELS[p.source] ?? p.source}</Badge>
        <span className="text-sm font-semibold">{target}</span>
        <Badge
          variant={p.status === 'applied' ? 'success' : p.status === 'rejected' ? 'secondary' : 'warning'}
          className="text-[10px]"
        >
          {PROPOSAL_STATUS_LABELS[p.status]}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">{fmtTime(p.createdAt)}</span>
      </div>

      <p className="mt-1.5 text-sm leading-relaxed">
        <span className="text-muted-foreground">Vì sao:</span> {p.rationale}
      </p>

      <button
        type="button"
        onClick={() => setOpenDiff((v) => !v)}
        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        {openDiff ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {openDiff ? 'Thu gọn nội dung' : 'Xem nội dung thay đổi'}
      </button>

      {openDiff && (
        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Hiện tại</p>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-xs leading-relaxed">
              {p.currentValue?.trim() || '(trống)'}
            </pre>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-semibold uppercase text-primary">Đề xuất mới</p>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-primary/25 bg-primary/5 p-2 text-xs leading-relaxed">
              {p.proposedValue}
            </pre>
          </div>
        </div>
      )}

      {p.status === 'pending' && (
        <div className="mt-3 flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-xs text-muted-foreground">Áp dụng sẽ thay nội dung đang chạy — chắc chưa?</span>
              <Button size="sm" onClick={doApply} disabled={pending}>
                {apply.isPending ? <Loader2 className="animate-spin" /> : <Check />} Áp dụng ngay
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={pending}>Khoan</Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => setConfirming(true)} disabled={pending}>
                <Check /> Áp dụng…
              </Button>
              <Button
                size="sm" variant="outline" disabled={pending}
                onClick={() =>
                  reject.mutate(p.id, {
                    onSuccess: () => toast.success('Đã từ chối đề xuất'),
                    onError: (e) => toast.error(apiError(e)),
                  })
                }
              >
                <X /> Từ chối
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
