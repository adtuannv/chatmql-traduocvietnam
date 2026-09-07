/**
 * permissions-section.tsx — "Phân quyền".
 *
 * Quyết định ai được vào tài khoản Zalo nào. Đây chính là dữ liệu mà
 * `shared/data-scope.ts` dùng để giới hạn hội thoại và khách hàng của nhân
 * viên, nên sửa ở đây là đổi ngay phạm vi họ nhìn thấy.
 *
 * Backend: GET/POST `/zalo-accounts/:id/access`, DELETE `.../access/:userId`.
 * Mô hình nhị phân — có dòng là có quyền, không phân cấp read/chat/admin.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, ShieldCheck, Wifi, WifiOff } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/misc'
import { Loading, ErrorState, EmptyState } from '@/components/shared/feedback'
import {
  useTeam, useZaloAccess, useGrantZaloAccess, useRevokeZaloAccess,
} from '@/hooks/use-settings'
import { useZaloAccounts } from '@/hooks/use-integrations'
import { apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

export function PermissionsSection() {
  const { data: accounts, isLoading: loadingAccounts, isError } = useZaloAccounts(undefined, true)
  const { data: team } = useTeam()
  const [accountId, setAccountId] = useState<string | undefined>()

  const { data: access, isLoading: loadingAccess } = useZaloAccess(accountId)
  const grant = useGrantZaloAccess()
  const revoke = useRevokeZaloAccess()
  const [busyUser, setBusyUser] = useState<string | null>(null)

  // Chọn sẵn tài khoản đầu tiên để không phải bấm thêm một bước.
  useEffect(() => {
    if (!accountId && accounts?.length) setAccountId(accounts[0].id)
  }, [accounts, accountId])

  if (loadingAccounts) return <Loading label="Đang tải tài khoản…" />
  if (isError) return <ErrorState message="Không tải được danh sách tài khoản Zalo." />
  if (!accounts?.length) {
    return <EmptyState icon={ShieldCheck} title="Chưa kết nối tài khoản Zalo nào" description="Kết nối ở mục Tích hợp trước khi phân quyền." />
  }

  // owner/admin luôn thấy mọi thứ (bỏ qua ACL) → không cần và không nên gán.
  const assignable = (team ?? []).filter(
    (m) => m.status === 'active' && m.role !== 'owner' && m.role !== 'admin',
  )
  const grantedIds = new Set((access ?? []).map((a) => a.userId))
  const selected = accounts.find((a) => a.id === accountId)

  const toggle = async (userId: string, checked: boolean) => {
    if (!accountId) return
    setBusyUser(userId)
    try {
      if (checked) await grant.mutateAsync({ accountId, userId })
      else await revoke.mutateAsync({ accountId, userId })
      toast.success(checked ? 'Đã cấp quyền' : 'Đã thu hồi quyền')
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setBusyUser(null)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* Cột trái: chọn tài khoản Zalo */}
      <Card className="h-fit">
        <CardContent className="p-2">
          <p className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Tài khoản Zalo
          </p>
          <ul className="max-h-[460px] space-y-0.5 overflow-y-auto">
            {accounts.map((a) => {
              const online = (a.liveStatus ?? a.status) === 'connected'
              const active = a.id === accountId
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setAccountId(a.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                      active ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
                    )}
                  >
                    {online
                      ? <Wifi className="h-3.5 w-3.5 shrink-0 text-success" />
                      : <WifiOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate" title={a.displayName ?? ''}>{a.displayName || 'Không tên'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Cột phải: ai được vào tài khoản đang chọn */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">
              {selected?.displayName || 'Chọn một tài khoản'}
            </p>
            <Badge variant="secondary" className="text-[10px]">{grantedIds.size} người</Badge>
          </div>

          <p className="mb-3 text-xs text-muted-foreground">
            Chủ sở hữu và quản trị viên luôn truy cập được mọi tài khoản nên không có trong danh
            sách này. Người được tick sẽ thấy hội thoại chưa ai phụ trách của tài khoản đó.
          </p>

          {loadingAccess ? (
            <Loading label="Đang tải quyền…" />
          ) : assignable.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Chưa có nhân viên nào để phân quyền" description="Thêm nhân sự ở mục Nhân sự." />
          ) : (
            <ul className="divide-y rounded-lg border">
              {assignable.map((m) => {
                const checked = grantedIds.has(m.id)
                const busy = busyUser === m.id
                return (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                    <Checkbox
                      checked={checked}
                      disabled={busy}
                      onCheckedChange={(v) => toggle(m.id, v === true)}
                      aria-label={`Quyền của ${m.fullName || m.email}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.fullName || m.email}</p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : checked ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
