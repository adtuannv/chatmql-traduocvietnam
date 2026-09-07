/**
 * source-switch.tsx — Đổi nguồn dữ liệu sản phẩm ngay trong giao diện.
 *
 * Trước đây đổi nguồn phải sửa tệp cấu hình rồi khởi động lại máy chủ, tức là
 * chỉ kỹ thuật làm được — trong khi "lấy sản phẩm từ đâu" là quyết định vận
 * hành. Nút này để quản trị tự chuyển.
 *
 * Nguồn nào chưa đủ cấu hình trên máy chủ thì hiện rõ là chưa dùng được và
 * không cho chọn, thay vì cho chọn rồi để danh sách trống không rõ lý do.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Database, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { apiError } from '@/lib/api-client'
import {
  SOURCE_LABELS, useSetProductSource, type CrmProductSource, type NguonInfo,
} from '@/hooks/use-crm-products'

/** Nói rõ mỗi nguồn lấy dữ liệu từ đâu và khi nào nên dùng. */
const MO_TA: Record<CrmProductSource, string> = {
  official: 'Hệ thống sản phẩm chính thức của TDVN. Dùng khi dịch vụ này đã chạy — đây là nguồn chuẩn.',
  bridge: 'Đi qua cầu nối ChatMQL ↔ CRM bằng khoá dịch vụ. Khoá không hết hạn.',
  dashboard: 'Gọi API dashboard CRM bằng token đăng nhập. Token hết hạn theo phiên nên chỉ hợp thử nghiệm.',
  local: 'Bảng sản phẩm nội bộ. Dùng tạm khi chưa có API chính thức; sẽ bỏ khi chuyển hẳn.',
}

export function SourceSwitch({ info }: { info: NguonInfo }) {
  const [mo, setMo] = useState(false)
  const doi = useSetProductSource()

  const dungDuoc = (s: CrmProductSource) =>
    s === 'official' ? info.officialConfigured
      : s === 'dashboard' ? info.dashboardConfigured
        : true

  const chon = (s: CrmProductSource | null) => {
    doi.mutate(s, {
      onSuccess: (r: { source: CrmProductSource }) => {
        toast.success(`Đã chuyển sang: ${SOURCE_LABELS[r.source]}`)
        setMo(false)
      },
      onError: (e) => toast.error(apiError(e)),
    })
  }

  if (!info.canEdit) return null

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setMo(true)}>
        <Database className="h-4 w-4" /> Nguồn dữ liệu
      </Button>

      <Dialog open={mo} onOpenChange={setMo}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nguồn dữ liệu sản phẩm</DialogTitle>
            <DialogDescription>
              Chọn nơi hệ thống lấy danh sách sản phẩm, giá và tồn kho. Đổi xong có hiệu lực
              trong vòng vài giây, không cần khởi động lại.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 py-1">
            {info.sources.map((s) => {
              const dang = s === info.source
              const duoc = dungDuoc(s)
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!duoc || doi.isPending}
                  onClick={() => chon(s)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                    dang ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-accent/40',
                    !duoc && 'cursor-not-allowed opacity-55 hover:border-border hover:bg-transparent',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <b className="text-sm">{SOURCE_LABELS[s]}</b>
                      {dang && <Badge className="h-4 px-1.5 text-[10px]">Đang dùng</Badge>}
                      {!duoc && (
                        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                          Chưa cấu hình trên máy chủ
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                      {MO_TA[s]}
                    </span>
                  </span>
                  {dang && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <p className="min-w-0 text-[11px] text-muted-foreground">
              {info.chosenSource
                ? `Đang dùng lựa chọn tại đây. Cấu hình máy chủ là ${SOURCE_LABELS[info.envSource]}.`
                : 'Đang theo cấu hình của máy chủ.'}
            </p>
            {info.chosenSource && (
              <Button variant="ghost" size="sm" className="shrink-0 gap-1.5"
                      disabled={doi.isPending} onClick={() => chon(null)}>
                {doi.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Theo máy chủ
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
