import { useState } from 'react'
import { toast } from 'sonner'
import dayjs from 'dayjs'
import { Layers, KeyRound, Loader2, RefreshCw, Unplug, Plus, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loading, ErrorState, EmptyState } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import {
  usePancakeConfig,
  useSavePancakeToken,
  usePancakePages,
  usePancakeConnected,
  useConnectPancakePage,
  useDisconnectPancakePage,
  useSyncPancakePage,
  statusMeta,
  type PancakePage,
} from '@/hooks/use-integrations'
import { ChannelCard } from './channel-card'

function TokenForm({ hasToken }: { hasToken: boolean }) {
  const [token, setToken] = useState('')
  const save = useSavePancakeToken()

  const handleSave = () => {
    if (!token.trim()) {
      toast.error('Vui lòng nhập User Access Token của Pancake')
      return
    }
    save.mutate(token.trim(), {
      onSuccess: () => {
        toast.success('Đã lưu token Pancake')
        setToken('')
      },
      onError: (e) => toast.error(apiError(e)),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          {hasToken ? 'Cập nhật token Pancake' : 'Cấu hình token Pancake'}
          {hasToken && (
            <Badge variant="success" className="ml-1">
              Đã cấu hình
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Dán User Access Token từ Pancake để hệ thống lấy danh sách trang. Token được mã hoá và
          lưu an toàn.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Pancake User Access Token"
            className="min-w-[240px] flex-1"
          />
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Lưu token
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function AvailablePages() {
  const { data, isLoading, isError } = usePancakePages(true)
  const connect = useConnectPancakePage()

  const handleConnect = (p: PancakePage) => {
    connect.mutate(
      { pageId: p.id, pageName: p.name, platform: p.platform },
      {
        onSuccess: () => toast.success(`Đã kết nối trang ${p.name}`),
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  if (isLoading) return <Loading label="Đang tải danh sách trang Pancake..." />
  if (isError) return <ErrorState message="Không tải được danh sách trang. Kiểm tra lại token." />
  if (!data?.length)
    return (
      <EmptyState
        icon={Layers}
        title="Không có trang khả dụng"
        description="Tài khoản Pancake chưa có trang nào được kích hoạt."
      />
    )

  return (
    <div className="space-y-3">
      {data.map((p) => (
        <ChannelCard
          key={p.id}
          icon={<Layers className="h-5 w-5" />}
          title={p.name}
          subtitle={
            <>
              {p.platformLabel}
              {p.activeUsers ? ` · ${p.activeUsers} người dùng` : ''}
            </>
          }
          status={
            p.isConnected
              ? { label: 'Đã kết nối', variant: 'success' }
              : { label: 'Chưa kết nối', variant: 'secondary' }
          }
          actions={
            p.isConnected ? (
              <span className="flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="h-4 w-4" />
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleConnect(p)}
                disabled={connect.isPending || !p.hasToken}
                title={p.hasToken ? 'Kết nối trang' : 'Trang chưa có page access token trên Pancake'}
              >
                <Plus /> Kết nối
              </Button>
            )
          }
        />
      ))}
    </div>
  )
}

function ConnectedPancakeAccounts() {
  const { data, isLoading, isError } = usePancakeConnected()
  const sync = useSyncPancakePage()
  const remove = useDisconnectPancakePage()

  const handleSync = (id: string) => {
    sync.mutate(id, {
      onSuccess: (r) => toast.success(r.message || 'Đã bắt đầu đồng bộ'),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  const handleDisconnect = (id: string) => {
    remove.mutate(id, {
      onSuccess: () => toast.success('Đã ngắt kết nối trang Pancake'),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  if (isLoading) return <Loading label="Đang tải trang đã kết nối..." />
  if (isError) return <ErrorState />
  if (!data?.length)
    return (
      <EmptyState
        icon={Layers}
        title="Chưa kết nối trang Pancake nào"
        description="Chọn một trang bên dưới để bắt đầu đồng bộ hội thoại."
      />
    )

  return (
    <div className="space-y-3">
      {data.map((acc) => (
        <ChannelCard
          key={acc.id}
          icon={<Layers className="h-5 w-5" />}
          title={acc.displayName || 'Pancake Page'}
          subtitle={
            <>
              {acc.platformLabel}
              {acc.lastConnectedAt
                ? ` · Kết nối lần cuối ${dayjs(acc.lastConnectedAt).format('DD/MM/YYYY HH:mm')}`
                : ''}
            </>
          }
          status={statusMeta(acc.status)}
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSync(acc.id)}
                disabled={sync.isPending}
              >
                <RefreshCw /> Đồng bộ
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDisconnect(acc.id)}
                disabled={remove.isPending}
                title="Ngắt kết nối"
              >
                <Unplug />
              </Button>
            </>
          }
        />
      ))}
    </div>
  )
}

export function PancakeTab() {
  const { data: config, isLoading, isError } = usePancakeConfig()

  if (isLoading) return <Loading label="Đang tải cấu hình Pancake..." />
  if (isError) return <ErrorState />

  const hasToken = !!config?.hasToken

  return (
    <div className="space-y-6">
      <TokenForm hasToken={hasToken} />

      {hasToken ? (
        <>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Trang đã kết nối</h3>
            <ConnectedPancakeAccounts />
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Trang khả dụng từ Pancake</h3>
            <AvailablePages />
          </section>
        </>
      ) : (
        <EmptyState
          icon={KeyRound}
          title="Chưa cấu hình Pancake"
          description="Nhập User Access Token phía trên để tải danh sách trang và bắt đầu kết nối."
        />
      )}
    </div>
  )
}
