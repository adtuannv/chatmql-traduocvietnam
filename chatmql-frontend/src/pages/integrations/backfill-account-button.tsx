/**
 * backfill-account-button.tsx — Kéo lịch sử cho CẢ MỘT TÀI KHOẢN Zalo.
 *
 * Khác nút kéo lịch sử ở màn chat: bên đó kéo cho một khách đang mở, ở đây quét
 * toàn bộ hội thoại của tài khoản. Đặt tại màn Tích hợp vì đây là việc làm một
 * lần lúc mới nối tài khoản, không phải thao tác hằng ngày của sale.
 *
 * Chạy NỀN, có thể mất nhiều phút với tài khoản nhiều hội thoại, nên nút hiển
 * thị tiến độ thật từ máy chủ thay vì quay vòng vô nghĩa — không có tiến độ thì
 * người dùng bấm lại lần nữa vì tưởng hỏng.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/misc'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { apiError } from '@/lib/api-client'
import { formatNumber } from '@/lib/utils'
import { useBackfillAccount, useBackfillProgress } from '@/hooks/use-zalo-sync'

const MAC_DINH = 200

export function BackfillAccountButton({
  accountId, disabled,
}: { accountId: string; disabled?: boolean }) {
  const [mo, setMo] = useState(false)
  const [soTin, setSoTin] = useState(String(MAC_DINH))
  const [kemBanBe, setKemBanBe] = useState(false)
  const backfill = useBackfillAccount()
  const tienDo = useBackfillProgress(accountId)

  const dangChay = backfill.isPending || tienDo?.status === 'processing'

  const chay = () => {
    const n = Number.parseInt(soTin, 10)
    const max = Number.isFinite(n) && n > 0 ? n : MAC_DINH
    setMo(false)
    backfill.mutate(
      { accountId, maxMessages: max, includeFriends: kemBanBe },
      {
        onSuccess: () => toast.success(
          'Đã bắt đầu kéo lịch sử. Việc này chạy nền, tiến độ hiện ngay trên nút.',
          { duration: 5000 },
        ),
        onError: (err) => toast.error(apiError(err)),
      },
    )
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || dangChay}
        onClick={() => setMo(true)}
        title="Kéo toàn bộ lịch sử tin nhắn của tài khoản này từ Zalo"
      >
        {dangChay ? <Loader2 className="animate-spin" /> : <Download />}
        {dangChay && tienDo?.total
          ? `Đang kéo ${tienDo.current}/${tienDo.total}`
          : dangChay ? 'Đang kéo…' : 'Kéo lịch sử'}
      </Button>

      <Dialog open={mo} onOpenChange={setMo}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kéo lịch sử cả tài khoản</DialogTitle>
            <DialogDescription>
              Quét mọi hội thoại của tài khoản này và lấy thêm tin nhắn cũ từ Zalo.
              Chỉ ghi vào cơ sở dữ liệu — không gửi gì cho khách và không kích hoạt AI.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="grid gap-2">
              <Label>Số tin tối đa mỗi hội thoại</Label>
              <Input type="number" min={1} max={2000} value={soTin}
                     onChange={(e) => setSoTin(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Càng lớn càng lâu. Lần đầu nên để {MAC_DINH} rồi tăng dần nếu thấy thiếu.
              </p>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Label>Quét thêm theo danh sách bạn bè</Label>
                <p className="text-xs text-muted-foreground">
                  Lấy cả những người chưa từng có hội thoại trong hệ thống. Chậm hơn nhiều.
                </p>
              </div>
              <Switch checked={kemBanBe} onCheckedChange={setKemBanBe} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setMo(false)}>Huỷ</Button>
            <Button onClick={chay} disabled={backfill.isPending}>
              <Download /> Bắt đầu kéo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Dòng tiến độ chi tiết, hiện dưới tên tài khoản khi đang chạy. */
export function BackfillProgressLine({ accountId }: { accountId: string }) {
  const p = useBackfillProgress(accountId)
  if (p?.status !== 'processing') return null
  return (
    <span className="text-[11px] text-primary">
      {' · '}Đang kéo {p.current}/{p.total}
      {p.threadName ? ` — ${p.threadName}` : ''}
      {p.result ? ` (+${formatNumber(p.result.totalInserted)} tin)` : ''}
    </span>
  )
}
