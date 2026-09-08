/**
 * image-library-picker.tsx — Chọn ảnh đã có sẵn trong thư viện tài liệu.
 *
 * Cùng một tấm ảnh thường dùng cho nhiều sản phẩm: ảnh bàn trà, ảnh bao bì
 * chung, ảnh chứng nhận. Không có chỗ chọn lại thì mỗi lần phải tải lên một bản
 * mới — vừa tốn đĩa, vừa khiến muốn đổi ảnh phải đi sửa ở chục chỗ.
 *
 * Cho chọn NHIỀU tấm một lượt: thêm ảnh cho sản phẩm thường là thêm cả bộ, bắt
 * mở lại popup từng tấm thì rất mệt.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ImageOff, Loader2, Search } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/misc'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { assetUrl } from '@/hooks/use-doc-library'

interface AnhThuVien {
  url: string
  title: string
  kind: string
}

export function ImageLibraryPicker({
  open, onOpenChange, daCo, onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Ảnh sản phẩm này đã có — đánh dấu để khỏi chọn trùng. */
  daCo: string[]
  onPick: (urls: string[]) => void
}) {
  const [tuKhoa, setTuKhoa] = useState('')
  const [chon, setChon] = useState<string[]>([])

  const q = useQuery({
    queryKey: ['doc-library', 'images'],
    queryFn: async () => (await api.get<{ images: AnhThuVien[]; total: number }>('/doc-library/images')).data,
    enabled: open,
  })

  const hienThi = useMemo(() => {
    const ds = q.data?.images ?? []
    const t = tuKhoa.trim().toLowerCase()
    return t ? ds.filter((x) => x.title.toLowerCase().includes(t)) : ds
  }, [q.data, tuKhoa])

  const bat = (url: string) =>
    setChon((v) => (v.includes(url) ? v.filter((x) => x !== url) : [...v, url]))

  const xong = () => {
    if (chon.length) onPick(chon)
    setChon([])
    setTuKhoa('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setChon([]); setTuKhoa('') } onOpenChange(v) }}>
      <DialogContent className="flex h-[72vh] max-h-[72vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-3 pr-14">
          <DialogTitle className="text-base">Chọn ảnh từ thư viện</DialogTitle>
          <DialogDescription>
            Ảnh đã có trong thư viện tài liệu. Chọn lại thay vì tải lên bản mới.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b px-5 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={tuKhoa}
              onChange={(e) => setTuKhoa(e.target.value)}
              placeholder="Tìm theo tên tài liệu…"
              className="h-9 pl-8 text-sm"
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1 [&>div]:!block">
          {q.isLoading ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải thư viện…
            </p>
          ) : hienThi.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
              <ImageOff className="h-6 w-6" />
              {q.data?.total ? `Không có ảnh nào khớp "${tuKhoa}"` : 'Thư viện chưa có ảnh nào'}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2.5 p-4 sm:grid-cols-5">
              {hienThi.map((a) => {
                const co = daCo.includes(a.url)
                const dangChon = chon.includes(a.url)
                return (
                  <button
                    key={a.url}
                    type="button"
                    disabled={co}
                    onClick={() => bat(a.url)}
                    title={co ? `${a.title} — sản phẩm này đã có ảnh này` : a.title}
                    className={cn(
                      'group relative aspect-square overflow-hidden rounded-md border-2 bg-muted transition-colors',
                      dangChon ? 'border-primary' : 'border-transparent hover:border-primary/50',
                      co && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    <img src={assetUrl(a.url)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    {dangChon && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                    {co && (
                      <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-[9px] text-white">
                        đã có
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/45 px-1 py-0.5 text-left text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {a.title}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="border-t px-5 py-3">
          <span className="mr-auto text-xs text-muted-foreground">
            {chon.length ? `Đã chọn ${chon.length} ảnh` : 'Bấm vào ảnh để chọn, chọn được nhiều tấm'}
          </span>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button size="sm" disabled={!chon.length} onClick={xong}>
            Thêm {chon.length || ''} ảnh
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
