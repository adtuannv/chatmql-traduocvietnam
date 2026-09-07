/**
 * doc-asset-dialog.tsx — Thêm/sửa tài nguyên, HAI BƯỚC.
 *
 * Bước 1: chọn LOẠI tài liệu. Bước 2: form đúng cho loại đó — mỗi loại cần
 * thông tin khác nhau nên không dùng chung một form:
 *   • Sản phẩm  → tên · mô tả · BỘ ẢNH · nhiều video · ghép nối mã sản phẩm
 *   • Hình ảnh  → tải ảnh · tiêu đề · mô tả
 *   • Video     → link (ưu tiên) hoặc tệp · tiêu đề · mô tả
 *   • PDF/Tài liệu → tải tệp · tiêu đề · nội dung chữ cho AI
 *   • Văn bản   → tiêu đề · ô soạn thảo lớn (không có tệp)
 *   • Đường dẫn → URL · tiêu đề · mô tả
 * Phần chung (thư mục, mức hiển thị, ghép nối sản phẩm) đặt ở cuối.
 */
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  FileText, Film, Image as ImageIcon, Link2, Loader2, Package, Type, Upload, X,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { ProductPicker } from './product-picker'
import {
  VISIBILITY_LABELS, assetUrl, useSaveDocAsset, useUploadDocFile,
  type AssetKind, type DocAsset, type DocFolder, type Visibility,
} from '@/hooks/use-doc-library'

const NO_FOLDER = '__none__'

/** Mô tả từng loại để người dùng chọn đúng ngay từ bước 1. */
const KIND_CARDS: Array<{ kind: AssetKind; icon: typeof Package; label: string; hint: string }> = [
  { kind: 'product', icon: Package, label: 'Sản phẩm', hint: 'Tên, mô tả, bộ ảnh, video — như một trang bán hàng' },
  { kind: 'image', icon: ImageIcon, label: 'Hình ảnh', hint: 'Một ảnh đơn: banner, ảnh biểu giá…' },
  { kind: 'video', icon: Film, label: 'Video', hint: 'Link YouTube/mp4, hoặc tải tệp lên' },
  { kind: 'pdf', icon: FileText, label: 'PDF', hint: 'Catalogue, hồ sơ năng lực…' },
  { kind: 'doc', icon: FileText, label: 'Tài liệu', hint: 'Word, Excel, PowerPoint' },
  { kind: 'text', icon: Type, label: 'Văn bản', hint: 'Gõ thẳng nội dung, AI đọc được' },
  { kind: 'link', icon: Link2, label: 'Đường dẫn', hint: 'Chỉ lưu URL tới nguồn bên ngoài' },
]

const ACCEPT: Partial<Record<AssetKind, string>> = {
  product: '.jpg,.jpeg,.png,.webp,.gif',
  image: '.jpg,.jpeg,.png,.webp,.gif',
  video: '.mp4,.webm',
  pdf: '.pdf',
  doc: '.doc,.docx,.xls,.xlsx,.ppt,.pptx',
}

interface Props {
  asset: DocAsset | null
  folders: DocFolder[]
  defaultFolderId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DocAssetDialog({ asset, folders, defaultFolderId, open, onOpenChange }: Props) {
  const save = useSaveDocAsset()
  const upload = useUploadDocFile()
  const fileRef = useRef<HTMLInputElement>(null)

  // null = đang ở bước chọn loại. Sửa tài nguyên cũ thì bỏ qua bước này.
  const [kind, setKind] = useState<AssetKind | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [textContent, setTextContent] = useState('')
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const [mimeType, setMimeType] = useState<string | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [videoUrls, setVideoUrls] = useState<string[]>([])
  const [newVideo, setNewVideo] = useState('')
  const [folderId, setFolderId] = useState<string>(NO_FOLDER)
  const [visibility, setVisibility] = useState<Visibility>('sales')
  const [codes, setCodes] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setKind(asset?.kind ?? null)
    setTitle(asset?.title ?? '')
    setDescription(asset?.description ?? '')
    setTextContent(asset?.textContent ?? '')
    setFileUrl(asset?.fileUrl ?? null)
    setFileSize(asset?.fileSize ?? null)
    setMimeType(asset?.mimeType ?? null)
    setSourceUrl(asset?.sourceUrl ?? '')
    setImages(asset?.images ?? [])
    setVideoUrls(asset?.videoUrls ?? [])
    setNewVideo('')
    setFolderId(asset?.folderId ?? defaultFolderId ?? NO_FOLDER)
    setVisibility(asset?.visibility ?? 'sales')
    setCodes(asset?.productCodes ?? [])
  }, [open, asset, defaultFolderId])

  /** Loại `product` gom ảnh vào bộ ảnh; loại khác thay tệp đính kèm. */
  const onPickFiles = (files: FileList | null) => {
    if (!files?.length) return
    ;(async () => {
      for (const f of Array.from(files)) {
        try {
          const r = await upload.mutateAsync(f)
          if (kind === 'product') setImages((prev) => [...prev, r.url])
          else {
            setFileUrl(r.url)
            setFileSize(r.fileSize)
            setMimeType(r.mimeType)
          }
          if (!title.trim()) setTitle(r.originalName.replace(/\.[^.]+$/, ''))
        } catch (err) {
          toast.error(`Không tải được "${f.name}": ${apiError(err)}`)
        }
      }
    })()
  }

  const addVideo = () => {
    const v = newVideo.trim()
    if (!v) return
    if (!/^https?:\/\//i.test(v)) { toast.error('Link video phải bắt đầu bằng http:// hoặc https://'); return }
    if (videoUrls.includes(v)) { toast.warning('Link này đã có'); return }
    setVideoUrls((prev) => [...prev, v])
    setNewVideo('')
  }

  const onSave = () => {
    if (!kind) return
    if (!title.trim()) { toast.error('Nhập tiêu đề'); return }

    // Mỗi loại có yêu cầu tối thiểu khác nhau — báo đúng thứ đang thiếu.
    if (kind === 'product' && !images.length && !description.trim()) {
      toast.error('Sản phẩm cần ít nhất một ảnh hoặc phần mô tả'); return
    }
    if (kind === 'text' && !textContent.trim()) { toast.error('Nhập nội dung văn bản'); return }
    if (kind === 'link' && !sourceUrl.trim()) { toast.error('Nhập đường dẫn'); return }
    if ((kind === 'pdf' || kind === 'doc' || kind === 'image') && !fileUrl && !sourceUrl.trim()) {
      toast.error('Tải tệp lên hoặc dán đường dẫn'); return
    }
    if (kind === 'video' && !sourceUrl.trim() && !fileUrl && !videoUrls.length) {
      toast.error('Dán link video hoặc tải tệp lên'); return
    }
    if (sourceUrl.trim() && !/^https?:\/\//i.test(sourceUrl.trim())) {
      toast.error('Đường dẫn phải bắt đầu bằng http:// hoặc https://'); return
    }

    save.mutate(
      {
        id: asset?.id,
        data: {
          kind,
          title: title.trim(),
          description: description.trim() || null,
          textContent: textContent.trim() || null,
          fileUrl,
          fileSize,
          mimeType,
          sourceUrl: sourceUrl.trim() || null,
          images,
          videoUrls,
          folderId: folderId === NO_FOLDER ? null : folderId,
          visibility,
          productCodes: codes,
        },
      },
      {
        onSuccess: () => {
          toast.success(asset ? 'Đã cập nhật' : 'Đã thêm tài liệu')
          onOpenChange(false)
        },
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  const card = KIND_CARDS.find((c) => c.kind === kind)

  // ── Bước 1: chọn loại ──────────────────────────────────────────────
  if (open && !kind) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Thêm tài liệu — chọn loại</DialogTitle>
            <DialogDescription>Mỗi loại có thông tin cần nhập khác nhau.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {KIND_CARDS.map((c) => (
              <button
                key={c.kind}
                type="button"
                onClick={() => setKind(c.kind)}
                className="flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors hover:border-primary/60 hover:bg-accent/40"
              >
                <c.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{c.label}</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{c.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // ── Bước 2: form theo loại ─────────────────────────────────────────
  const isProduct = kind === 'product'
  const needsFile = kind === 'image' || kind === 'pdf' || kind === 'doc' || kind === 'video'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-1.5 text-base">
            {card && <card.icon className="h-4 w-4 text-primary" />}
            {asset ? 'Sửa' : 'Thêm'} {card?.label.toLowerCase()}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            {card?.hint}
            {!asset && (
              <button type="button" onClick={() => setKind(null)} className="text-primary hover:underline">
                Đổi loại
              </button>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-1.5">
            <Label>{isProduct ? 'Tên sản phẩm *' : 'Tiêu đề *'}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isProduct ? 'VD: Trà Ô Long Tứ Quý hộp thiếc 200g' : 'VD: Bảng giá 2026'}
              autoFocus
            />
          </div>

          {/* Mô tả: sản phẩm cần ô lớn, loại khác chỉ một dòng ghi chú. */}
          <div className="grid gap-1.5">
            <Label>{isProduct ? 'Mô tả sản phẩm' : 'Mô tả ngắn'}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={isProduct ? 5 : 2}
              placeholder={isProduct
                ? 'Công dụng, cách dùng, quy cách, điểm nổi bật… (nhân viên đọc để tư vấn, AI cũng đọc)'
                : 'Dùng khi nào, gửi cho ai…'}
            />
          </div>

          <input
            ref={fileRef} type="file" className="hidden"
            multiple={isProduct}
            accept={ACCEPT[kind!] ?? undefined}
            onChange={(e) => { onPickFiles(e.target.files); e.target.value = '' }}
          />

          {/* Sản phẩm: bộ ảnh + nhiều video */}
          {isProduct && (
            <>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label>Hình ảnh ({images.length})</Label>
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5"
                    onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                    {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                    Tải ảnh lên
                  </Button>
                </div>
                {images.length === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                    Chưa có ảnh. Ảnh đầu tiên là ảnh đại diện.
                  </p>
                ) : (
                  <div className="grid grid-cols-5 gap-2">
                    {images.map((u, i) => (
                      <div key={`${u}-${i}`} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                        <img src={assetUrl(u)} alt="" className="h-full w-full object-cover" />
                        {i === 0 && <span className="absolute bottom-0.5 left-0.5 rounded bg-primary px-1 text-[9px] text-primary-foreground">Đại diện</span>}
                        <button type="button" aria-label="Gỡ ảnh"
                          onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded-full bg-background/90 text-destructive group-hover:flex">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-1.5">
                <Label>Video ({videoUrls.length})</Label>
                <div className="flex gap-2">
                  <Input value={newVideo} onChange={(e) => setNewVideo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVideo() } }}
                    placeholder="Dán link YouTube hoặc .mp4…" />
                  <Button type="button" variant="outline" className="shrink-0" onClick={addVideo}>Thêm</Button>
                </div>
                {videoUrls.map((v, i) => (
                  <div key={`${v}-${i}`} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate">{v}</span>
                    <button type="button" aria-label="Gỡ video"
                      onClick={() => setVideoUrls((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Ảnh / PDF / Tài liệu / Video: một tệp đính kèm */}
          {needsFile && (
            <div className="grid gap-1.5">
              <Label>{kind === 'video' ? 'Tệp video (không bắt buộc)' : 'Tệp *'}</Label>
              {fileUrl ? (
                <div className="flex items-center gap-2 rounded-md border p-2">
                  {kind === 'image' && <img src={assetUrl(fileUrl)} alt="" className="h-12 w-12 rounded object-cover" />}
                  <span className="min-w-0 flex-1 truncate text-xs">{fileUrl.split('/').pop()}</span>
                  <button type="button" aria-label="Gỡ tệp"
                    onClick={() => { setFileUrl(null); setFileSize(null); setMimeType(null) }}
                    className="text-muted-foreground hover:text-destructive">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Button type="button" variant="outline" className="gap-1.5"
                  onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                  {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Tải tệp lên (tối đa 25MB)
                </Button>
              )}
              {kind === 'video' && (
                <p className="text-[11px] text-muted-foreground">Video nặng nên dán link ở dưới thay vì tải lên.</p>
              )}
            </div>
          )}

          {/* Đường dẫn ngoài: bắt buộc với loại link, tuỳ chọn với ảnh/pdf/video */}
          {(kind === 'link' || needsFile) && (
            <div className="grid gap-1.5">
              <Label>{kind === 'link' ? 'Đường dẫn *' : 'Hoặc đường dẫn ngoài'}</Label>
              <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://drive.google.com/… hoặc link YouTube" />
            </div>
          )}

          {/* Văn bản / PDF / Tài liệu: phần chữ cho AI */}
          {(kind === 'text' || kind === 'pdf' || kind === 'doc') && (
            <div className="grid gap-1.5">
              <Label>{kind === 'text' ? 'Nội dung *' : 'Nội dung chữ (AI đọc phần này)'}</Label>
              <Textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                rows={kind === 'text' ? 8 : 4}
                placeholder={kind === 'text'
                  ? 'Gõ nội dung tài liệu…'
                  : 'Dán phần chữ quan trọng của tệp vào đây để AI tra cứu được.'}
              />
            </div>
          )}

          {/* Ghép nối sản phẩm — với loại `product` thì đây là nối về mã trong hệ thống nguồn. */}
          <div className="grid gap-1.5 rounded-lg border p-3">
            <Label>{isProduct ? 'Ghép nguồn với sản phẩm hệ thống' : 'Ghép nối sản phẩm'}</Label>
            <ProductPicker value={codes} onChange={setCodes} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Thư mục</Label>
              <Select value={folderId} onValueChange={setFolderId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FOLDER}>Chưa xếp thư mục</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.icon ? `${f.icon} ` : ''}{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Mức hiển thị</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => (
                    <SelectItem key={v} value={v}>{VISIBILITY_LABELS[v]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className={cn('border-t px-5 py-3')}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Huỷ</Button>
          <Button onClick={onSave} disabled={save.isPending || upload.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
