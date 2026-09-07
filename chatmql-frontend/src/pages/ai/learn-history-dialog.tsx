/**
 * learn-history-dialog.tsx — Nguồn tri thức "Lịch sử tin nhắn" trên trang Train AI.
 *
 * Port từ thiết kế train-ai.html (modal "Thêm nguồn tri thức" → tab 💬): cho AI
 * học GIỌNG ĐIỆU & MẪU CÂU của nhân viên thật từ hội thoại cũ. Kết quả là một
 * ĐỀ XUẤT cập nhật persona nằm chờ duyệt — người thật bấm Áp dụng mới có hiệu lực.
 * Backend: learn-history-routes.ts + master proposals; hook dùng chung với trang
 * Cải thiện AI (use-ai-improve.ts).
 */
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, FileUp, Loader2, Sparkles, X } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/misc'
import { apiError } from '@/lib/api-client'
import {
  useAnalyzeHistory, useAnalyzeHistoryFile, useApplyProposal, useLearnChannels,
  useLogicProposals, useRejectProposal,
} from '@/hooks/use-ai-improve'

const ALL = '__all__'

export function LearnHistoryDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const channelsQ = useLearnChannels()
  const pendingQ = useLogicProposals('pending')
  const analyze = useAnalyzeHistory()
  const analyzeFile = useAnalyzeHistoryFile()
  const apply = useApplyProposal()
  const reject = useRejectProposal()
  const fileRef = useRef<HTMLInputElement>(null)

  const [channelId, setChannelId] = useState<string>(ALL)
  const [days, setDays] = useState<string>('90')
  const [preferOrders, setPreferOrders] = useState(true)

  const pending = (pendingQ.data?.items ?? []).filter(
    (p) => p.source === 'learn_history' || p.source === 'learn_history_file',
  )
  const busy = analyze.isPending || analyzeFile.isPending

  const run = () => {
    analyze.mutate(
      // days=0 = toàn bộ lịch sử (backend hiểu 0 là không giới hạn ngày)
      { channelId: channelId === ALL ? undefined : channelId, days: Number(days), preferOrders },
      {
        onSuccess: (r) => toast.success('Đã tạo đề xuất persona từ lịch sử', { description: r.rationale }),
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  const onFile = (f: File | undefined) => {
    if (!f) return
    analyzeFile.mutate(f, {
      onSuccess: (r) => toast.success('Đã tạo đề xuất persona từ tệp', { description: r.rationale }),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>💬 Học từ lịch sử tin nhắn</DialogTitle>
          <DialogDescription>
            Cho AI học <b className="text-foreground">giọng điệu &amp; mẫu câu của nhân viên thật</b> từ
            hội thoại tư vấn trước đây. Kết quả là đề xuất cập nhật persona —{' '}
            <b className="text-foreground">bạn duyệt mới áp dụng</b>. Tốn 1 lời gọi AI mỗi lần chạy.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          {/* ── Cách 1: từ hội thoại trong hệ thống ── */}
          <div className="space-y-2.5 rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cách 1 · Chọn từ hội thoại trong hệ thống
            </p>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 text-sm">
                <b>Học theo tài khoản Zalo nào</b>
                <p className="text-xs text-muted-foreground">Chọn tài khoản của nhân viên tư vấn tốt nhất</p>
              </div>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger className="w-48 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tất cả tài khoản</SelectItem>
                  {(channelsQ.data?.channels ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || 'Không tên'} · {c.conversations} hội thoại
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 text-sm">
                <b>Khoảng thời gian</b>
                <p className="text-xs text-muted-foreground">Chỉ lấy hội thoại có nhân viên thật trả lời</p>
              </div>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="w-48 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 ngày gần nhất</SelectItem>
                  <SelectItem value="90">90 ngày gần nhất</SelectItem>
                  <SelectItem value="0">Toàn bộ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 text-sm">
                <b>Ưu tiên hội thoại ra đơn</b>
                <p className="text-xs text-muted-foreground">Đối chiếu SĐT với hoá đơn CRM (hoặc dấu hiệu chốt đơn)</p>
              </div>
              <Switch checked={preferOrders} onCheckedChange={setPreferOrders} />
            </div>
            <Button className="w-full" onClick={run} disabled={busy}>
              {analyze.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {analyze.isPending ? 'Đang phân tích…' : 'Phân tích & tạo đề xuất'}
            </Button>
          </div>

          {/* ── Cách 2: tệp xuất chat ── */}
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cách 2 · Tải tệp xuất lịch sử chat (.txt / .json)
            </p>
            <input
              ref={fileRef} type="file" accept=".txt,.json,text/plain,application/json" className="hidden"
              onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }}
            />
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
              {analyzeFile.isPending ? <Loader2 className="animate-spin" /> : <FileUp />}
              {analyzeFile.isPending ? 'Đang phân tích tệp…' : 'Chọn tệp & phân tích'}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Nội dung được ẩn danh trước khi phân tích. Tệp quá ngắn sẽ bị từ chối.
            </p>
          </div>

          {/* ── Đề xuất đang chờ duyệt ── */}
          {pending.length > 0 && (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide">
                {pending.length} đề xuất từ lịch sử đang chờ duyệt
              </p>
              {pending.map((p) => (
                <div key={p.id} className="rounded-md bg-background/70 p-2.5 text-sm">
                  <p className="leading-relaxed"><span className="text-muted-foreground">Vì sao:</span> {p.rationale}</p>
                  <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 text-xs leading-relaxed">
                    {p.proposedValue}
                  </pre>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm" disabled={apply.isPending || reject.isPending}
                      onClick={() => apply.mutate(p.id, {
                        onSuccess: () => toast.success('Đã áp dụng vào persona'),
                        onError: (e) => toast.error(apiError(e)),
                      })}
                    >
                      <Check /> Áp dụng
                    </Button>
                    <Button
                      size="sm" variant="outline" disabled={apply.isPending || reject.isPending}
                      onClick={() => reject.mutate(p.id, {
                        onSuccess: () => toast.success('Đã từ chối đề xuất'),
                        onError: (e) => toast.error(apiError(e)),
                      })}
                    >
                      <X /> Từ chối
                    </Button>
                  </div>
                </div>
              ))}
              <Link to="/ai/improve" className="block text-right text-xs text-primary hover:underline">
                Xem tất cả ở trang Cải thiện AI →
              </Link>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
