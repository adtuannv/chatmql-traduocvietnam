import { useMemo } from 'react'
import { toast } from 'sonner'
import dayjs from 'dayjs'
import { Facebook, Plus, Loader2, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Loading, ErrorState, EmptyState } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import {
  useZaloAccounts,
  useConnectFacebookPage,
  useDeleteZaloAccount,
  useFacebookConfig,
  statusMeta,
  PLATFORM,
  type FbConfigStatus,
} from '@/hooks/use-integrations'
import { ChannelCard } from './channel-card'
import { ChannelSetupGuide } from './channel-setup-guide'

/** Hiện khi backend chưa có khoá ứng dụng Meta. */
function FbSetupGuide({ cfg }: { cfg: FbConfigStatus }) {
  return (
    <ChannelSetupGuide
      title="Chưa cấu hình ứng dụng Facebook"
      intro={`Máy chủ đã sẵn sàng: đổi token ngắn hạn sang dài hạn (~60 ngày), tự đăng ký webhook cho từng Fanpage, kiểm chữ ký HMAC. Đang dùng Graph API ${cfg.graphVersion}. Chỉ còn thiếu khoá ứng dụng.`}
      steps={[
        <>
          Tạo ứng dụng loại <strong>Business</strong> tại{' '}
          <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="font-medium text-primary underline">
            developers.facebook.com/apps
          </a>{' '}
          rồi thêm sản phẩm <strong>Messenger</strong>.
        </>,
        <>
          Trong <strong>Facebook Login → Settings</strong>, dán Callback URL bên dưới vào ô
          <em> Valid OAuth Redirect URIs</em>.
        </>,
        <>
          Trong <strong>Messenger → Webhooks</strong>, dán Webhook URL và Verify Token bên dưới,
          rồi đăng ký các trường: <code className="rounded bg-background px-1">{cfg.webhookFields.join(', ')}</code>.
        </>,
        <>
          Xin duyệt các quyền: <code className="rounded bg-background px-1">{cfg.scopes.join(', ')}</code>.
          Chưa duyệt thì chỉ tài khoản có vai trò trong ứng dụng mới kết nối được.
        </>,
        <>
          Lấy <strong>App ID</strong> và <strong>App Secret</strong>, đặt vào{' '}
          <code className="rounded bg-background px-1">bizcrm_backend_source/.env</code> rồi khởi động lại backend.
        </>,
      ]}
      copyItems={[
        { label: 'Valid OAuth Redirect URI', value: cfg.redirectUri },
        { label: 'Webhook URL (Callback URL)', value: cfg.webhookUrl },
        ...(cfg.suggestedVerifyToken
          ? [{ label: 'Verify Token — tự đặt, dán giống nhau ở cả .env và Meta', value: cfg.suggestedVerifyToken }]
          : []),
      ]}
      missing={cfg.missing.map((k) =>
        k === 'FACEBOOK_WEBHOOK_VERIFY_TOKEN' && cfg.suggestedVerifyToken
          ? `${k}=${cfg.suggestedVerifyToken}`
          : `${k}=`,
      )}
      footnote={
        <>
          Meta bắt buộc Webhook URL phải là <strong>HTTPS công khai</strong> và tự gọi thử ngay khi
          lưu — chạy máy cục bộ phải mở đường hầm trước, rồi đặt{' '}
          <code className="rounded bg-background px-1">PUBLIC_API_URL</code> trỏ tới đó.
          Khác Zalo OA, webhook Facebook <strong>luôn bắt buộc chữ ký</strong>: sai chữ ký trả 401,
          không có chế độ nới lỏng.
        </>
      }
    />
  )
}

export function FacebookPageTab() {
  // Không có endpoint riêng cho Facebook — dùng danh sách kênh tổng rồi lọc theo platform.
  const { data, isLoading, isError } = useZaloAccounts()
  const { data: cfg } = useFacebookConfig()
  const connect = useConnectFacebookPage()
  const remove = useDeleteZaloAccount()

  const pages = useMemo(
    () => (data ?? []).filter((a) => a.platform === PLATFORM.FACEBOOK_PAGE),
    [data],
  )

  const handleConnect = () => {
    connect.mutate(undefined, {
      onSuccess: (url) => {
        window.location.href = url
      },
      onError: (e) => toast.error(apiError(e)),
    })
  }

  const handleDisconnect = (id: string) => {
    remove.mutate(id, {
      onSuccess: () => toast.success('Đã ngắt kết nối Fanpage'),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Kết nối Fanpage để nhận và trả lời tin nhắn Messenger ngay trong hệ thống.
        </p>
        <Button onClick={handleConnect} disabled={connect.isPending || cfg?.configured === false}>
          {connect.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          Kết nối Fanpage
        </Button>
      </div>

      {cfg && !cfg.configured && <FbSetupGuide cfg={cfg} />}

      {isLoading ? (
        <Loading label="Đang tải Fanpage..." />
      ) : isError ? (
        <ErrorState />
      ) : !pages.length ? (
        <EmptyState
          icon={Facebook}
          title="Chưa kết nối Fanpage nào"
          description="Nhấn Kết nối Fanpage và chọn các trang bạn quản lý trên Facebook."
        />
      ) : (
        <div className="space-y-3">
          {pages.map((acc) => (
            <ChannelCard
              key={acc.id}
              icon={<Facebook className="h-5 w-5" />}
              avatarUrl={acc.avatarUrl}
              title={acc.displayName || 'Facebook Page'}
              subtitle={
                <>
                  {acc.externalPageId ? `Page ID ${acc.externalPageId} · ` : ''}
                  {acc.lastConnectedAt
                    ? `Kết nối lần cuối ${dayjs(acc.lastConnectedAt).format('DD/MM/YYYY HH:mm')}`
                    : 'Chưa từng kết nối'}
                </>
              }
              status={statusMeta(acc.liveStatus, acc.isDisabled)}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDisconnect(acc.id)}
                  disabled={remove.isPending}
                  title="Ngắt kết nối"
                >
                  <Unplug />
                </Button>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
