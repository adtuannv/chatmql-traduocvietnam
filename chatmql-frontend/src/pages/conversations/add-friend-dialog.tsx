import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertCircle, Loader2, Search, UserPlus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Textarea } from '@/components/ui/misc'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState, ErrorState } from '@/components/shared/feedback'
import { api, apiError } from '@/lib/api-client'
import { useZaloAccounts } from '@/hooks/use-integrations'
import { initials } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Hồ sơ Zalo đã chuẩn hoá từ dữ liệu passthrough của zca-js. */
interface ZaloProfile {
  userId: string
  displayName: string
  avatar: string | null
  phoneNumber: string | null
}

const DEFAULT_MESSAGE = 'Xin chào, mình muốn kết bạn.'

// ── Đọc dữ liệu phòng thủ (backend passthrough, tên field không cố định) ──

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Lấy giá trị chuỗi đầu tiên khác rỗng trong danh sách khoá. */
function pickString(src: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = src[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return null
}

const ID_KEYS = ['userId', 'uid', 'userID', 'user_id', 'id', 'zaloId', 'zalo_id']
const NAME_KEYS = [
  'displayName',
  'zaloName',
  'display_name',
  'zalo_name',
  'name',
  'username',
  'fullName',
]
const AVATAR_KEYS = ['avatar', 'avatarUrl', 'avatar_url', 'avt', 'thumbSrc', 'thumb_src']
const PHONE_KEYS = ['phoneNumber', 'phone_number', 'phone', 'phoneNum']

/**
 * Chuẩn hoá object profile trả về từ API.
 * Chấp nhận cả dạng lồng (`{ data: {...} }`, `{ user_info: {...} }`) và mảng 1 phần tử.
 */
function normalizeProfile(raw: unknown, depth = 0): ZaloProfile | null {
  if (depth > 3) return null

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = normalizeProfile(item, depth + 1)
      if (found) return found
    }
    return null
  }

  const rec = asRecord(raw)
  if (!rec) return null

  const userId = pickString(rec, ID_KEYS)
  if (userId) {
    return {
      userId,
      displayName: pickString(rec, NAME_KEYS) || 'Người dùng Zalo',
      avatar: pickString(rec, AVATAR_KEYS),
      phoneNumber: pickString(rec, PHONE_KEYS),
    }
  }

  // Chưa thấy uid ở tầng này → thử các nhánh con phổ biến
  for (const key of ['data', 'user_info', 'userInfo', 'profile', 'result']) {
    const nested = normalizeProfile(rec[key], depth + 1)
    if (nested) return nested
  }
  return null
}

/** Ánh xạ lỗi HTTP sang thông điệp tiếng Việt rõ ràng. */
function friendError(err: unknown, fallback: string): string {
  const status = (err as { response?: { status?: number } })?.response?.status
  switch (status) {
    case 400:
      return 'Số điện thoại không hợp lệ hoặc chưa được nhập.'
    case 429:
      return 'Đã vượt giới hạn thao tác kết bạn, thử lại sau.'
    case 503:
      return 'Tài khoản Zalo chưa kết nối. Vui lòng kết nối lại trong trang Tích hợp.'
    default:
      return apiError(err) || fallback
  }
}

/** Chỉ giữ chữ số và dấu `+` đầu chuỗi (số điện thoại Zalo). */
function cleanPhone(value: string): string {
  const trimmed = value.trim()
  const plus = trimmed.startsWith('+') ? '+' : ''
  return plus + trimmed.replace(/\D/g, '')
}

/**
 * Hộp thoại "Thêm bạn": tìm người dùng Zalo theo số điện thoại
 * rồi gửi lời mời kết bạn từ một tài khoản Zalo cá nhân đang kết nối.
 */
export function AddFriendDialog({ open, onOpenChange }: Props) {
  const { data: accounts, isLoading: loadingAccounts } = useZaloAccounts('personal')

  const connectedAccounts = useMemo(
    () => (accounts ?? []).filter((a) => !a.isDisabled && a.liveStatus === 'connected'),
    [accounts],
  )

  const [accountId, setAccountId] = useState<string>('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [profile, setProfile] = useState<ZaloProfile | null>(null)
  const [searched, setSearched] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Chọn sẵn tài khoản đầu tiên đang kết nối
  useEffect(() => {
    if (!open) return
    if (!accountId && connectedAccounts.length > 0) setAccountId(connectedAccounts[0].id)
  }, [open, accountId, connectedAccounts])

  // Reset toàn bộ state khi đóng hộp thoại
  useEffect(() => {
    if (open) return
    setAccountId('')
    setPhone('')
    setMessage(DEFAULT_MESSAGE)
    setProfile(null)
    setSearched(false)
    setErrorMsg(null)
  }, [open])

  const findUser = useMutation<ZaloProfile | null, unknown, { accountId: string; phone: string }>({
    mutationFn: async ({ accountId: id, phone: p }) => {
      const { data } = await api.get<{ data?: unknown }>(`/zalo-accounts/${id}/friends/find`, {
        params: { phone: p },
      })
      return normalizeProfile(data?.data)
    },
    onSuccess: (found) => {
      setProfile(found)
      setSearched(true)
      setErrorMsg(null)
    },
    onError: (err) => {
      setProfile(null)
      setSearched(true)
      const msg = friendError(err, 'Không tìm được người dùng Zalo.')
      setErrorMsg(msg)
      toast.error(msg)
    },
  })

  const sendRequest = useMutation<unknown, unknown, void>({
    mutationFn: async () => {
      const { data } = await api.post(`/zalo-accounts/${accountId}/friends/requests`, {
        userId: profile?.userId,
        message: message.trim() || undefined,
      })
      return data
    },
    onSuccess: () => {
      toast.success('Đã gửi lời mời kết bạn')
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(friendError(err, 'Không gửi được lời mời kết bạn.'))
    },
  })

  const hasAccount = connectedAccounts.length > 0
  const canSearch = hasAccount && !!accountId && cleanPhone(phone).length >= 8 && !findUser.isPending

  function handleSearch() {
    if (!canSearch) return
    setErrorMsg(null)
    findUser.mutate({ accountId, phone: cleanPhone(phone) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm bạn</DialogTitle>
          <DialogDescription>
            Tìm người dùng Zalo theo số điện thoại và gửi lời mời kết bạn.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tài khoản Zalo cá nhân */}
          <div className="space-y-1.5">
            <Label htmlFor="add-friend-account">Tài khoản Zalo cá nhân</Label>
            {loadingAccounts ? (
              <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Đang tải tài khoản...
              </div>
            ) : hasAccount ? (
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="add-friend-account">
                  <SelectValue placeholder="Chọn tài khoản gửi lời mời" />
                </SelectTrigger>
                <SelectContent>
                  {connectedAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.displayName || acc.phone || 'Tài khoản Zalo'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>
                  Chưa có tài khoản Zalo cá nhân nào đang kết nối. Vào{' '}
                  <Link to="/integrations" className="font-medium text-primary hover:underline">
                    trang Tích hợp
                  </Link>{' '}
                  để kết nối tài khoản trước khi thêm bạn.
                </p>
              </div>
            )}
          </div>

          {/* Số điện thoại + nút Tìm */}
          <div className="space-y-1.5">
            <Label htmlFor="add-friend-phone">Số điện thoại</Label>
            <div className="flex gap-2">
              <Input
                id="add-friend-phone"
                inputMode="tel"
                autoComplete="off"
                placeholder="Ví dụ: 0912345678"
                value={phone}
                disabled={!hasAccount}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSearch()
                  }
                }}
              />
              <Button type="button" onClick={handleSearch} disabled={!canSearch}>
                {findUser.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Tìm
              </Button>
            </div>
          </div>

          {/* Kết quả tìm kiếm */}
          {findUser.isPending && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tìm người dùng...
            </div>
          )}

          {!findUser.isPending && errorMsg && <ErrorState message={errorMsg} />}

          {!findUser.isPending && !errorMsg && searched && !profile && (
            <EmptyState
              title="Không tìm thấy người dùng Zalo với số này"
              description="Kiểm tra lại số điện thoại, hoặc người dùng đã bật chế độ ẩn tìm kiếm."
            />
          )}

          {!findUser.isPending && !errorMsg && profile && (
            <div className="space-y-3 rounded-lg border bg-card p-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-11 w-11">
                  {profile.avatar && <AvatarImage src={profile.avatar} alt="" />}
                  <AvatarFallback>{initials(profile.displayName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{profile.displayName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">UID: {profile.userId}</Badge>
                    {profile.phoneNumber && (
                      <Badge variant="outline">{profile.phoneNumber}</Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="add-friend-message">Lời nhắn (tuỳ chọn)</Label>
                <Textarea
                  id="add-friend-message"
                  rows={3}
                  maxLength={300}
                  placeholder={DEFAULT_MESSAGE}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
          <Button
            type="button"
            onClick={() => sendRequest.mutate()}
            disabled={!profile || !accountId || sendRequest.isPending}
          >
            {sendRequest.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Gửi lời mời
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
