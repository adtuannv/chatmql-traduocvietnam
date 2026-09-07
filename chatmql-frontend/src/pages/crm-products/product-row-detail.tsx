/**
 * product-row-detail.tsx — Hàng mở rộng của một sản phẩm ở trang Sản phẩm.
 *
 * Bấm vào dòng là bung ra toàn bộ thông tin ngay tại chỗ, sửa và lưu cũng ở
 * đó — không nhảy sang trang khác rồi phải bấm quay lại, vì người dùng thường
 * xem và sửa liên tiếp nhiều sản phẩm.
 *
 * Chia rõ hai khối vì hai nguồn sở hữu khác nhau:
 *   • Từ hệ thống nguồn — chỉ đọc. Sửa ở đây là vô nghĩa: lần đồng bộ sau ghi
 *     đè hết. Muốn đổi giá hay tên thì sửa bên hệ thống sản phẩm.
 *   • ChatMQL quản lý — sửa được: mô tả bán hàng, từ khoá, ảnh, video, mã
 *     Mini App. Đây là phần đội ngũ tự soạn để bán và cho AI đọc.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, ExternalLink, Loader2, Lock, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/misc'
import { apiError } from '@/lib/api-client'
import { formatNumber } from '@/lib/utils'
import { formatVnd } from '@/lib/order-calc'
import { useProductDoc, useSaveProductDoc } from '@/hooks/use-product-docs'
import { type CrmProduct } from '@/hooks/use-crm-products'
import { MiniAppCell } from './miniapp-cell'

/** Một ô thông tin chỉ đọc. */
function O({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] font-semibold text-muted-foreground">{nhan}</span>
      <span className="mt-px block break-words text-[13px]">{children || '—'}</span>
    </div>
  )
}

/** Mỗi dòng một đường dẫn — dán được cả danh sách mà không cần ô riêng từng cái. */
function tachDong(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter(Boolean)
}

export function ProductRowDetail({
  p, mauLink, soCot,
}: { p: CrmProduct; mauLink: string; soCot: number }) {
  const ma = p.code ?? ''
  const docQ = useProductDoc(ma || undefined)
  const luu = useSaveProductDoc()
  const doc = docQ.data

  const [sua, setSua] = useState(false)
  const [moTa, setMoTa] = useState('')
  const [tuKhoa, setTuKhoa] = useState('')
  const [anh, setAnh] = useState('')
  const [video, setVideo] = useState('')

  // Nạp lại mỗi khi tài liệu đổi, kể cả sau khi lưu — nếu không thì ô nhập giữ
  // giá trị cũ và lần sửa sau ghi đè bằng dữ liệu lỗi thời.
  useEffect(() => {
    setMoTa(doc?.description ?? '')
    setTuKhoa(doc?.keywords ?? '')
    setAnh((doc?.images ?? []).join('\n'))
    setVideo((doc?.videoUrls ?? []).join('\n'))
  }, [doc])

  const ghi = () => {
    if (!ma) { toast.error('Sản phẩm chưa có mã nên chưa lưu được tài liệu'); return }
    luu.mutate(
      {
        code: ma,
        data: {
          name: p.name,
          description: moTa.trim() || null,
          keywords: tuKhoa.trim() || null,
          images: tachDong(anh),
          videoUrls: tachDong(video),
        },
      },
      {
        onSuccess: () => { toast.success('Đã lưu tài liệu sản phẩm'); setSua(false) },
        onError: (e) => toast.error(`Không lưu được: ${apiError(e)}`),
      },
    )
  }

  const huy = () => {
    setMoTa(doc?.description ?? '')
    setTuKhoa(doc?.keywords ?? '')
    setAnh((doc?.images ?? []).join('\n'))
    setVideo((doc?.videoUrls ?? []).join('\n'))
    setSua(false)
  }

  return (
    <tr className="border-t bg-muted/25">
      <td colSpan={soCot} className="px-4 py-4">
        <div className="grid gap-5 lg:grid-cols-2">
          {/* ── Từ hệ thống nguồn ── */}
          <section className="space-y-2.5">
            <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <Lock className="h-3 w-3" /> Từ hệ thống nguồn · chỉ đọc
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border bg-card p-3 sm:grid-cols-3">
              <O nhan="Mã sản phẩm"><span className="font-mono text-[12px]">{p.code}</span></O>
              <O nhan="Đơn vị">{p.unit}</O>
              <O nhan="Giá bán"><b>{p.price != null ? formatVnd(p.price) : '—'}</b></O>
              <O nhan="Thuế">{p.vatNote}</O>
              <O nhan="Khối lượng">{p.weight != null ? `${formatNumber(p.weight)} g` : '—'}</O>
              <O nhan="Tồn kho">
                {p.inventory != null && p.inventory > 0
                  ? <span className="font-semibold text-success">{formatNumber(p.inventory)}</span>
                  : <span className="text-muted-foreground">Không theo dõi</span>}
              </O>
              <O nhan="Thương hiệu">{p.brand}</O>
              <O nhan="Danh mục">{p.categoryName}</O>
              <O nhan="Kho">{p.warehouseName ?? (p.warehouseId != null ? `#${p.warehouseId}` : '—')}</O>
              <div className="col-span-2 sm:col-span-3">
                <O nhan="Tên đầy đủ">{p.name}</O>
              </div>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Muốn đổi giá, tên hay tồn kho thì sửa bên hệ thống sản phẩm — sửa ở đây sẽ bị
              lần đồng bộ sau ghi đè.
            </p>
          </section>

          {/* ── ChatMQL quản lý ── */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                ChatMQL quản lý · sửa được
              </h4>
              {!sua ? (
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11.5px]"
                        onClick={() => setSua(true)} disabled={!ma}>
                  <Pencil className="h-3 w-3" /> Sửa
                </Button>
              ) : (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11.5px]"
                          onClick={huy} disabled={luu.isPending}>
                    <X className="h-3 w-3" /> Huỷ
                  </Button>
                  <Button size="sm" className="h-7 gap-1 px-2 text-[11.5px]"
                          onClick={ghi} disabled={luu.isPending}>
                    {luu.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Lưu
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-[11px] font-semibold text-muted-foreground">Link Mini App</Label>
                <MiniAppCell p={p} mauLink={mauLink} />
              </div>

              {!ma && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                  Sản phẩm chưa có mã nên chưa gắn được tài liệu — tài liệu ghép với sản phẩm bằng mã.
                </p>
              )}

              {sua ? (
                <>
                  <div className="grid gap-1.5">
                    <Label className="text-[11px]">Mô tả bán hàng</Label>
                    <Textarea rows={4} value={moTa} onChange={(e) => setMoTa(e.target.value)}
                              placeholder="Nội dung sale dùng để tư vấn và AI đọc khi trả lời khách…"
                              className="text-[13px]" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-[11px]">Từ khoá / tên gọi khác</Label>
                    <Input value={tuKhoa} onChange={(e) => setTuKhoa(e.target.value)}
                           placeholder="trà đinh, chè đinh ngọc, quà biếu…" className="h-8 text-[13px]" />
                    <p className="text-[10.5px] text-muted-foreground">
                      Giúp AI tìm đúng sản phẩm khi khách gọi bằng tên khác.
                    </p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-[11px]">Ảnh — mỗi dòng một đường dẫn</Label>
                    <Textarea rows={3} value={anh} onChange={(e) => setAnh(e.target.value)}
                              className="font-mono text-[11.5px]" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-[11px]">Video — mỗi dòng một đường dẫn</Label>
                    <Textarea rows={2} value={video} onChange={(e) => setVideo(e.target.value)}
                              className="font-mono text-[11.5px]" />
                  </div>
                </>
              ) : docQ.isLoading ? (
                <p className="py-2 text-[12px] text-muted-foreground">Đang tải tài liệu…</p>
              ) : (
                <>
                  <O nhan="Mô tả bán hàng">
                    {doc?.description
                      ? <span className="whitespace-pre-wrap">{doc.description}</span>
                      : <span className="text-muted-foreground">Chưa có — bấm Sửa để soạn</span>}
                  </O>
                  <O nhan="Từ khoá">{doc?.keywords}</O>
                  <div>
                    <span className="block text-[11px] font-semibold text-muted-foreground">
                      Ảnh {doc?.images?.length ? `(${doc.images.length})` : ''}
                    </span>
                    {doc?.images?.length ? (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {doc.images.slice(0, 6).map((u, i) => (
                          <img key={`${u}-${i}`} src={u} alt="" loading="lazy"
                               className="h-12 w-12 rounded border object-cover" />
                        ))}
                      </div>
                    ) : <span className="text-[13px] text-muted-foreground">—</span>}
                  </div>
                  {!!doc?.videoUrls?.length && (
                    <div>
                      <span className="block text-[11px] font-semibold text-muted-foreground">Video</span>
                      {doc.videoUrls.map((v, i) => (
                        <a key={`${v}-${i}`} href={v} target="_blank" rel="noreferrer"
                           className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-primary hover:underline">
                          <ExternalLink className="h-3 w-3 shrink-0" />{v}
                        </a>
                      ))}
                    </div>
                  )}
                  {doc?.updatedAt && (
                    <Badge variant="secondary" className="text-[10px]">
                      Cập nhật {new Date(doc.updatedAt).toLocaleDateString('vi-VN')}
                    </Badge>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </td>
    </tr>
  )
}
