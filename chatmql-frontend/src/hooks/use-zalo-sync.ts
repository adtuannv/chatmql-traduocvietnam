/**
 * use-zalo-sync.ts — Đồng bộ danh bạ & kéo lịch sử tin nhắn Zalo cá nhân.
 *
 * Port từ `zalo-history-bridge.js` (bản vá DOM cũ) sang hook TanStack Query +
 * Socket.IO. Endpoint theo `bizcrm_backend_source/src/modules/zalo/zalo-routes.ts`
 * Kéo lịch sử nay chỉ làm theo TÀI KHOẢN ở màn Tích hợp; endpoint theo từng
 * hội thoại vẫn còn ở máy chủ nhưng giao diện không dùng nữa.
 *
 * Tiến độ kéo lịch sử được backend phát vào phòng `org:{orgId}` qua sự kiện
 * `zalo:backfill-progress` (server tự join phòng org lúc kết nối, client không
 * cần join gì thêm).
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { getSocket } from '@/lib/socket'

// Dùng lại hook danh sách tài khoản kênh sẵn có, không nhân đôi.
export { useZaloAccounts, statusMeta, type ChannelAccount } from '@/hooks/use-integrations'

// ─────────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ─────────────────────────────────────────────────────────────────────────────

/** Kết quả POST /zalo-accounts/:id/backfill (chạy nền, theo dõi qua socket). */
export interface AccountBackfillResult {
  message: string
  accountId: string
  includeFriends: boolean
}

/** Kết quả POST /zalo-accounts/:id/backfill-friends. */
export interface FriendsBackfillResult {
  message: string
  accountId: string
  friendCount: number
}

export interface SyncResult {
  synced: number
  message: string
}

/** GET /zalo-accounts/:id/stats */
export interface ZaloAccountStats {
  contacts: number
  conversations: number
  messages: number
}

/** Payload sự kiện `zalo:backfill-progress` (socket-gateway.ts → emitBackfillProgress). */
export interface BackfillProgressEvent {
  accountId: string
  current: number
  total: number
  threadName?: string
  status: 'processing' | 'completed' | 'error'
  result?: { totalInserted: number; totalSkipped: number; errors: number }
  /** Có khi quét theo danh sách bạn bè (backfill-friends). */
  mode?: 'friends' | (string & {})
}

/** Tiến độ đã chuẩn hoá để vẽ thanh %. */
export interface BackfillProgress extends BackfillProgressEvent {
  /** 0–100 */
  percent: number
  /** Thời điểm nhận sự kiện (ms). */
  receivedAt: number
}

export const BACKFILL_STATUS_LABELS: Record<BackfillProgressEvent['status'], string> = {
  processing: 'Đang kéo lịch sử',
  completed: 'Hoàn tất',
  error: 'Lỗi',
}

// ─────────────────────────────────────────────────────────────────────────────
// Query keys
// ─────────────────────────────────────────────────────────────────────────────

export const zaloSyncKeys = {
  stats: (id: string) => ['zalo-account-stats', id] as const,
}

const ZALO_ACCOUNTS_KEY = ['integrations', 'zalo-accounts'] as const

// ─────────────────────────────────────────────────────────────────────────────
// Mutation
// ─────────────────────────────────────────────────────────────────────────────

export function useBackfillAccount() {
  const qc = useQueryClient()
  return useMutation<
    AccountBackfillResult,
    unknown,
    { accountId: string; maxMessages?: number; includeFriends?: boolean }
  >({
    mutationFn: async ({ accountId, maxMessages = 1000, includeFriends = false }) => {
      const { data } = await api.post<AccountBackfillResult>(`/zalo-accounts/${accountId}/backfill`, {
        maxMessages,
        includeFriends,
      })
      return data
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: zaloSyncKeys.stats(vars.accountId) })
    },
  })
}

/** Quét lịch sử theo DANH SÁCH BẠN BÈ — lấy cả khách chưa từng có hội thoại trong hệ thống. */
export function useBackfillFriends() {
  const qc = useQueryClient()
  return useMutation<
    FriendsBackfillResult,
    unknown,
    { accountId: string; maxMessages?: number; maxFriends?: number }
  >({
    mutationFn: async ({ accountId, maxMessages = 200, maxFriends = 0 }) => {
      const { data } = await api.post<FriendsBackfillResult>(
        `/zalo-accounts/${accountId}/backfill-friends`,
        { maxMessages, maxFriends },
      )
      return data
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: zaloSyncKeys.stats(vars.accountId) })
    },
  })
}

/** Đồng bộ danh bạ (bạn bè) từ Zalo về DB. */
export function useSyncFriends() {
  const qc = useQueryClient()
  return useMutation<SyncResult, unknown, string>({
    mutationFn: async (accountId) => {
      const { data } = await api.post<SyncResult>(`/zalo-accounts/${accountId}/friends/sync`)
      return data
    },
    onSuccess: (_res, accountId) => {
      qc.invalidateQueries({ queryKey: zaloSyncKeys.stats(accountId) })
      qc.invalidateQueries({ queryKey: ZALO_ACCOUNTS_KEY })
    },
  })
}

/** Đồng bộ nhóm từ Zalo (backend hiện chỉ trả số nhóm đã lưu). */
export function useSyncGroups() {
  const qc = useQueryClient()
  return useMutation<SyncResult, unknown, string>({
    mutationFn: async (accountId) => {
      const { data } = await api.post<SyncResult>(`/zalo-accounts/${accountId}/groups/sync`)
      return data
    },
    onSuccess: (_res, accountId) => {
      qc.invalidateQueries({ queryKey: zaloSyncKeys.stats(accountId) })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Query
// ─────────────────────────────────────────────────────────────────────────────

/** Số liên hệ / hội thoại / tin nhắn của một tài khoản. */
export function useAccountStats(accountId: string | undefined) {
  return useQuery<ZaloAccountStats>({
    queryKey: zaloSyncKeys.stats(accountId ?? ''),
    enabled: !!accountId,
    queryFn: async () => {
      const { data } = await api.get<ZaloAccountStats>(`/zalo-accounts/${accountId}/stats`)
      return data
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Realtime tiến độ
// ─────────────────────────────────────────────────────────────────────────────

function normalize(ev: BackfillProgressEvent): BackfillProgress {
  const total = Math.max(1, Number(ev.total) || 1)
  const current = Math.max(0, Number(ev.current) || 0)
  const percent =
    ev.status === 'completed' ? 100 : Math.min(100, Math.max(0, Math.round((current / total) * 100)))
  return { ...ev, current, total, percent, receivedAt: Date.now() }
}

/**
 * Tiến độ kéo lịch sử theo TỪNG tài khoản (map accountId → tiến độ mới nhất).
 * Nghe `zalo:backfill-progress`; gỡ listener khi unmount.
 */
export function useBackfillProgressMap(): Record<string, BackfillProgress> {
  const [map, setMap] = useState<Record<string, BackfillProgress>>({})

  useEffect(() => {
    const socket = getSocket()
    const onProgress = (ev: BackfillProgressEvent) => {
      if (!ev?.accountId) return
      setMap((prev) => ({ ...prev, [ev.accountId]: normalize(ev) }))
    }
    socket.on('zalo:backfill-progress', onProgress)
    return () => {
      socket.off('zalo:backfill-progress', onProgress)
    }
  }, [])

  return map
}

/**
 * Tiến độ mới nhất — lọc theo `accountId` nếu truyền, ngược lại lấy sự kiện mới
 * nhất của bất kỳ tài khoản nào. Trả `null` khi chưa có sự kiện.
 */
export function useBackfillProgress(accountId?: string): BackfillProgress | null {
  const [latest, setLatest] = useState<BackfillProgress | null>(null)

  useEffect(() => {
    const socket = getSocket()
    const onProgress = (ev: BackfillProgressEvent) => {
      if (accountId && ev?.accountId !== accountId) return
      setLatest(normalize(ev))
    }
    socket.on('zalo:backfill-progress', onProgress)
    return () => {
      socket.off('zalo:backfill-progress', onProgress)
    }
  }, [accountId])

  return latest
}
