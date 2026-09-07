/**
 * miniapp-cell.tsx — Ô ghép mã Zalo Mini App cho một sản phẩm.
 *
 * Chỗ để đội ngũ tự bổ sung link mà không phải nhờ kỹ thuật. Ghép xong là nút
 * Gửi ở tab Sản phẩm trong hội thoại mở khoá ngay.
 *
 * CHỌN TỪ DANH SÁCH chứ không bắt gõ tay: mã Mini App có dạng
 * `FX/TP-CC03-100/KR-ZL`, gõ tay là sai chính tả rồi khách bấm vào link hỏng
 * mà không ai biết. Danh sách lấy thẳng từ hệ quản trị Mini App.
 *
 * Ô này cũng gợi ý sẵn ứng viên gần đúng theo tên và giá, vì một dòng trà có
 * tới ba bốn quy cách đóng gói và mỗi quy cách là một mã riêng.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, ExternalLink, Link2, Loader2, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/misc'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatVnd } from '@/lib/order-calc'
import { apiError } from '@/lib/api-client'
import {
  useMiniAppCatalog, useSetMiniAppId, type CrmProduct, type MiniAppItem,
} from '@/hooks/use-crm-products'

/** Bỏ dấu và ký tự thừa để so tên hai bên, vì cách đặt tên không giống nhau. */
function chuan(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Xếp ứng viên: giá trùng và tên trùng lên trước — đó là cặp đáng tin nhất. */
function xepUngVien(items: MiniAppItem[], p: CrmProduct, tuKhoa: string): MiniAppItem[] {
  const tenSp = chuan(p.name)
  const tu = chuan(tuKhoa)
  const loc = tu
    ? items.filter((i) => chuan(i.name).includes(tu) || i.id.toLowerCase().includes(tuKhoa.toLowerCase()))
    : items
  return [...loc].sort((a, b) => diem(b) - diem(a))

  function diem(i: MiniAppItem): number {
    let d = 0
    const ten = chuan(i.name)
    if (p.price != null && i.price === p.price) d += 4
    if (ten.startsWith(tenSp) || tenSp.startsWith(ten)) d += 3
    else if (tenSp && ten.includes(tenSp.split(' ')[0])) d += 1
    if (i.active) d += 1
    return d
  }
}

export function MiniAppCell({ p, mauLink }: { p: CrmProduct; mauLink: string }) {
  const [mo, setMo] = useState(false)
  const link = p.miniAppId && mauLink
    ? mauLink.replaceAll('{miniapp}', encodeURIComponent(p.miniAppId))
    : null

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        {p.miniAppId ? (
          <>
            <button
              type="button"
              onClick={() => setMo(true)}
              title="Đổi mã Mini App"
              className="max-w-[168px] truncate rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary hover:bg-primary/20"
            >
              {p.miniAppId}
            </button>
            {link && (
              <a href={link} target="_blank" rel="noreferrer" title="Mở thử link Mini App"
                 className="shrink-0 text-muted-foreground hover:text-primary">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </>
        ) : (
          <Button variant="outline" size="sm" className="h-6 gap-1 px-1.5 text-[11px]"
                  onClick={() => setMo(true)}>
            <Link2 className="h-3 w-3" /> Ghép link
          </Button>
        )}
      </div>
      {mo && <HopThoaiGhep p={p} mauLink={mauLink} onDong={() => setMo(false)} />}
    </>
  )
}

function HopThoaiGhep({
  p, mauLink, onDong,
}: { p: CrmProduct; mauLink: string; onDong: () => void }) {
  const [tuKhoa, setTuKhoa] = useState('')
  const [thuCong, setThuCong] = useState('')
  const catalog = useMiniAppCatalog()
  const luu = useSetMiniAppId()

  const ungVien = useMemo(
    () => xepUngVien(catalog.data?.items ?? [], p, tuKhoa),
    [catalog.data, p, tuKhoa],
  )

  const ghi = (ma: string | null) => {
    if (!p.code) { toast.error('Sản phẩm chưa có mã nên chưa ghép được link'); return }
    luu.mutate({ code: p.code, miniAppId: ma }, {
      onSuccess: () => { toast.success(ma ? `Đã ghép ${ma}` : 'Đã gỡ mã Mini App'); onDong() },
      onError: (e) => toast.error(`Không lưu được: ${apiError(e)}`),
    })
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onDong() }}>
      <DialogContent className="flex h-[70vh] max-h-[70vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-3 pr-14">
          <DialogTitle className="truncate text-base">Ghép link Mini App</DialogTitle>
          <DialogDescription className="truncate">
            {p.name}
            {p.price != null && <> · <b className="text-foreground">{formatVnd(p.price)}</b></>}
            {p.code && <> · <span className="font-mono">{p.code}</span></>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 border-b px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={tuKhoa} onChange={(e) => setTuKhoa(e.target.value)}
                   placeholder="Tìm trong danh mục Mini App…" className="h-9 pl-8 text-sm" />
          </div>
          {p.miniAppId && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
              <span className="text-[11px] text-muted-foreground">Đang ghép:</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{p.miniAppId}</span>
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px] text-destructive"
                      onClick={() => ghi(null)} disabled={luu.isPending}>
                <Trash2 className="h-3 w-3" /> Gỡ
              </Button>
            </div>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1 [&>div]:!block">
          <div className="space-y-1 p-3">
            {catalog.isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Đang tải danh mục…</p>
            ) : ungVien.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Không có mục nào khớp. Nhập tay bên dưới nếu mã chưa có trong danh mục.
              </p>
            ) : (
              ungVien.map((i) => {
                const giaTrung = p.price != null && i.price === p.price
                const dangChon = i.id === p.miniAppId
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => ghi(i.id)}
                    disabled={luu.isPending}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg border p-2 text-left transition-colors',
                      dangChon ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-accent/40',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{i.name}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">{i.id}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn('block text-xs font-semibold tabular-nums',
                                          giaTrung ? 'text-success' : 'text-muted-foreground')}>
                        {formatVnd(i.price)}
                      </span>
                      {giaTrung && <span className="text-[9px] text-success">giá trùng</span>}
                    </span>
                    {!i.active && <Badge variant="secondary" className="shrink-0 text-[9px]">Đang ẩn</Badge>}
                    {dangChon && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                )
              })
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center gap-2 border-t px-5 py-3">
          <Input value={thuCong} onChange={(e) => setThuCong(e.target.value)}
                 placeholder="Hoặc dán mã Mini App vào đây…"
                 className="h-9 flex-1 font-mono text-xs" />
          <Button size="sm" disabled={!thuCong.trim() || luu.isPending}
                  onClick={() => ghi(thuCong.trim())}>
            {luu.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Lưu
          </Button>
          <Button variant="ghost" size="sm" onClick={onDong}><X className="h-3.5 w-3.5" /></Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
