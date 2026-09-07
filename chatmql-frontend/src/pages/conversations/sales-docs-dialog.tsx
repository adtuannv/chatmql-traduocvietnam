/**
 * sales-docs-dialog.tsx — Popup "Tài liệu bán hàng" mở từ thanh soạn tin.
 *
 * LUỒNG THEO CÁCH SALE LÀM VIỆC, hai bước:
 *   1. CHỌN — sale nghĩ theo "gửi khách sản phẩm nào", nên tab Sản phẩm đứng
 *      trước, kèm ảnh và giá thật để nhận diện ngay; tab Tài liệu chung dành
 *      cho biểu giá, chính sách, banner.
 *   2. SOẠN GÓI — tick đúng phần muốn gửi (giới thiệu kèm giá · từng tấm ảnh ·
 *      video), thêm lời nhắn mở đầu, XEM TRƯỚC đúng thứ tự tin khách sẽ nhận,
 *      rồi mới bấm gửi.
 *
 * Bản trước chỉ là lưới tick rồi bắn: không biết khách nhận mấy tin, không bỏ
 * bớt được ảnh, không chèn được lời nhắn — gửi xong mới biết thừa.
 *
 * Ở đây CHỈ xem · chọn · gửi. Muốn sửa nội dung thì bấm "Quản lý".
 * Tài liệu `internal` không hiện ở đây và backend cũng chặn gửi.
 */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft, ExternalLink, FileText, Film, Folder, Image as ImageIcon, Link2, Lock,
  MessageSquare, Package, Search, Send, Settings2, Type,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox, ScrollArea, Textarea } from '@/components/ui/misc'
import { ErrorState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { formatVnd } from '@/lib/order-calc'
import { useCrmProductList, useCrmProductSearch } from '@/hooks/use-crm-products'
import {
  KIND_LABELS, assetUrl, useDocAssets, useDocFolders, useSendDocAssets,
  type AssetKind, type DocAsset, type DocFolder,
} from '@/hooks/use-doc-library'

const ALL = '__all__'

const KIND_ICON: Record<AssetKind, typeof ImageIcon> = {
  product: Package, image: ImageIcon, video: Film, pdf: FileText, doc: FileText, text: Type, link: Link2,
}

/** Cây thư mục phẳng hoá theo thứ tự người dùng đã sắp xếp. */
function flatten(folders: DocFolder[]): Array<DocFolder & { depth: number }> {
  const byParent = new Map<string | null, DocFolder[]>()
  for (const f of folders) {
    const arr = byParent.get(f.parentId) ?? []
    arr.push(f)
    byParent.set(f.parentId, arr)
  }
  const out: Array<DocFolder & { depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    const kids = (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    for (const f of kids) {
      out.push({ ...f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

interface Props {
  convId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SalesDocsDialog({ convId, open, onOpenChange }: Props) {
  // null = đang ở bước chọn; có giá trị = đang soạn gói cho tài liệu đó.
  const [composing, setComposing] = useState<DocAsset | null>(null)

  // Đóng popup thì quay về bước chọn, lần sau mở không rơi giữa chừng.
  useEffect(() => { if (!open) setComposing(null) }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[78vh] max-h-[78vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {composing ? (
          <ComposeStep
            asset={composing}
            convId={convId}
            onBack={() => setComposing(null)}
            onSent={() => { setComposing(null); onOpenChange(false) }}
          />
        ) : (
          <PickStep onPick={setComposing} />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Bước 1: chọn tài liệu cần gửi ───────────────────────────────────

function PickStep({ onPick }: { onPick: (a: DocAsset) => void }) {
  const [tab, setTab] = useState<'product' | 'other'>('product')
  const [folderId, setFolderId] = useState<string>(ALL)
  const [q, setQ] = useState('')

  const foldersQ = useDocFolders()
  const assetsQ = useDocAssets({
    folderId: folderId === ALL ? undefined : folderId,
    q,
    pageSize: 200,
  })
  // Kéo giá thật để sale nhận ra sản phẩm ngay trên thẻ, khỏi mở từng cái.
  const productsQ = useCrmProductList({ pageSize: 200 })

  // Tài liệu nội bộ không được phép gửi khách nên không hiện ở màn này.
  const folders = useMemo(
    () => flatten((foldersQ.data ?? []).filter((f) => f.visibility !== 'internal')),
    [foldersQ.data],
  )
  const all = (assetsQ.data?.items ?? []).filter((a) => a.visibility === 'sales')
  const assets = all.filter((a) => (tab === 'product' ? a.kind === 'product' : a.kind !== 'product'))
  const counts = {
    product: all.filter((a) => a.kind === 'product').length,
    other: all.filter((a) => a.kind !== 'product').length,
  }

  const priceOf = (a: DocAsset): string | null => {
    const code = a.productCodes[0]
    if (!code) return null
    const p = (productsQ.data?.products ?? [])
      .find((x) => x.code?.toUpperCase() === code.toUpperCase())
    return p?.price != null ? formatVnd(p.price) : null
  }

  return (
    <>
      <DialogHeader className="border-b px-5 py-3 pr-14">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle className="text-base">Gửi tài liệu cho khách</DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              <Lock className="h-3 w-3 shrink-0" />
              Chọn thứ cần gửi — bước sau chọn phần và xem trước.
            </DialogDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5">
            <a href="/sales-docs" target="_blank" rel="noreferrer" title="Mở module Tài liệu bán hàng ở tab mới">
              <Settings2 className="h-4 w-4" /> Quản lý <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </div>
      </DialogHeader>

      <div className="grid min-h-0 flex-1 grid-cols-[190px_1fr] overflow-hidden">
        {/* Cây thư mục — đi từ tổng quan */}
        <aside className="min-h-0 overflow-y-auto border-r p-2">
          <button
            type="button"
            onClick={() => setFolderId(ALL)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs',
              folderId === ALL ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
            )}
          >
            <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" /> Tất cả
          </button>
          {foldersQ.isLoading ? (
            <Loading className="py-6" />
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFolderId(f.id)}
                style={f.depth ? { paddingLeft: 8 + f.depth * 12 } : undefined}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs',
                  folderId === f.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
                )}
              >
                <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{f.icon ? `${f.icon} ` : ''}{f.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{f.assetCount}</span>
              </button>
            ))
          )}
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <div className="flex shrink-0 rounded-md border p-0.5">
              {(['product', 'other'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t === 'product' ? 'Sản phẩm' : 'Tài liệu chung'}
                  <span className="ml-1 opacity-70">{counts[t]}</span>
                </button>
              ))}
            </div>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm theo tên, mã, nội dung…"
                className="h-9 pl-8 text-sm"
              />
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1 [&>div]:!block">
            <div className="px-4 pb-4">
              {assetsQ.isLoading ? (
                <Loading className="py-10" />
              ) : assetsQ.error ? (
                <ErrorState message={apiError(assetsQ.error)} />
              ) : assets.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {tab === 'product'
                    ? 'Chưa có sản phẩm nào được phép gửi khách ở mục này.'
                    : 'Chưa có tài liệu chung nào ở mục này.'}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {assets.map((a) => {
                    const Icon = KIND_ICON[a.kind] ?? FileText
                    const src = a.kind === 'product'
                      ? assetUrl(a.images?.[0])
                      : a.kind === 'image' ? assetUrl(a.thumbUrl || a.fileUrl) : undefined
                    const price = priceOf(a)
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => onPick(a)}
                        title={a.description || a.title}
                        className="flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                      >
                        <span className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                          {src ? (
                            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <span className="flex h-full items-center justify-center text-muted-foreground">
                              <Icon className="h-5 w-5" />
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{a.title}</span>
                          <span className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            {price && <b className="text-foreground">{price}</b>}
                            {a.productCodes[0] && <span className="font-mono">{a.productCodes[0]}</span>}
                            {(a.images?.length ?? 0) > 0 && <span>{a.images.length} ảnh</span>}
                            {(a.videoUrls?.length ?? 0) > 0 && <span>{a.videoUrls.length} video</span>}
                            {a.kind !== 'product' && <span>{KIND_LABELS[a.kind]}</span>}
                          </span>
                        </span>
                        <span className="shrink-0 pr-1 text-xs font-medium text-primary">Chọn →</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </section>
      </div>
    </>
  )
}

// ── Bước 2: soạn gói gửi ────────────────────────────────────────────

function ComposeStep({
  asset, convId, onBack, onSent,
}: { asset: DocAsset; convId: string; onBack: () => void; onSent: () => void }) {
  const send = useSendDocAssets()
  // Tra giá ĐÚNG cách backend tra lúc gửi (tìm theo mã), để xem trước không nói
  // dối: lấy từ danh sách trang 1 thì kho lớn sẽ không thấy mã, mất phần giá.
  const code = asset.productCodes[0] ?? ''
  const priceQ = useCrmProductSearch(asset.kind === 'product' ? code : '', 10)

  const [includeIntro, setIncludeIntro] = useState(true)
  // Mặc định 3 tấm đầu: bắn cả bộ 10 tấm là dội chuông khách.
  const [images, setImages] = useState<string[]>(() => (asset.images ?? []).slice(0, 3))
  const [videos, setVideos] = useState<string[]>([])
  const [note, setNote] = useState('')

  const isProduct = asset.kind === 'product'
  const linked = (priceQ.data?.products ?? []).find(
    (p) => p.code?.toUpperCase() === code.toUpperCase(),
  )

  /**
   * Đúng những tin khách sẽ nhận, theo thứ tự.
   * Dựng lại y hệt logic backend để xem trước không nói dối.
   */
  const preview = useMemo(() => {
    const out: Array<{ type: 'text' | 'image'; value: string }> = []
    if (note.trim()) out.push({ type: 'text', value: note.trim() })

    if (isProduct) {
      if (includeIntro) {
        const lines = [`🍵 ${asset.title}`]
        // Định dạng giá y hệt backend (`buildProductMessage`) — lệch một ký tự
        // là bản xem trước không còn đúng tin khách nhận.
        // Không tra được sản phẩm thì backend bỏ hẳn dòng giá, không ghi "liên hệ".
        if (linked) {
          lines.push(linked.price != null
            ? `💰 Giá: ${new Intl.NumberFormat('vi-VN').format(linked.price)}đ${linked.unit ? `/${linked.unit}` : ''}`
            : '💰 Giá: liên hệ')
        }
        const body = [asset.description, asset.textContent].filter(Boolean).join('\n\n')
        if (body) lines.push('', body)
        if (videos.length) {
          lines.push('', '🎬 Video sản phẩm:')
          for (const v of videos.slice(0, 3)) lines.push(v)
        }
        out.push({ type: 'text', value: lines.join('\n') })
      }
      for (const u of images.slice(0, 5)) out.push({ type: 'image', value: u })
    } else if (asset.kind === 'image') {
      out.push({ type: 'image', value: asset.fileUrl ?? asset.images[0] ?? '' })
    } else {
      const link = asset.sourceUrl || asset.videoUrls[0] || asset.fileUrl
      const body = [asset.description, asset.textContent].filter(Boolean).join('\n\n')
      out.push({ type: 'text', value: [asset.title, body, link].filter(Boolean).join('\n\n') })
    }
    return out
  }, [asset, isProduct, includeIntro, images, videos, note, linked])

  const toggle = (list: string[], setList: (v: string[]) => void, u: string) =>
    setList(list.includes(u) ? list.filter((x) => x !== u) : [...list, u])

  const doSend = () => {
    if (!preview.length) { toast.error('Chưa chọn phần nào để gửi'); return }
    send.mutate(
      {
        conversationId: convId,
        note: note.trim() || undefined,
        items: [{ assetId: asset.id, includeIntro, imageUrls: images, videoUrls: videos }],
      },
      {
        onSuccess: (r) => {
          const problems = [
            ...r.skipped.map((s) => s.reason),
            ...(r.failedText ?? []).map((t) => `${t} không ra được kênh`),
          ]
          if (problems.length) toast.warning(`Đã gửi ${r.messages} tin — ${problems.join('; ')}`)
          else toast.success(`Đã gửi ${r.messages} tin cho khách`)
          onSent()
        },
        onError: (err) => toast.error(`Không gửi được: ${apiError(err)}`),
      },
    )
  }

  const allImagesOn = images.length === (asset.images?.length ?? 0)

  return (
    <>
      <DialogHeader className="border-b px-5 py-3 pr-14">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onBack} aria-label="Quay lại danh sách">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{asset.title}</DialogTitle>
            <DialogDescription>
              Chọn phần muốn gửi — bên phải là đúng những tin khách sẽ nhận.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden">
        {/* Trái: chọn phần */}
        <ScrollArea className="min-h-0 border-r [&>div]:!block">
          <div className="space-y-4 p-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Lời nhắn mở đầu
              </p>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="VD: Dạ em gửi anh/chị thông tin sản phẩm mình vừa hỏi ạ…"
                className="text-sm"
              />
            </div>

            {isProduct && (
              <>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5">
                  <Checkbox checked={includeIntro} onCheckedChange={(v) => setIncludeIntro(v === true)} />
                  <span className="min-w-0 text-sm">
                    <b>Giới thiệu &amp; giá</b>
                    <span className="block text-[11px] text-muted-foreground">
                      Tên, giá lấy từ hệ thống ngay lúc gửi, mô tả
                      {videos.length ? ', kèm link video đã chọn' : ''}.
                    </span>
                  </span>
                </label>

                {(asset.images?.length ?? 0) > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Ảnh ({images.length}/{asset.images.length})
                      </p>
                      <button
                        type="button"
                        className="text-[11px] text-primary hover:underline"
                        onClick={() => setImages(allImagesOn ? [] : [...asset.images])}
                      >
                        {allImagesOn ? 'Bỏ chọn hết' : 'Chọn hết'}
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {asset.images.map((u, i) => {
                        const on = images.includes(u)
                        return (
                          <button
                            key={`${u}-${i}`}
                            type="button"
                            onClick={() => toggle(images, setImages, u)}
                            aria-label={`Ảnh ${i + 1}`}
                            className={cn(
                              'relative aspect-square overflow-hidden rounded-md border-2 transition-opacity',
                              on ? 'border-primary' : 'border-transparent opacity-50 hover:opacity-90',
                            )}
                          >
                            <img src={assetUrl(u)} alt="" loading="lazy" className="h-full w-full object-cover" />
                            {on && (
                              <span className="absolute right-0.5 top-0.5 rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                                {images.indexOf(u) + 1}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                    {images.length > 5 && (
                      <p className="mt-1 text-[11px] text-amber-600">
                        Chỉ 5 ảnh đầu được gửi — nhiều hơn là dội chuông khách.
                      </p>
                    )}
                  </div>
                )}

                {(asset.videoUrls?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Video ({videos.length}/{asset.videoUrls.length})
                    </p>
                    <div className="space-y-1">
                      {asset.videoUrls.map((v, i) => (
                        <label
                          key={`${v}-${i}`}
                          className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs"
                        >
                          <Checkbox checked={videos.includes(v)} onCheckedChange={() => toggle(videos, setVideos, v)} />
                          <span className="min-w-0 flex-1 truncate">{v}</span>
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Link video nằm trong tin giới thiệu, không thành tin riêng.
                    </p>
                  </div>
                )}
              </>
            )}

            {!isProduct && (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Tài liệu loại {KIND_LABELS[asset.kind]} gửi nguyên vẹn trong một tin. Muốn tách nhỏ từng phần
                thì tạo tài liệu loại Sản phẩm ở module quản lý.
              </p>
            )}
          </div>
        </ScrollArea>

        {/* Phải: xem trước đúng thứ khách nhận */}
        <ScrollArea className="min-h-0 bg-muted/30 [&>div]:!block">
          <div className="space-y-2 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" /> Khách sẽ nhận {preview.length} tin
            </p>
            {preview.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                Chưa chọn phần nào để gửi.
              </p>
            ) : (
              preview.map((m, i) => (
                <div
                  key={i}
                  className="ml-auto max-w-[92%] overflow-hidden rounded-2xl rounded-br-md bg-primary text-primary-foreground"
                >
                  {m.type === 'image' ? (
                    <img src={assetUrl(m.value)} alt="" className="max-h-48 w-full object-cover" />
                  ) : (
                    <p className="whitespace-pre-wrap px-3 py-2 text-xs leading-relaxed">{m.value}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="border-t px-5 py-3">
        <Button className="w-full font-bold" onClick={doSend} disabled={send.isPending || preview.length === 0}>
          <Send /> {send.isPending ? 'Đang gửi…' : `Gửi ${preview.length} tin cho khách`}
        </Button>
      </div>
    </>
  )
}
