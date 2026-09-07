/**
 * channel-setup-guide.tsx — Bảng hướng dẫn khi một kênh chưa có khoá ứng dụng.
 *
 * Dùng chung cho Zalo OA và Facebook Page: cả hai đều bế tắc ở đúng một chỗ —
 * backend đã sẵn sàng nhưng thiếu App ID / Secret trong `.env`. Trước đây bấm
 * "Kết nối" chỉ ra toast lỗi kỹ thuật, không nói thiếu gì và lấy ở đâu.
 */
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { Copy, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Ô chép nhanh — báo rõ khi trình duyệt chặn thay vì im lặng. */
export function CopyBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-[11px]">{value}</code>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2"
          onClick={() =>
            navigator.clipboard.writeText(value).then(
              () => toast.success('Đã chép'),
              () => toast.error('Trình duyệt chặn chép tự động — hãy bôi đen và chép tay'),
            )
          }
        >
          <Copy className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

export function ChannelSetupGuide({
  title, intro, steps, copyItems, missing, footnote,
}: {
  title: string
  intro: string
  steps: ReactNode[]
  copyItems: { label: string; value: string }[]
  missing: string[]
  footnote: ReactNode
}) {
  return (
    <div className="space-y-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
      <div className="flex gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{intro}</p>
        </div>
      </div>

      <ol className="ml-1 list-inside list-decimal space-y-1.5 text-xs">
        {steps.map((st, i) => <li key={i}>{st}</li>)}
      </ol>

      <div className="grid gap-2 sm:grid-cols-2">
        {copyItems.map((c) => <CopyBox key={c.label} {...c} />)}
      </div>

      {missing.length > 0 && (
        <div className="rounded-lg bg-background/70 p-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">Thiếu trong .env:</p>
          <pre className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed">
            {missing.join('\n')}
          </pre>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">{footnote}</p>
    </div>
  )
}
