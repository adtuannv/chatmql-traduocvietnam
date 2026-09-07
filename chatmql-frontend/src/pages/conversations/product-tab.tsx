/**
 * product-tab.tsx — Tab "Sản phẩm" ở cột phải màn Hội thoại.
 *
 * Sale đang chat với khách, hỏi "cái này bao nhiêu" thì gửi ngay thẻ sản phẩm
 * kèm link Mini App để khách bấm vào xem và đặt — không phải rời màn hình.
 *
 * Thẻ nằm NGANG (ảnh trái, thông tin phải, nút gửi bên phải) chứ không phải
 * lưới ô vuông: cột chỉ rộng ~360px, thẻ ngang đọc được tên dài và giá mà vẫn
 * thấy nhiều sản phẩm một lúc.
 *
 * Dữ liệu lấy từ hệ thống sản phẩm đang bật (`/crm-products`). Đổi nguồn sang
 * API chính thức của TDVN thì tab này không phải sửa gì.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, ImageOff, Search, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ErrorState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { formatVnd } from '@/lib/order-calc'
import { useSendMessage } from '@/hooks/use-conversations'
import { useCrmProductList, useCrmProductSource, type CrmProduct } from '@/hooks/use-crm-products'

/**
 * Dựng link Mini App từ mẫu cấu hình. Thiếu mẫu hoặc thiếu mã thì không gửi.
 *
 * `{miniapp}` là mã bên hệ quản trị Zalo Mini App và là thứ Mini App thật sự
 * hiểu; `{code}`/`{id}` giữ lại cho hệ thống nguồn nào đánh địa chỉ kiểu khác.
 * Mã chứa dấu gạch chéo nên phải mã hoá, đúng như link hệ quản trị sinh ra.
 */
function miniAppLink(template: string, p: CrmProduct): string | null {
  if (!template) return null
  const phan: Record<string, string> = {
    '{miniapp}': p.miniAppId?.trim() ?? '',
    '{code}': p.code?.trim() ?? '',
    '{id}': p.id != null ? String(p.id) : '',
  }
  let out = template
  for (const [khoa, gia_tri] of Object.entries(phan)) {
    if (!template.includes(khoa)) continue
    if (!gia_tri) return null
    out = out.replaceAll(khoa, encodeURIComponent(gia_tri))
  }
  return out
}

/** Tin gửi khách: gọn như một thẻ hàng, dòng cuối là link để bấm. */
function buildMessage(p: CrmProduct, link: string): string {
  const lines = [`🍵 ${p.name}`]
  if (p.price != null) {
    lines.push(`💰 ${formatVnd(p.price)}${p.priceMax != null ? ` – ${formatVnd(p.priceMax)}` : ''}${p.unit ? `/${p.unit}` : ''}`)
  }
  lines.push('👉 Xem chi tiết và đặt hàng:', link)
  return lines.join('\n')
}

export function ProductTab({ convId }: { convId: string }) {
  const [q, setQ] = useState('')
  const sourceQ = useCrmProductSource()
  const listQ = useCrmProductList({ q, pageSize: 60 })
  const send = useSendMessage(convId)
  const [sendingId, setSendingId] = useState<string | null>(null)

  const template = sourceQ.data?.miniAppUrlTemplate ?? ''
  // Hàng ngừng bán không nên chào khách — lọc ngay, khỏi phải nhớ.
  const products = useMemo(
    () => (listQ.data?.products ?? []).filter((p) => (p.status ?? 'active') !== 'inactive'),
    [listQ.data],
  )

  const doSend = (p: CrmProduct) => {
    const link = miniAppLink(template, p)
    if (!link) {
      toast.error('Sản phẩm này chưa ghép mã Mini App nên chưa dựng được link')
      return
    }
    const key = String(p.id ?? p.code ?? p.name)
    setSendingId(key)
    send.mutate(buildMessage(p, link), {
      onSuccess: () => toast.success(`Đã gửi ${p.name}`),
      onError: (err) => toast.error(`Không gửi được: ${apiError(err)}`),
      onSettled: () => setSendingId(null),
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm sản phẩm theo tên hoặc mã…"
            className="h-9 pl-8 text-sm"
          />
        </div>
        {!template && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900">
            Chưa cấu hình link Mini App nên nút gửi đang khoá. Đặt
            {' '}<code className="font-mono">ZALO_MINIAPP_PRODUCT_URL</code> ở máy chủ, dạng
            {' '}<code className="font-mono">…/product/{'{code}'}</code>.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {listQ.isLoading ? (
          <Loading label="Đang tải sản phẩm…" className="py-10" />
        ) : listQ.error ? (
          <ErrorState message={`Không lấy được sản phẩm: ${apiError(listQ.error)}`} />
        ) : products.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {q ? 'Không có sản phẩm nào khớp.' : 'Hệ thống sản phẩm chưa trả về dữ liệu.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {products.map((p) => {
              const key = String(p.id ?? p.code ?? p.name)
              const link = miniAppLink(template, p)
              return (
                <ProductCard
                  key={key}
                  p={p}
                  link={link}
                  template={template}
                  sending={sendingId === key}
                  disabled={send.isPending}
                  onSend={() => doSend(p)}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** Một thẻ hàng nằm ngang: ảnh · tên và giá · nút gửi. */
function ProductCard({
  p, link, template, sending, disabled, onSend,
}: {
  p: CrmProduct
  link: string | null
  template: string
  sending: boolean
  disabled: boolean
  onSend: () => void
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card p-2 transition-colors hover:border-primary/40">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
        {p.imageUrl ? (
          <img src={p.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[12.5px] font-medium leading-snug">{p.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn('text-[12.5px] font-bold', p.price != null ? 'text-primary' : 'text-muted-foreground')}>
            {p.price != null ? formatVnd(p.price) : 'Liên hệ'}
            {p.priceMax != null && ` – ${formatVnd(p.priceMax)}`}
          </span>
          {p.unit && <span className="text-[11px] text-muted-foreground">/{p.unit}</span>}
          {p.inventory != null && (
            <Badge variant={p.inventory > 0 ? 'secondary' : 'destructive'} className="h-4 px-1 text-[9.5px]">
              {p.inventory > 0 ? `Còn ${p.inventory}` : 'Hết hàng'}
            </Badge>
          )}
        </div>
        {p.code && <p className="truncate font-mono text-[10px] text-muted-foreground">{p.code}</p>}
      </div>

      <div className="flex w-[62px] shrink-0 flex-col items-center gap-1">
        <Button
          size="sm"
          className="h-7 w-full gap-1 px-2 text-[11.5px]"
          disabled={!link || disabled}
          onClick={onSend}
          title={link ? 'Gửi thẻ sản phẩm kèm link Mini App' : 'Chưa dựng được link Mini App cho sản phẩm này'}
        >
          <Send className="h-3 w-3" /> {sending ? '…' : 'Gửi'}
        </Button>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            title="Mở thử link Mini App"
            className="text-muted-foreground transition-colors hover:text-primary"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          // Nút khoá mà không nói lý do thì sale tưởng hỏng; nói rõ thiếu gì.
          <span className="text-center text-[9.5px] leading-tight text-muted-foreground">
            {template ? 'Chưa ghép Mini App' : 'Chưa có link'}
          </span>
        )}
      </div>
    </div>
  )
}
