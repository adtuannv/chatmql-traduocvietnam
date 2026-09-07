/**
 * train-ai-page.tsx — Nhúng trang "Train AI — Bộ não của trợ lý" (public/train-ai.html).
 *
 * Port từ `train-ai-bridge.js`: trang tĩnh chạy cùng origin nên dùng chung
 * localStorage['token'] / ['refreshToken'] với app — không phải đăng nhập lại.
 * `?embed=1` để trang tự ẩn thanh trên / menu riêng của nó.
 */
import { useState } from 'react'
import { BrainCircuit, ExternalLink, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Loading } from '@/components/shared/feedback'

const SRC = '/train-ai.html?embed=1'

export function TrainAiPage() {
  const [nonce, setNonce] = useState(0)
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[560px] flex-col gap-4">
      <PageHeader
        title="Train AI"
        description="Bộ não của trợ lý: kịch bản, kho tri thức và chat thử."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoaded(false)
                setNonce((n) => n + 1)
              }}
            >
              <RefreshCw /> Tải lại
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={SRC} target="_blank" rel="noreferrer noopener">
                <ExternalLink /> Mở tab mới
              </a>
            </Button>
          </>
        }
      />
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loading label="Đang mở Train AI..." />
          </div>
        )}
        <iframe
          key={nonce}
          src={`${SRC}&v=${nonce}`}
          title="Train AI — Bộ não của trợ lý"
          className="block h-full w-full border-0 bg-transparent"
          onLoad={() => setLoaded(true)}
        />
        <div className="pointer-events-none absolute bottom-2 right-3 flex items-center gap-1 text-[10px] text-muted-foreground">
          <BrainCircuit className="h-3 w-3" /> train-ai.html
        </div>
      </div>
    </div>
  )
}
