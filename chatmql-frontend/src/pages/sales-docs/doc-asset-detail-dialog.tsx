/**
 * doc-asset-detail-dialog.tsx — Xem chi tiết một tài nguyên và LẤY DỮ LIỆU.
 *
 * Với loại `product`, tài nguyên gồm nhiều phần (mô tả, bộ ảnh, nhiều video) nên
 * mỗi phần đều có nút riêng để lấy rời: sao chép mô tả, sao chép/tải từng ảnh,
 * sao chép từng link video. Ngoài ra có nút lấy TOÀN BỘ — gộp tên, mô tả, giá
 * (nếu đã ghép nối sản phẩm), link ảnh và video thành một khối để dán vào chat.
 *
 * Ở đây chỉ SAO CHÉP/TẢI VỀ, không tự gửi ra kênh khách — gửi thật phải do nhân
 * viên chủ động dán vào khung chat, tránh gửi nhầm.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Check, Copy, Download, ExternalLink, FileText, Film, Image as ImageIcon, Package,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatVnd } from '@/lib/order-calc'
import { useCrmProductList } from '@/hooks/use-crm-products'
import { KIND_LABELS, VISIBILITY_LABELS, assetUrl, type DocAsset } from '@/hooks/use-doc-library'

interface Props {
  asset: DocAsset | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Nút sao chép có phản hồi "Đã chép" trong ~1,6 giây. */
function CopyButton({
  text, label = 'Chép', title, className,
}: { text: string; label?: string; title?: string; className?: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1600)
    } catch {
      toast.error('Trình duyệt chặn sao chép. Bôi đen rồi Ctrl+C.')
    }
  }
  return (
    <Button
      type="button" variant="outline" size="sm" onClick={copy} title={title}
      className={cn('h-7 gap-1 px-2 text-xs', done && 'border-success/40 bg-success/10 text-success', className)}
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {done ? 'Đã chép' : label}
    </Button>
  )
}

function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/))([\w-]{6,})/i)
  return m ? m[1] : null
}

export function DocAssetDetailDialog({ asset, open, onOpenChange }: Props) {
  const [activeImg, setActiveImg] = useState(0)

  // Chỉ hỏi hệ thống sản phẩm khi tài nguyên có ghép nối — tài liệu chung thì không cần.
  const hasLinks = !!asset?.productCodes?.length
  const productsQ = useCrmProductList({ pageSize: 200 })
  const linked = hasLinks
    ? (productsQ.data?.products ?? []).filter((p) => p.code && asset!.productCodes.includes(p.code.toUpperCase()))
    : []

  const images = asset?.images ?? []
  const videos = asset?.videoUrls ?? []
  const fileHref = assetUrl(asset?.fileUrl ?? undefined) ?? asset?.sourceUrl ?? undefined

  /** Khối chữ "toàn bộ" — dán một phát là đủ thông tin gửi khách. */
  const fullText = useMemo(() => {
    if (!asset) return ''
    const parts: string[] = [asset.title]
    for (const p of linked) {
      const price = p.price != null ? formatVnd(p.price) : 'Liên hệ'
      parts.push(`Mã ${p.code} · Giá ${price}${p.unit ? `/${p.unit}` : ''}`)
    }
    if (asset.description) parts.push('', asset.description)
    if (asset.textContent) parts.push('', asset.textContent)
    const abs = images.map((u) => assetUrl(u)).filter(Boolean) as string[]
    if (abs.length) parts.push('', 'Hình ảnh:', ...abs)
    if (videos.length) parts.push('', 'Video:', ...videos)
    if (fileHref && !images.length) parts.push('', `Tệp: ${fileHref}`)
    return parts.join('\n')
  }, [asset, linked, images, videos, fileHref])

  if (!asset) return null
  const isProduct = asset.kind === 'product'
  const mainSrc = assetUrl(images[Math.min(activeImg, Math.max(images.length - 1, 0))])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-1.5 text-base">
            {isProduct ? <Package className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-primary" />}
            {asset.title}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{KIND_LABELS[asset.kind]}</Badge>
            {asset.visibility !== 'sales' && <Badge variant="secondary">{VISIBILITY_LABELS[asset.visibility]}</Badge>}
            {asset.productCodes.map((c) => (
              <span key={c} className="rounded bg-primary/10 px-1 font-mono text-[10px] text-primary">{c}</span>
            ))}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {asset.visibility === 'internal' && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
              Tài liệu <b>nội bộ</b> — không gửi cho khách.
            </p>
          )}

          {/* Dữ liệu sản phẩm thật, chỉ nạp khi đã ghép nối */}
          {linked.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sản phẩm đã ghép nối</h4>
              {linked.map((p) => (
                <div key={p.code} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                  <span className="rounded bg-muted px-1 font-mono text-[10px]">{p.code}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {p.price != null ? formatVnd(p.price) : 'Liên hệ'}
                  </span>
                  {p.inventory != null && p.inventory > 0 && (
                    <Badge variant="secondary" className="shrink-0 text-[9px]">
                      Tồn {p.inventory}
                    </Badge>
                  )}
                  <CopyButton
                    text={`${p.name} — Mã ${p.code} — ${p.price != null ? formatVnd(p.price) : 'Liên hệ'}`}
                    label="Chép" title="Chép tên + mã + giá"
                  />
                </div>
              ))}
            </section>
          )}

          {/* Mô tả — lấy rời được */}
          {asset.description && (
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mô tả</h4>
                <CopyButton text={asset.description} label="Chép mô tả" />
              </div>
              <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm leading-relaxed">{asset.description}</p>
            </section>
          )}

          {/* Nội dung chữ (văn bản/pdf/doc) */}
          {asset.textContent && (
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nội dung</h4>
                <CopyButton text={asset.textContent} label="Chép nội dung" />
              </div>
              <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm leading-relaxed">{asset.textContent}</p>
            </section>
          )}

          {/* Bộ ảnh — mỗi ảnh lấy rời được */}
          {images.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <ImageIcon className="h-3.5 w-3.5" /> Hình ảnh ({images.length})
                </h4>
                <CopyButton
                  text={(images.map((u) => assetUrl(u)).filter(Boolean) as string[]).join('\n')}
                  label="Chép tất cả link ảnh"
                />
              </div>

              <div className="overflow-hidden rounded-lg border bg-muted">
                {mainSrc && <img src={mainSrc} alt={asset.title} className="max-h-72 w-full object-contain" />}
              </div>

              <div className="grid grid-cols-6 gap-1.5">
                {images.map((u, i) => (
                  <button
                    key={`${u}-${i}`}
                    type="button"
                    onClick={() => setActiveImg(i)}
                    className={cn(
                      'aspect-square overflow-hidden rounded-md border-2 bg-muted',
                      i === activeImg ? 'border-primary' : 'border-transparent hover:border-border',
                    )}
                    aria-label={`Ảnh ${i + 1}`}
                  >
                    <img src={assetUrl(u)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>

              {/* Hành động cho đúng ảnh đang xem */}
              {mainSrc && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Ảnh {activeImg + 1}:</span>
                  <CopyButton text={mainSrc} label="Chép link" />
                  <Button asChild variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                    <a href={mainSrc} download><Download className="h-3 w-3" /> Tải về</a>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                    <a href={mainSrc} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /> Mở</a>
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* Video — mỗi link lấy rời được */}
          {videos.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Film className="h-3.5 w-3.5" /> Video ({videos.length})
                </h4>
                <CopyButton text={videos.join('\n')} label="Chép tất cả link" />
              </div>
              {videos.map((v, i) => {
                const yt = youtubeId(v)
                return (
                  <div key={`${v}-${i}`} className="space-y-1.5 rounded-lg border p-2">
                    {yt && (
                      <div className="aspect-video overflow-hidden rounded bg-black">
                        <iframe
                          src={`https://www.youtube.com/embed/${yt}`}
                          title={`Video ${i + 1}`}
                          className="h-full w-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          referrerPolicy="strict-origin-when-cross-origin"
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{v}</span>
                      <CopyButton text={v} label="Chép link" />
                      <Button asChild variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                        <a href={v} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /> Mở</a>
                      </Button>
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {/* Tệp đính kèm (loại không phải sản phẩm) */}
          {fileHref && images.length === 0 && (
            <section className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tệp</h4>
              <div className="flex items-center gap-1.5 rounded-md border px-2.5 py-2">
                <span className="min-w-0 flex-1 truncate text-xs">{fileHref}</span>
                <CopyButton text={fileHref} label="Chép link" />
                <Button asChild variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                  <a href={fileHref} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /> Mở</a>
                </Button>
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 border-t px-5 py-3 sm:flex-row sm:items-center">
          <p className="mr-auto text-[11px] text-muted-foreground">
            Lấy rời từng phần ở trên, hoặc lấy toàn bộ rồi dán vào khung chat.
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Đóng</Button>
          <CopyButton
            text={fullText}
            label="Lấy toàn bộ sản phẩm"
            title="Chép tên, giá, mô tả, link ảnh và video"
            className="h-9 px-3 text-sm"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
