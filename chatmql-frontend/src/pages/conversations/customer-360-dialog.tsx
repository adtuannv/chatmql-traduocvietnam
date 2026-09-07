/**
 * customer-360-dialog.tsx — Modal "Phân tích khách hàng (AI)" / Customer 360.
 *
 * Port từ `order-ui-bridge.js` (window.openCustomer360). Backend
 * `POST /ai/customer-360` trả 4 mục: chân dung (dựng từ dữ liệu thật, luôn có),
 * tóm tắt hội thoại, cơ hội, đề xuất hành động (3 mục do AI — có thể thiếu khi
 * AI lỗi, lúc đó `aiAvailable=false` và `aiError` cho biết lý do).
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, RefreshCw, Sparkles, StickyNote } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { api, apiError } from '@/lib/api-client'
import { useCreateQuickNote } from '@/hooks/use-quick-notes'

interface Customer360Result {
  portrait: string[]
  summary?: string | null
  opportunity?: string | null
  actions?: string[]
  aiAvailable: boolean
  aiError?: string | null
  fromCache?: boolean
  generatedAt?: string | null
}

function formatDateTime(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return `${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
}

/** Ghi lại đúng những gì nhân viên vừa đọc để sau này mở ghi chú vẫn hiểu vì sao quyết định như vậy. */
function toNoteContent(d: Customer360Result): string {
  const parts = ['🧠 Phân tích AI — Customer 360', '']
  parts.push('👤 Chân dung:', ...d.portrait.map((p) => `  • ${p}`), '')
  if (d.summary) parts.push('💬 Tóm tắt hội thoại:', `  ${d.summary}`, '')
  if (d.opportunity) parts.push('🎯 Cơ hội:', `  ${d.opportunity}`, '')
  if (d.actions?.length) {
    parts.push('✅ Đề xuất hành động:')
    d.actions.forEach((a, i) => parts.push(`  ${i + 1}. ${a}`))
  }
  return parts.join('\n').trim()
}

export function Customer360Dialog({
  open, onOpenChange, convId,
}: { open: boolean; onOpenChange: (o: boolean) => void; convId: string }) {
  const [data, setData] = useState<Customer360Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const createNote = useCreateQuickNote()

  async function analyze(forceFresh: boolean) {
    setLoading(true)
    setError(null)
    if (forceFresh) setData(null)
    try {
      const res = await api.post<Customer360Result>('/ai/customer-360', { conversationId: convId, forceFresh })
      setData(res.data)
    } catch (e) {
      setError(apiError(e))
    } finally {
      setLoading(false)
    }
  }

  // Mở modal là phân tích ngay; đổi hội thoại thì làm lại từ đầu.
  useEffect(() => {
    if (!open) return
    setData(null)
    setError(null)
    void analyze(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, convId])

  const canSave = !!data?.aiAvailable && !!(data.summary || data.actions?.length)

  async function saveNote() {
    if (!data) return
    try {
      await createNote.mutateAsync({ conversationId: convId, content: toNoteContent(data) })
      toast.success('Đã ghi vào ghi chú')
      onOpenChange(false)
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> Customer 360 — Phân tích khách hàng
          </DialogTitle>
          <DialogDescription>
            {loading && !data
              ? 'Đang đọc hội thoại và hồ sơ khách…'
              : data?.fromCache
                ? 'Dùng lại kết quả phân tích gần đây'
                : 'Phân tích từ hội thoại và hồ sơ khách'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 text-sm">
          {loading && !data && (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang phân tích…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-destructive" />
              <p className="font-semibold">Không phân tích được</p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            </div>
          )}

          {data && (
            <>
              {!data.aiAvailable && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-relaxed">
                  <b>Phần AI chưa chạy được.</b> Chân dung bên dưới vẫn chính xác vì được dựng từ dữ liệu
                  thật trong CRM, nhưng tóm tắt, cơ hội và đề xuất hành động thì đang thiếu.
                  <div className="mt-1 text-muted-foreground">Lý do: {data.aiError || 'không rõ'}</div>
                </div>
              )}

              <Section title="👤 Chân dung khách hàng">
                <ul className="list-disc space-y-1 pl-5">
                  {data.portrait.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </Section>
              {data.summary && (
                <Section title="💬 Tóm tắt hội thoại"><p className="whitespace-pre-wrap">{data.summary}</p></Section>
              )}
              {data.opportunity && (
                <Section title="🎯 Cơ hội"><p className="whitespace-pre-wrap">{data.opportunity}</p></Section>
              )}
              {!!data.actions?.length && (
                <Section title="✅ Đề xuất hành động">
                  <ol className="list-decimal space-y-1.5 pl-5">
                    {data.actions.map((a, i) => <li key={i}>{a}</li>)}
                  </ol>
                </Section>
              )}
            </>
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="mr-auto text-[11px] text-muted-foreground">
            {data ? `Lượt phân tích gần nhất: ${formatDateTime(data.generatedAt) ?? '—'}${data.fromCache ? ' (đã lưu)' : ''}` : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => analyze(true)} disabled={loading}>
              <RefreshCw className={loading ? 'animate-spin' : ''} /> Phân tích lại
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Đóng</Button>
            <Button size="sm" onClick={saveNote} disabled={!canSave || createNote.isPending}>
              <StickyNote /> {createNote.isPending ? 'Đang lưu…' : 'Ghi vào ghi chú'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="leading-relaxed">{children}</div>
    </section>
  )
}
