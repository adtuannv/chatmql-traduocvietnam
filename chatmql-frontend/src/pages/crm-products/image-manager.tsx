/**
 * image-manager.tsx — Chọn và sắp ảnh sản phẩm bằng ảnh xem trước.
 *
 * Trước đây là ô dán đường dẫn mỗi dòng một link: không ai nhìn chuỗi
 * `/uploads/doc-assets/9f1a-3b2c.jpg` mà biết đó là ảnh gì, nên dễ để nhầm ảnh
 * sai hoặc trùng mà không hay. Nay thấy ảnh thật, thêm bằng nút tải lên.
 *
 * Ảnh ĐẦU danh sách là ảnh đại diện — nó là tấm khách nhìn thấy trước tiên khi
 * sale gửi sản phẩm, nên phải đổi được thứ tự chứ không chỉ thêm với xoá.
 */
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, ImagePlus, Link2, Loader2, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { assetUrl, useUploadDocFile } from '@/hooks/use-doc-library'
import { doiCho, useKeoSapXep } from '@/lib/keo-sap-xep'

/** Đủ cho một sản phẩm; nhiều hơn là gửi khách dội chuông chứ không thuyết phục hơn. */
const TOI_DA = 12

export function ImageManager({
  images, onChange, doc,
}: {
  images: string[]
  onChange: (v: string[]) => void
  /** true = chế độ chỉ xem, không có nút sửa. */
  doc?: boolean
}) {
  const tai = useUploadDocFile()
  const inputRef = useRef<HTMLInputElement>(null)
  const [danLink, setDanLink] = useState(false)
  const [link, setLink] = useState('')

  const themTep = async (files: FileList | null) => {
    if (!files?.length) return
    const conLai = TOI_DA - images.length
    if (conLai <= 0) { toast.error(`Tối đa ${TOI_DA} ảnh`); return }

    const chon = [...files].slice(0, conLai)
    const them: string[] = []
    for (const f of chon) {
      try {
        const r = await tai.mutateAsync(f)
        if (r.kind !== 'image') { toast.error(`${f.name} không phải ảnh`); continue }
        them.push(r.url)
      } catch (e) {
        toast.error(`Không tải được ${f.name}: ${apiError(e)}`)
      }
    }
    if (them.length) {
      onChange([...images, ...them])
      toast.success(`Đã thêm ${them.length} ảnh`)
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  const xoa = (i: number) => onChange(images.filter((_, k) => k !== i))

  const dich = (i: number, huong: -1 | 1) => onChange(doiCho(images, i, i + huong))
  const keo = useKeoSapXep((tu, den) => onChange(doiCho(images, tu, den)))

  if (doc) {
    if (!images.length) return <span className="text-[13px] text-muted-foreground">—</span>
    return (
      <div className="flex flex-wrap gap-1.5">
        {images.map((u, i) => (
          <a key={`${u}-${i}`} href={assetUrl(u)} target="_blank" rel="noreferrer"
             title={i === 0 ? 'Ảnh đại diện' : `Ảnh ${i + 1}`} className="relative">
            <img src={assetUrl(u)} alt="" loading="lazy"
                 className="h-14 w-14 rounded border object-cover transition-opacity hover:opacity-80" />
            {i === 0 && (
              <Star className="absolute left-0.5 top-0.5 h-3 w-3 fill-amber-400 text-amber-500" />
            )}
          </a>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((u, i) => (
          <div
            key={`${u}-${i}`}
            {...keo.props(i)}
            title="Kéo để đổi thứ tự"
            className={cn(
              'group relative cursor-grab transition-opacity active:cursor-grabbing',
              keo.dangKeo === i && 'opacity-35',
              keo.dangTren === i && keo.dangKeo !== i && 'ring-2 ring-primary rounded-md',
            )}
          >
            <img src={assetUrl(u)} alt="" loading="lazy" draggable={false}
                 className={cn('h-20 w-20 rounded-md border object-cover',
                               i === 0 && 'ring-2 ring-amber-400')} />
            {i === 0 && (
              <span className="absolute left-1 top-1 rounded bg-amber-400/95 px-1 text-[9px] font-bold text-amber-950">
                Đại diện
              </span>
            )}
            <button
              type="button" onClick={() => xoa(i)} title="Xoá ảnh"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 shadow transition-opacity group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-0.5 rounded-b-md bg-black/45 py-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button type="button" onClick={() => dich(i, -1)} disabled={i === 0}
                      title="Chuyển lên trước" className="text-white disabled:opacity-30">
                <ArrowLeft className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => dich(i, 1)} disabled={i === images.length - 1}
                      title="Chuyển ra sau" className="text-white disabled:opacity-30">
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={tai.isPending || images.length >= TOI_DA}
          className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {tai.isPending
            ? <Loader2 className="h-5 w-5 animate-spin" />
            : <><ImagePlus className="h-5 w-5" /><span className="text-[10px]">Tải lên</span></>}
        </button>
      </div>

      <input ref={inputRef} type="file" accept="image/*" multiple hidden
             onChange={(e) => void themTep(e.target.files)} />

      <div className="flex items-center gap-2">
        <span className="text-[10.5px] text-muted-foreground">
          {images.length}/{TOI_DA} ảnh · kéo để đổi thứ tự, tấm đầu là ảnh đại diện
        </span>
        <button type="button" onClick={() => setDanLink((v) => !v)}
                className="ml-auto flex items-center gap-1 text-[10.5px] text-primary hover:underline">
          <Link2 className="h-3 w-3" /> {danLink ? 'Ẩn' : 'Dán đường dẫn'}
        </button>
      </div>

      {/* Vẫn giữ đường dán link: ảnh sẵn có trên máy chủ khác thì khỏi tải lại. */}
      {danLink && (
        <div className="flex gap-1.5">
          <Input value={link} onChange={(e) => setLink(e.target.value)}
                 placeholder="https://…" className="h-8 flex-1 font-mono text-[11.5px]" />
          <Button size="sm" className="h-8" disabled={!link.trim() || images.length >= TOI_DA}
                  onClick={() => { onChange([...images, link.trim()]); setLink('') }}>
            Thêm
          </Button>
        </div>
      )}
    </div>
  )
}
