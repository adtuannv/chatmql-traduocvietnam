/**
 * sales-doc-edit-dialog.tsx — Admin soạn tài liệu bán hàng cho MỘT mã sản phẩm:
 * mô tả · nhiều ảnh · link video · từ khoá cho AI.
 *
 * Ghi vào bảng `product_docs` (khoá theo MÃ sản phẩm), KHÔNG ghi vào bảng
 * `products` nội bộ — bảng đó sẽ ngừng dùng khi nguồn sản phẩm chính thức chạy.
 * Dữ liệu gốc (giá, tồn, ĐVT) thuộc hệ thống nguồn nên không sửa ở đây.
 */
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Link2, Loader2, Trash2, X } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/misc'
import { apiError } from '@/lib/api-client'
import { resolveImageUrl, useUploadProductImage } from '@/hooks/use-products'
import { useProductDoc, useSaveProductDoc } from '@/hooks/use-product-docs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDocFolders } from '@/hooks/use-doc-library'

interface Props {
  /** Mã sản phẩm ở hệ thống nguồn — khoá của tài liệu. */
  code: string | null
  /** Tên hiển thị lúc mở, lưu kèm để hiện được khi hệ thống nguồn lỗi. */
  productName?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SalesDocEditDialog({ code, productName, open, onOpenChange }: Props) {
  const docQ = useProductDoc(open && code ? code : undefined)
  const save = useSaveProductDoc()
  const upload = useUploadProductImage()
  const fileRef = useRef<HTMLInputElement>(null)

  const [description, setDescription] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [videoUrls, setVideoUrls] = useState<string[]>([])
  const [keywords, setKeywords] = useState('')
  const [newVideo, setNewVideo] = useState('')
  const [folderId, setFolderId] = useState<string>('__none__')
  const foldersQ = useDocFolders()

  // Nạp lại form mỗi lần mở cho mã khác, kể cả khi chưa có tài liệu (form trắng).
  useEffect(() => {
    if (!open || docQ.isLoading) return
    const d = docQ.data
    setDescription(d?.description ?? '')
    setImages(d?.images ?? [])
    setVideoUrls(d?.videoUrls ?? [])
    setKeywords(d?.keywords ?? '')
    setFolderId(d?.folderId ?? '__none__')
    setNewVideo('')
  }, [open, code, docQ.data, docQ.isLoading])

  const onPickImages = (files: FileList | null) => {
    if (!files?.length) return
    // Tải tuần tự để giữ đúng thứ tự người dùng chọn.
    ;(async () => {
      for (const f of Array.from(files)) {
        try {
          const url = await upload.mutateAsync(f)
          setImages((prev) => [...prev, url])
        } catch (err) {
          toast.error(`Không tải được "${f.name}": ${apiError(err)}`)
        }
      }
    })()
  }

  const addVideo = () => {
    const v = newVideo.trim()
    if (!v) return
    if (!/^https?:\/\//i.test(v)) {
      toast.error('Link video phải bắt đầu bằng http:// hoặc https://')
      return
    }
    if (videoUrls.includes(v)) {
      toast.warning('Link này đã có trong danh sách')
      return
    }
    setVideoUrls((prev) => [...prev, v])
    setNewVideo('')
  }

  const onSave = () => {
    if (!code) return
    save.mutate(
      {
        code,
        data: {
          name: productName ?? null,
          folderId: folderId === '__none__' ? null : folderId,
          description: description.trim() || null,
          images,
          videoUrls,
          keywords: keywords.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success('Đã lưu tài liệu bán hàng')
          onOpenChange(false)
        },
        onError: (err) => toast.error(apiError(err)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="text-base">Chỉnh tài liệu bán hàng</DialogTitle>
          <DialogDescription className="truncate">
            {productName ?? '—'}{code ? ` · mã ${code}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {docQ.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {/* Danh mục trong cây tài liệu — quyết định sản phẩm nằm nhánh nào. */}
              <div className="grid gap-1.5">
                <Label>Danh mục tài liệu</Label>
                <Select value={folderId} onValueChange={setFolderId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Chưa phân loại</SelectItem>
                    {(foldersQ.data ?? []).map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.icon ? `${f.icon} ` : ''}{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Quyết định sản phẩm nằm ở nhánh nào của cây danh mục ngoài trang chính.
                </p>
              </div>

              {/* Mô tả */}
              <div className="grid gap-1.5">
                <Label>Mô tả sản phẩm</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  placeholder="Công dụng, cách dùng, quy cách, điểm nổi bật… (nhân viên đọc để tư vấn, AI cũng đọc nội dung này)"
                />
              </div>

              {/* Ảnh */}
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label>Hình ảnh ({images.length})</Label>
                  <input
                    ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => { onPickImages(e.target.files); e.target.value = '' }}
                  />
                  <Button
                    type="button" variant="outline" size="sm" className="h-8 gap-1.5"
                    onClick={() => fileRef.current?.click()} disabled={upload.isPending}
                  >
                    {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    Tải ảnh lên
                  </Button>
                </div>
                {images.length === 0 ? (
                  <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Chưa có ảnh. Ảnh đầu tiên là ảnh đại diện.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {images.map((u, i) => (
                      <div key={`${u}-${i}`} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                        <img src={resolveImageUrl(u)} alt="" className="h-full w-full object-cover" />
                        {i === 0 && (
                          <span className="absolute bottom-1 left-1 rounded bg-primary px-1 text-[10px] text-primary-foreground">
                            Đại diện
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-background/90 text-destructive shadow group-hover:flex"
                          aria-label="Gỡ ảnh"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Video */}
              <div className="grid gap-1.5">
                <Label>Video ({videoUrls.length})</Label>
                <div className="flex gap-2">
                  <Input
                    value={newVideo}
                    onChange={(e) => setNewVideo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVideo() } }}
                    placeholder="Dán link YouTube hoặc file .mp4…"
                  />
                  <Button type="button" variant="outline" className="shrink-0 gap-1.5" onClick={addVideo}>
                    <Link2 className="h-4 w-4" /> Thêm
                  </Button>
                </div>
                {videoUrls.length > 0 && (
                  <ul className="space-y-1">
                    {videoUrls.map((v, i) => (
                      <li key={`${v}-${i}`} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                        <span className="min-w-0 flex-1 truncate">{v}</span>
                        <button
                          type="button"
                          onClick={() => setVideoUrls((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Gỡ video"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Từ khoá cho AI */}
              <div className="grid gap-1.5">
                <Label>Từ khoá / tên gọi khác</Label>
                <Input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="VD: trà đinh, chè đinh ngọc, trà cao cấp…"
                />
                <p className="text-[11px] text-muted-foreground">
                  Giúp AI tìm đúng tài liệu khi khách gọi sản phẩm bằng tên khác.
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="border-t px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Huỷ</Button>
          <Button onClick={onSave} disabled={!code || save.isPending || upload.isPending || docQ.isLoading}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
