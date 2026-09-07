import { toast } from 'sonner'
import dayjs from 'dayjs'
import { Building2, Plus, Loader2, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Loading, ErrorState, EmptyState } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import {
  useZaloAccounts,
  useConnectZaloOa,
  useDeleteZaloAccount,
  useZaloOaConfig,
  statusMeta,
} from '@/hooks/use-integrations'
import { ChannelCard } from './channel-card'
import { ChannelSetupGuide } from './channel-setup-guide'
import type { OaConfigStatus } from '@/hooks/use-integrations'


/** Hiện khi backend chưa có khoá ứng dụng Zalo OA. */
function OaSetupGuide({ cfg }: { cfg: OaConfigStatus }) {
  return (
    <ChannelSetupGuide
      title="Chưa cấu hình ứng dụng Zalo OA"
      intro="Toàn bộ phần xử lý phía máy chủ đã sẵn sàng (uỷ quyền OAuth, làm mới token, webhook, cửa sổ chăm sóc khách hàng, ZNS). Chỉ còn thiếu khoá ứng dụng."
      steps={[
        <>
          Tạo ứng dụng tại{' '}
          <a href="https://developers.zalo.me/createapp" target="_blank" rel="noreferrer" className="font-medium text-primary underline">
            developers.zalo.me/createapp
          </a>{' '}
          rồi liên kết Official Account của công ty vào ứng dụng đó.
        </>,
        <>Trong mục <strong>Official Account API</strong>, khai hai đường dẫn bên dưới.</>,
        <>
          Lấy <strong>App ID</strong> và <strong>Secret Key</strong>, đặt vào{' '}
          <code className="rounded bg-background px-1">bizcrm_backend_source/.env</code> rồi khởi động lại backend.
        </>,
      ]}
      copyItems={[
        { label: 'Callback URL (mục Official Account API)', value: cfg.redirectUri },
        { label: 'Webhook URL (mục Webhook)', value: cfg.webhookUrl },
      ]}
      missing={cfg.missing.map((k) => `${k}=`)}
      footnote={
        <>
          Zalo chỉ chấp nhận đường dẫn <strong>công khai qua HTTPS</strong> — chạy máy cục bộ phải
          mở đường hầm (ngrok, Cloudflare Tunnel) rồi đặt{' '}
          <code className="rounded bg-background px-1">PUBLIC_API_URL</code> trỏ tới đó.
          {!cfg.webhookStrict && ' Webhook đang ở chế độ nới lỏng — bật OA_WEBHOOK_STRICT=true khi lên thật.'}
        </>
      }
    />
  )
}

export function ZaloOaTab() {
  const { data, isLoading, isError } = useZaloAccounts('oa')
  const { data: cfg } = useZaloOaConfig()
  const connect = useConnectZaloOa()
  const remove = useDeleteZaloAccount()

  const handleConnect = () => {
    connect.mutate(undefined, {
      onSuccess: (url) => {
        // Redirect sang trang uỷ quyền OAuth của Zalo
        window.location.href = url
      },
      onError: (e) => toast.error(apiError(e)),
    })
  }

  const handleDisconnect = (id: string) => {
    remove.mutate(id, {
      onSuccess: () => toast.success('Đã ngắt kết nối OA'),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Kết nối Official Account (OA) để gửi/nhận tin nhắn qua Zalo OA API.
        </p>
        <Button onClick={handleConnect} disabled={connect.isPending || cfg?.configured === false}>
          {connect.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          Kết nối OA
        </Button>
      </div>

      {cfg && !cfg.configured && <OaSetupGuide cfg={cfg} />}

      {isLoading ? (
        <Loading label="Đang tải Zalo OA..." />
      ) : isError ? (
        <ErrorState />
      ) : !data?.length ? (
        <EmptyState
          icon={Building2}
          title="Chưa kết nối OA nào"
          description="Nhấn Kết nối OA và cấp quyền cho ứng dụng trên trang Zalo."
        />
      ) : (
        <div className="space-y-3">
          {data.map((acc) => (
            <ChannelCard
              key={acc.id}
              icon={<Building2 className="h-5 w-5" />}
              avatarUrl={acc.avatarUrl}
              title={acc.displayName || 'Zalo OA'}
              subtitle={
                <>
                  {acc.externalPageId ? `OA ID ${acc.externalPageId} · ` : ''}
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
