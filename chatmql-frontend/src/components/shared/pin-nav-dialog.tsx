/**
 * pin-nav-dialog.tsx — Chọn module nào ghim lên thanh menu ngang.
 *
 * Trước đây thanh menu tự xếp theo bề rộng màn hình: vừa được bao nhiêu thì
 * hiện bấy nhiêu, phần còn lại rơi vào "Xem thêm". Ai dùng nhiều CDP mà nó nằm
 * cuối danh sách thì lần nào cũng phải mở menu phụ.
 *
 * Ghim là sở thích của từng người, lưu ở máy họ. Không đồng bộ lên máy chủ:
 * cùng một tài khoản dùng máy bàn 27 inch và laptop 13 inch thì số module vừa
 * màn hình đã khác nhau rồi.
 */
import { useState } from 'react'
import { Check, Pin } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'
import type { NavItem } from './nav-config'

export function PinNavDialog({
  open, onOpenChange, nav,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  nav: NavItem[]
}) {
  const pinnedNav = useUiStore((s) => s.pinnedNav)
  const setPinnedNav = useUiStore((s) => s.setPinnedNav)

  // Chưa cấu hình thì coi như đang ghim tất cả — đúng với thứ người dùng thấy.
  const [chon, setChon] = useState<string[]>(() => pinnedNav ?? nav.map((n) => n.to))

  const bat = (to: string) =>
    setChon((v) => (v.includes(to) ? v.filter((x) => x !== to) : [...v, to]))

  const luu = () => {
    setPinnedNav(chon)
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (v) setChon(pinnedNav ?? nav.map((n) => n.to)); onOpenChange(v) }}
    >
      <DialogContent className="flex max-h-[76vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b px-5 py-3 pr-14">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Pin className="h-4 w-4" /> Ghim module lên thanh menu
          </DialogTitle>
          <DialogDescription>
            Module bỏ ghim vẫn dùng được, chỉ nằm trong menu “Xem thêm”.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 [&>div]:!block">
          <div className="space-y-0.5 p-2">
            {nav.map((item) => {
              const Icon = item.icon
              const ghim = chon.includes(item.to)
              return (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => bat(item.to)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    ghim ? 'bg-accent' : 'hover:bg-accent/50',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      ghim ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                    )}
                  >
                    {ghim && <Check className="h-3 w-3" />}
                  </span>
                </button>
              )
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row items-center gap-2 border-t px-5 py-3">
          <span className="mr-auto text-xs text-muted-foreground">
            Đang ghim {chon.length}/{nav.length}
          </span>
          {/* Đường quay về mặc định: bỏ cấu hình chứ không ghim lại tất cả, để
              thanh menu trở lại kiểu tự xếp theo bề rộng như ban đầu. */}
          <Button variant="ghost" size="sm" onClick={() => { setPinnedNav(null); onOpenChange(false) }}>
            Về mặc định
          </Button>
          <Button size="sm" onClick={luu}>Lưu</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
