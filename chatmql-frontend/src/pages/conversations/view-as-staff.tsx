/**
 * view-as-staff.tsx — "Xem chế độ nhân viên".
 *
 * Owner/admin chọn một nhân viên để vào thẳng tài khoản của họ, nhằm kiểm tra
 * đúng những gì nhân viên đó nhìn thấy (quyền truy cập tài khoản Zalo, hội
 * thoại được phân, menu bị ẩn…). Dùng lại API sẵn có:
 *   POST /auth/impersonate/:userId   → token của nhân viên (4h, không refresh)
 *   POST /auth/stop-impersonation    → quay lại tài khoản quản trị gốc
 *
 * Backend đã chặn: admin không xem được owner/admin khác, không tự xem mình.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, LogOut, UserCog } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useTeam } from '@/hooks/use-settings'
import { useAuthStore } from '@/stores/auth-store'
import { apiError } from '@/lib/api-client'
import type { Role } from '@/types/api'

/** Nhãn tiếng Việt cho vai trò, hiện kèm tên trong danh sách chọn. */
const ROLE_LABEL: Record<Role, string> = {
  owner: 'Chủ sở hữu',
  admin: 'Quản trị',
  manager: 'Quản lý',
  member: 'Nhân viên',
}

/** Ai được phép bấm nút này (khớp kiểm tra phía backend). */
function canViewAsStaff(role?: Role): boolean {
  return role === 'owner' || role === 'admin'
}


/** Khoá phiên chuyển tài khoản để báo lại sau khi trang nạp xong. */
const SWITCH_MSG_KEY = 'chatmql.accountSwitchMessage'

/**
 * Chuyển tài khoản = NẠP LẠI TOÀN BỘ ỨNG DỤNG.
 *
 * Chỉ đổi token rồi xoá cache react-query là không đủ, đã gây 3 lỗi thấy được:
 *  - URL vẫn giữ /conversations/<id> mà tài khoản mới không có quyền → "Không tải được tin nhắn"
 *  - `queryClient.clear()` gỡ query khi observer đang gắn → kẹt mãi ở "Đang tải danh sách…"
 *  - socket, zustand store và menu vẫn giữ danh tính cũ
 *
 * Nạp lại từ `/` dựng lại sạch mọi thứ theo đúng quyền của tài khoản mới.
 */
function reloadAsNewAccount(message: string): void {
  try {
    sessionStorage.setItem(SWITCH_MSG_KEY, message)
  } catch {
    /* chế độ riêng tư chặn sessionStorage — mất thông báo, không sao */
  }
  window.location.replace('/')
}

/** Màn phủ toàn trang trong lúc đợi trình duyệt nạp lại. */
function SwitchingOverlay({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background/95 backdrop-blur-sm">
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">Đang tải lại hệ thống theo quyền của tài khoản này…</p>
    </div>
  )
}

export function ViewAsStaffButton() {
  const user = useAuthStore((s) => s.user)
  const impersonate = useAuthStore((s) => s.impersonate)
  // Tên tài khoản đang chuyển sang — cũng là cờ bật màn phủ.
  const [switching, setSwitching] = useState<string | null>(null)

  // Đang xem hộ rồi thì banner thoát lo phần còn lại — không lồng thêm cấp nữa.
  const visible = canViewAsStaff(user?.role) && !user?.impersonatedBy

  // HOOK PHẢI GỌI TRƯỚC MỌI `return`. Đặt sau nhánh thoát sớm thì lúc đổi sang
  // tài khoản nhân viên, component render ít hook hơn lần trước → React error #300.
  const { data: team, isLoading, isError } = useTeam(visible)
  const targets = (team ?? []).filter((m) => {
    if (m.id === user?.id || m.status !== 'active') return false
    if (user?.role === 'admin' && (m.role === 'owner' || m.role === 'admin')) return false
    return true
  })

  const handlePick = async (id: string, name: string) => {
    setSwitching(name)
    try {
      await impersonate(id)
      // Không tắt màn phủ ở đây — để nó che cho tới khi trình duyệt nạp xong.
      reloadAsNewAccount(`Đang xem dưới quyền ${name}`)
    } catch (e) {
      setSwitching(null)
      toast.error(apiError(e))
    }
  }

  if (!visible) return null

  if (switching) return <SwitchingOverlay label={`Đang chuyển sang tài khoản ${switching}`} />

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-xs"
          title="Xem hệ thống dưới quyền một nhân viên"
        >
          <UserCog className="h-4 w-4" />
          <span className="hidden sm:inline">Xem chế độ nhân viên</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Vào tài khoản nhân viên để kiểm tra
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isError ? (
          // Không để kẹt mãi ở "Đang tải…" khi API hỏng — phải nói rõ là lỗi.
          <DropdownMenuItem disabled className="text-sm">Không tải được danh sách nhân sự</DropdownMenuItem>
        ) : isLoading ? (
          <DropdownMenuItem disabled className="text-sm">Đang tải danh sách…</DropdownMenuItem>
        ) : targets.length === 0 ? (
          <DropdownMenuItem disabled className="text-sm">Chưa có nhân viên nào phù hợp</DropdownMenuItem>
        ) : (
          targets.map((m) => (
            <DropdownMenuItem
              key={m.id}
              className="text-sm"
              onSelect={() => handlePick(m.id, m.fullName || m.email)}
            >
              <span className="min-w-0 flex-1 truncate">{m.fullName || m.email}</span>
              <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                {ROLE_LABEL[m.role]}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Banner cảnh báo khi đang xem dưới quyền người khác — đặt trên cùng ứng dụng
 * để không bao giờ thao tác nhầm mà tưởng đang là chính mình.
 */
export function ImpersonationBanner() {
  const user = useAuthStore((s) => s.user)
  const stopImpersonation = useAuthStore((s) => s.stopImpersonation)
  const [switching, setSwitching] = useState(false)

  // Banner luôn được gắn ở layout nên là chỗ đáng tin để báo lại kết quả chuyển
  // tài khoản: toast phát trước khi nạp lại trang sẽ chết theo trang.
  useEffect(() => {
    let msg: string | null = null
    try {
      msg = sessionStorage.getItem(SWITCH_MSG_KEY)
      if (msg) sessionStorage.removeItem(SWITCH_MSG_KEY)
    } catch {
      /* bỏ qua */
    }
    if (msg) toast.success(msg)
  }, [])

  if (!user?.impersonatedBy) return null

  const handleStop = async () => {
    setSwitching(true)
    try {
      await stopImpersonation()
      reloadAsNewAccount('Đã quay lại tài khoản quản trị')
    } catch (e) {
      setSwitching(false)
      toast.error(apiError(e))
    }
  }

  if (switching) return <SwitchingOverlay label="Đang quay lại tài khoản quản trị" />

  return (
    <div className="flex items-center justify-center gap-3 bg-warning px-4 py-1.5 text-xs text-warning-foreground">
      <span>
        Đang xem dưới quyền <strong>{user.fullName || user.email}</strong> ({ROLE_LABEL[user.role]})
      </span>
      <button
        type="button"
        onClick={handleStop}
        className="inline-flex items-center gap-1 rounded-md bg-black/15 px-2 py-0.5 font-medium hover:bg-black/25 disabled:opacity-60"
      >
        <LogOut className="h-3 w-3" />
        Quay lại tài khoản gốc
      </button>
    </div>
  )
}
