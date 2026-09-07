import { useState } from 'react'
import { BackfillAccountButton, BackfillProgressLine } from './backfill-account-button'
import { toast } from 'sonner'
import dayjs from 'dayjs'
import { MessageCircle, Plus, RefreshCw, LogIn, Unplug, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Loading, ErrorState, EmptyState } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import {
  useZaloAccounts,
  useConnectZalo,
  useZaloLogin,
  useZaloReconnect,
  useDeleteZaloAccount,
  statusMeta,
  type ChannelAccount,
} from '@/hooks/use-integrations'
import { useAuthStore } from '@/stores/auth-store'
import { ChannelCard } from './channel-card'
import { BusinessSwitch } from './business-badge'
import { QrLoginDialog } from './qr-login-dialog'

export function ZaloPersonalTab() {
  const { data, isLoading, isError } = useZaloAccounts('personal')
  const role = useAuthStore((s) => s.user?.role)
  const suaDuoc = role === 'owner' || role === 'admin'
  const connect = useConnectZalo()
  const login = useZaloLogin()
  const reconnect = useZaloReconnect()
  const remove = useDeleteZaloAccount()

  const [qrAccountId, setQrAccountId] = useState<string | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [toDelete, setToDelete] = useState<ChannelAccount | null>(null)

  const openQr = (accountId: string) => {
    setQrAccountId(accountId)
    setQrOpen(true)
  }

  const handleConnect = () => {
    connect.mutate(undefined, {
      onSuccess: (res) => openQr(res.accountId),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  const handleRelogin = (acc: ChannelAccount) => {
    login.mutate(acc.id, {
      onSuccess: () => openQr(acc.id),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  const handleReconnect = (acc: ChannelAccount) => {
    reconnect.mutate(acc.id, {
      onSuccess: () => toast.success('Đang kết nối lại bằng phiên đã lưu...'),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  const handleDelete = () => {
    if (!toDelete) return
    remove.mutate(toDelete.id, {
      onSuccess: () => {
        toast.success('Đã ngắt kết nối tài khoản')
        setToDelete(null)
      },
      onError: (e) => toast.error(apiError(e)),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Kết nối tài khoản Zalo cá nhân bằng mã QR để đồng bộ hội thoại và bạn bè.
        </p>
        <Button onClick={handleConnect} disabled={connect.isPending}>
          {connect.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Plus />
          )}
          Kết nối
        </Button>
      </div>

      {isLoading ? (
        <Loading label="Đang tải tài khoản Zalo..." />
      ) : isError ? (
        <ErrorState />
      ) : !data?.length ? (
        <EmptyState
          icon={MessageCircle}
          title="Chưa có tài khoản Zalo cá nhân"
          description="Nhấn Kết nối và quét mã QR bằng ứng dụng Zalo trên điện thoại."
        />
      ) : (
        <div className="space-y-3">
          {data.map((acc) => {
            const st = acc.liveStatus
            const isConnected = st === 'connected' && !acc.isDisabled
            return (
              <ChannelCard
                key={acc.id}
                icon={<MessageCircle className="h-5 w-5" />}
                avatarUrl={acc.avatarUrl}
                title={acc.displayName || acc.phone || 'Tài khoản Zalo'}
                subtitle={
                  <>
                    {/* Business hay thường quyết định hạn mức gửi, nên để ngay
                        dòng đầu chứ không giấu trong menu. */}
                    <span className="mr-1.5 inline-flex translate-y-[1px] align-middle">
                      <BusinessSwitch acc={acc} canEdit={suaDuoc} />
                    </span>
                    {acc.phone ? `${acc.phone} · ` : ''}
                    {acc.lastConnectedAt
                      ? `Kết nối lần cuối ${dayjs(acc.lastConnectedAt).format('DD/MM/YYYY HH:mm')}`
                      : 'Chưa từng kết nối'}
                    <BackfillProgressLine accountId={acc.id} />
                  </>
                }
                status={statusMeta(st, acc.isDisabled)}
                actions={
                  <>
                    {isConnected && <BackfillAccountButton accountId={acc.id} />}
                    {!isConnected && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReconnect(acc)}
                          disabled={reconnect.isPending}
                          title="Kết nối lại bằng phiên đã lưu"
                        >
                          <RefreshCw /> Kết nối lại
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRelogin(acc)}
                          disabled={login.isPending}
                        >
                          <LogIn /> Đăng nhập QR
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setToDelete(acc)}
                      title="Ngắt kết nối"
                    >
                      <Unplug />
                    </Button>
                  </>
                }
              />
            )
          })}
        </div>
      )}

      <QrLoginDialog accountId={qrAccountId} open={qrOpen} onOpenChange={setQrOpen} />

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ngắt kết nối tài khoản?</DialogTitle>
            <DialogDescription>
              Phiên đăng nhập Zalo sẽ bị ngắt. Lịch sử hội thoại vẫn được giữ lại (chỉ đọc).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="animate-spin" />}
              Ngắt kết nối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
