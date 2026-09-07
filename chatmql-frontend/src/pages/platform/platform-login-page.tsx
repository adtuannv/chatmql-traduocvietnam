/**
 * platform-login-page.tsx — Đăng nhập super-admin (khu vực Platform).
 * Route `/platform/login`. Dùng token platform riêng, KHÔNG đụng tới auth CRM.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { usePlatformAuthStore } from '@/stores/platform-auth-store'
import { platformApiError } from '@/lib/platform-client'

export function PlatformLoginPage() {
  const login = usePlatformAuthStore((s) => s.login)
  const admin = usePlatformAuthStore((s) => s.admin)
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/platform'

  // Nếu đã đăng nhập platform thì vào thẳng console.
  useEffect(() => {
    if (admin) navigate(from, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email.trim(), password)
      toast.success('Đăng nhập Platform thành công')
      navigate(from, { replace: true })
    } catch (err) {
      toast.error(platformApiError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary to-primary/70 p-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="mt-3 text-lg font-bold tracking-tight">Platform Console</h1>
          <p className="mt-1 text-sm text-muted-foreground">Quản trị đa tổ chức (super-admin)</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="admin@traduoc.ai"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Mật khẩu</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Đăng nhập
          </Button>
        </form>
      </Card>
    </div>
  )
}
