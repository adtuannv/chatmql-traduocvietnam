import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, QrCode, AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getSocket } from '@/lib/socket'
import { initials } from '@/lib/utils'

// Payload các sự kiện Socket.IO (khớp backend zalo-pool.ts)
interface QrPayload {
  accountId: string
  image: string
  code?: string
}
interface ScannedPayload {
  accountId: string
  avatar?: string | null
  displayName?: string | null
}
interface ConnectedPayload {
  accountId: string
}
interface ErrorPayload {
  accountId: string
  message: string
}

type Phase = 'waiting' | 'qr' | 'scanned' | 'connected' | 'error'

/** Chuẩn hoá chuỗi base64 QR thành data URL để hiển thị. */
function toImageSrc(image: string): string {
  return image.startsWith('data:') ? image : `data:image/png;base64,${image}`
}

/**
 * Hộp thoại đăng nhập Zalo cá nhân bằng QR.
 * Lắng nghe realtime `zalo:qr` / `zalo:scanned` / `zalo:connected` / `zalo:error`
 * cho đúng `accountId`, và gỡ listener khi đóng/unmount.
 */
export function QrLoginDialog({
  accountId,
  open,
  onOpenChange,
}: {
  accountId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const [phase, setPhase] = useState<Phase>('waiting')
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [scanned, setScanned] = useState<ScannedPayload | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !accountId) return

    // Reset trạng thái mỗi lần mở cho một account mới
    setPhase('waiting')
    setQrImage(null)
    setScanned(null)
    setErrorMsg(null)

    const socket = getSocket()

    const onQr = (p: QrPayload) => {
      if (p.accountId !== accountId) return
      setQrImage(toImageSrc(p.image))
      setPhase('qr')
    }
    const onQrExpired = (p: ConnectedPayload) => {
      if (p.accountId !== accountId) return
      // Backend tự tạo QR mới — chỉ tạm ẩn ảnh cũ
      setQrImage(null)
      setPhase('waiting')
    }
    const onScanned = (p: ScannedPayload) => {
      if (p.accountId !== accountId) return
      setScanned(p)
      setPhase('scanned')
    }
    const onConnected = (p: ConnectedPayload) => {
      if (p.accountId !== accountId) return
      setPhase('connected')
      qc.invalidateQueries({ queryKey: ['integrations', 'zalo-accounts'] })
      toast.success('Kết nối Zalo thành công')
      // Đóng sau khi người dùng kịp thấy trạng thái thành công
      setTimeout(() => onOpenChange(false), 1200)
    }
    const onError = (p: ErrorPayload) => {
      if (p.accountId !== accountId) return
      setErrorMsg(p.message || 'Kết nối thất bại')
      setPhase('error')
      toast.error(p.message || 'Kết nối Zalo thất bại')
    }

    socket.on('zalo:qr', onQr)
    socket.on('zalo:qr-expired', onQrExpired)
    socket.on('zalo:scanned', onScanned)
    socket.on('zalo:connected', onConnected)
    socket.on('zalo:error', onError)

    return () => {
      socket.off('zalo:qr', onQr)
      socket.off('zalo:qr-expired', onQrExpired)
      socket.off('zalo:scanned', onScanned)
      socket.off('zalo:connected', onConnected)
      socket.off('zalo:error', onError)
    }
  }, [open, accountId, qc, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kết nối Zalo cá nhân</DialogTitle>
          <DialogDescription>
            Mở Zalo trên điện thoại, vào Cài đặt → Quét mã QR và quét mã bên dưới.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 py-2">
          {phase === 'waiting' && (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Đang tạo mã QR...</p>
            </div>
          )}

          {phase === 'qr' && qrImage && (
            <>
              <div className="rounded-xl border bg-card p-3">
                <img
                  src={qrImage}
                  alt="Mã QR đăng nhập Zalo"
                  className="h-56 w-56 object-contain"
                />
              </div>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <QrCode className="h-4 w-4" /> Đang chờ quét mã...
              </p>
            </>
          )}

          {phase === 'scanned' && (
            <div className="flex flex-col items-center gap-3 text-center">
              <Avatar className="h-16 w-16">
                {scanned?.avatar && <AvatarImage src={scanned.avatar} alt="" />}
                <AvatarFallback>{initials(scanned?.displayName)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{scanned?.displayName || 'Đã quét mã'}</p>
                <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Đang hoàn tất đăng nhập...
                </p>
              </div>
            </div>
          )}

          {phase === 'connected' && (
            <div className="flex flex-col items-center gap-3 text-center text-success">
              <CheckCircle2 className="h-12 w-12" />
              <p className="font-medium">Kết nối thành công!</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col items-center gap-3 text-center">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
