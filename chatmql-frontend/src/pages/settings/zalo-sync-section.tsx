/**
 * zalo-sync-section.tsx — Mục Cài đặt "Đồng bộ & Lịch sử Zalo".
 *
 * Port từ mục 1 của `zalo-history-bridge.js`: bảng tài khoản Zalo cá nhân, nút
 * "Đồng bộ danh bạ" và "Kéo lịch sử" (nhập maxMessages), thanh tiến độ trực
 * tiếp theo từng tài khoản qua sự kiện socket `zalo:backfill-progress`.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle, Download, Loader2, MessageCircle, RefreshCw, Smartphone, Users,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/misc'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { DataTable, type Column } from '@/components/shared/data-table'
import { EmptyState, ErrorState, Loading } from '@/components/shared/feedback'
import { apiError } from '@/lib/api-client'
import { cn, formatNumber } from '@/lib/utils'
import {
  useZaloAccounts, useAccountStats, useSyncFriends, useBackfillAccount, useBackfillFriends,
  useBackfillProgressMap, statusMeta, BACKFILL_STATUS_LABELS,
  type ChannelAccount, type BackfillProgress,
} from '@/hooks/use-zalo-sync'

const DEFAULT_MAX_MESSAGES = 1000

export function ZaloSyncSection() {
  const { data, isLoading, isError, error } = useZaloAccounts('personal')
  const syncFriends = useSyncFriends()
  const backfill = useBackfillAccount()
  const backfillFriends = useBackfillFriends()
  const progressMap = useBackfillProgressMap()

  const [target, setTarget] = useState<ChannelAccount | null>(null)
  const [maxMessages, setMaxMessages] = useState(String(DEFAULT_MAX_MESSAGES))
  const [byFriends, setByFriends] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  const handleSync = (acc: ChannelAccount) => {
    setSyncingId(acc.id)
    syncFriends.mutate(acc.id, {
      onSuccess: (res) => toast.success(res.message || `Đã đồng bộ ${formatNumber(res.synced)} bạn bè`),
      onError: (err) => toast.error(apiError(err)),
      onSettled: () => setSyncingId(null),
    })
  }

  const startBackfill = () => {
    if (!target) return
    const n = parseInt(maxMessages, 10)
    const max = Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_MESSAGES
    const acc = target
    setTarget(null)
    if (byFriends) {
      backfillFriends.mutate(
        { accountId: acc.id, maxMessages: max },
        {
          onSuccess: (res) => toast.success(res.message || 'Đã bắt đầu quét lịch sử theo danh sách bạn bè.'),
          onError: (err) => toast.error(apiError(err)),
        },
      )
    } else {
      backfill.mutate(
        { accountId: acc.id, maxMessages: max },
        {
          onSuccess: (res) => toast.success(res.message || 'Đã bắt đầu kéo lịch sử. Theo dõi tiến độ bên dưới.'),
          onError: (err) => toast.error(apiError(err)),
        },
      )
    }
  }

  const isRunning = (id: string) => {
    const p = progressMap[id]
    if (p?.status === 'processing') return true
    return (backfill.isPending && backfill.variables?.accountId === id)
      || (backfillFriends.isPending && backfillFriends.variables?.accountId === id)
  }

  const columns: Column<ChannelAccount>[] = [
    {
      key: 'account',
      header: 'Tài khoản',
      cell: (acc) => (
        <div className="flex items-center gap-3">
          {acc.avatarUrl ? (
            <img src={acc.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MessageCircle className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate font-medium">{acc.displayName || acc.phone || 'Tài khoản Zalo'}</div>
            {acc.phone && <div className="text-xs text-muted-foreground">{acc.phone}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (acc) => {
        const m = statusMeta(acc.liveStatus, acc.isDisabled)
        return <Badge variant={m.variant}>{m.label}</Badge>
      },
    },
    {
      key: 'stats',
      header: 'Dữ liệu đã lưu',
      cell: (acc) => <AccountStatsCell accountId={acc.id} />,
    },
    {
      key: 'progress',
      header: 'Tiến độ kéo lịch sử',
      className: 'min-w-[220px]',
      cell: (acc) => <ProgressCell progress={progressMap[acc.id]} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (acc) => {
        const connected = acc.liveStatus === 'connected' && !acc.isDisabled
        const running = isRunning(acc.id)
        const syncing = syncingId === acc.id
        return (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!connected || syncing}
              onClick={() => handleSync(acc)}
              title={connected ? 'Đồng bộ danh bạ (bạn bè) từ Zalo' : 'Tài khoản chưa kết nối'}
            >
              {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Đồng bộ danh bạ
            </Button>
            <Button
              size="sm"
              disabled={!connected || running}
              onClick={() => {
                setMaxMessages(String(DEFAULT_MAX_MESSAGES))
                setByFriends(false)
                setTarget(acc)
              }}
              title={connected ? 'Kéo lịch sử tin nhắn của toàn bộ hội thoại' : 'Tài khoản chưa kết nối'}
            >
              {running ? <Loader2 className="animate-spin" /> : <Download />}
              {running ? 'Đang kéo...' : 'Kéo lịch sử'}
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4 text-primary" /> Đồng bộ & Lịch sử Zalo
          </CardTitle>
          <CardDescription>
            Kéo dữ liệu hội thoại cũ từ Zalo cá nhân về hệ thống để tra cứu thông tin và chăm sóc
            khách hàng tự động. Tiến độ hiển thị trực tiếp khi đang chạy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="space-y-1">
              <p className="font-medium">Lưu ý khi thao tác</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                <li>
                  Trên môi trường thử nghiệm (dev) <b>không</b> kết nối tài khoản Zalo thật của khách —
                  kéo lịch sử hàng loạt dễ khiến Zalo khoá tạm tài khoản.
                </li>
                <li>
                  Mỗi lần chỉ nên chạy cho một tài khoản; kéo xong hội thoại rồi mới quét theo danh
                  sách bạn bè, không chạy song song.
                </li>
                <li>Tin nhắn kéo về chỉ lưu để tra cứu — AI và automation không tự phản hồi.</li>
              </ul>
            </div>
          </div>

          {isLoading ? (
            <Loading label="Đang tải tài khoản Zalo..." />
          ) : isError ? (
            <ErrorState message={apiError(error)} />
          ) : !data?.length ? (
            <EmptyState
              icon={MessageCircle}
              title="Chưa có tài khoản Zalo cá nhân nào"
              description="Vào mục Tích hợp để quét mã QR kết nối tài khoản Zalo của bạn trước."
              action={
                <Button asChild variant="outline">
                  <Link to="/integrations">Đến trang Tích hợp</Link>
                </Button>
              }
            />
          ) : (
            <DataTable columns={columns} rows={data} rowKey={(r) => r.id} />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Kéo lịch sử tin nhắn</DialogTitle>
            <DialogDescription>
              Tài khoản: <b>{target?.displayName || target?.phone || 'Zalo'}</b>. Hệ thống sẽ chạy nền
              và phát tiến độ về màn hình này. Tin đã có sẽ được bỏ qua; AI không tự trả lời.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="zalo-max-messages">Số tin tối đa mỗi hội thoại</Label>
              <Input
                id="zalo-max-messages"
                type="number"
                min={1}
                value={maxMessages}
                onChange={(e) => setMaxMessages(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) startBackfill()
                }}
              />
              <p className="text-xs text-muted-foreground">Mặc định {formatNumber(DEFAULT_MAX_MESSAGES)} tin/khách.</p>
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                checked={byFriends}
                onCheckedChange={(v) => setByFriends(v === true)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Quét theo danh sách bạn bè</span>
                <span className="block text-xs text-muted-foreground">
                  Lấy được cả khách đã chat trước khi kết nối nhưng chưa có hội thoại trong hệ thống.
                  Cần đồng bộ danh bạ trước.
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Hủy
            </Button>
            <Button onClick={startBackfill} disabled={backfill.isPending || backfillFriends.isPending}>
              <Download /> Bắt đầu kéo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AccountStatsCell({ accountId }: { accountId: string }) {
  const { data, isLoading } = useAccountStats(accountId)
  if (isLoading) return <span className="text-xs text-muted-foreground">Đang tải...</span>
  if (!data) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Users className="h-3 w-3" /> {formatNumber(data.contacts)} bạn bè
      </span>
      <span>{formatNumber(data.conversations)} hội thoại</span>
      <span>{formatNumber(data.messages)} tin nhắn</span>
    </div>
  )
}

function ProgressCell({ progress }: { progress?: BackfillProgress }) {
  if (!progress) return <span className="text-xs text-muted-foreground">Chưa chạy</span>
  const done = progress.status === 'completed'
  const failed = progress.status === 'error'
  const tone = failed ? 'bg-destructive' : done ? 'bg-success' : 'bg-primary'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={cn('font-medium', failed ? 'text-destructive' : done ? 'text-success' : 'text-foreground')}>
          {BACKFILL_STATUS_LABELS[progress.status] ?? progress.status}
          {progress.mode === 'friends' && ' (bạn bè)'}
        </span>
        <span className="tabular-nums text-muted-foreground">{progress.percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="truncate text-xs text-muted-foreground">
        {done && progress.result
          ? `+${formatNumber(progress.result.totalInserted)} tin mới, ${formatNumber(progress.result.totalSkipped)} đã có${progress.result.errors ? `, ${progress.result.errors} lỗi` : ''}`
          : `[${formatNumber(progress.current)}/${formatNumber(progress.total)}] ${progress.threadName || 'Đang quét hội thoại...'}`}
      </div>
    </div>
  )
}
