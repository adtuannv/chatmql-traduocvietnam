/**
 * security-section.tsx — "Mật khẩu & Bảo mật".
 *
 * Backend hiện chỉ có 2 thứ: đổi mật khẩu (POST /auth/change-password) và
 * API key (GET/POST/DELETE /api-keys). CHƯA có xác thực 2 lớp và chưa có API
 * liệt kê phiên đăng nhập — nên màn này không dựng hai mục đó, thay vì hiện
 * nút bấm vào không chạy.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, KeyRound, Loader2, Lock, Plus, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loading, EmptyState } from '@/components/shared/feedback'
import {
  useChangePassword, useApiKeys, useCreateApiKey, useDeleteApiKey,
} from '@/hooks/use-settings'
import { apiError } from '@/lib/api-client'

const MIN_PASSWORD = 6

function ChangePasswordCard() {
  const changePassword = useChangePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next.length < MIN_PASSWORD) return toast.error(`Mật khẩu mới cần ít nhất ${MIN_PASSWORD} ký tự`)
    if (next !== confirm) return toast.error('Xác nhận mật khẩu không khớp')
    try {
      await changePassword.mutateAsync({ currentPassword: current, newPassword: next })
      setCurrent(''); setNext(''); setConfirm('')
      toast.success('Đã đổi mật khẩu')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4 text-primary" /> Đổi mật khẩu
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="max-w-md space-y-3">
          <div>
            <Label htmlFor="cur-pw">Mật khẩu hiện tại</Label>
            <Input id="cur-pw" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="mt-1" autoComplete="current-password" />
          </div>
          <div>
            <Label htmlFor="new-pw">Mật khẩu mới</Label>
            <Input id="new-pw" type="password" value={next} onChange={(e) => setNext(e.target.value)} className="mt-1" autoComplete="new-password" />
          </div>
          <div>
            <Label htmlFor="cf-pw">Nhập lại mật khẩu mới</Label>
            <Input id="cf-pw" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1" autoComplete="new-password" />
          </div>
          <Button type="submit" disabled={changePassword.isPending || !current || !next}>
            {changePassword.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Đổi mật khẩu
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function ApiKeysCard() {
  const { data: keys, isLoading } = useApiKeys()
  const createKey = useCreateApiKey()
  const deleteKey = useDeleteApiKey()
  const [name, setName] = useState('')
  // Khoá thật chỉ trả về ĐÚNG MỘT LẦN lúc tạo — giữ trên màn để người dùng chép.
  const [freshKey, setFreshKey] = useState<string | null>(null)

  const create = async () => {
    if (!name.trim()) return toast.error('Đặt tên cho khoá để biết nó dùng ở đâu')
    try {
      const res = await createKey.mutateAsync({ name: name.trim() })
      setFreshKey(res.apiKey)
      setName('')
      toast.success('Đã tạo API key')
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Thu hồi khoá "${label}"? Ứng dụng đang dùng khoá này sẽ mất kết nối.`)) return
    try {
      await deleteKey.mutateAsync(id)
      toast.success('Đã thu hồi khoá')
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 text-primary" /> API key
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Dùng để hệ thống khác gọi vào CRM. Khoá chỉ hiện đầy đủ một lần duy nhất khi tạo.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tên khoá, ví dụ: Website đặt hàng"
            className="max-w-xs"
          />
          <Button variant="outline" onClick={create} disabled={createKey.isPending}>
            <Plus className="h-4 w-4" /> Tạo khoá
          </Button>
        </div>

        {freshKey && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
            <p className="text-xs font-medium">Chép ngay — khoá này sẽ không hiện lại lần nữa:</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">{freshKey}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(freshKey).then(
                    () => toast.success('Đã chép khoá'),
                    () => toast.error('Trình duyệt chặn chép tự động — hãy bôi đen và chép tay'),
                  )
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Chép
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <Loading label="Đang tải khoá…" />
        ) : !keys?.length ? (
          <EmptyState icon={KeyRound} title="Chưa có API key nào" description="Tạo khoá khi cần kết nối hệ thống ngoài." />
        ) : (
          <ul className="divide-y rounded-lg border">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{k.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {k.prefix ? `${k.prefix}••••  · ` : ''}
                    Tạo {new Date(k.createdAt).toLocaleDateString('vi-VN')}
                    {k.lastUsedAt ? ` · Dùng lần cuối ${new Date(k.lastUsedAt).toLocaleDateString('vi-VN')}` : ' · Chưa dùng'}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(k.id, k.name)} aria-label={`Thu hồi ${k.name}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function SecuritySection() {
  return (
    <div className="space-y-4">
      <ChangePasswordCard />
      <ApiKeysCard />
      <p className="text-xs text-muted-foreground">
        Xác thực 2 lớp và danh sách phiên đăng nhập chưa dựng được — backend chưa có API cho hai
        mục này.
      </p>
    </div>
  )
}
