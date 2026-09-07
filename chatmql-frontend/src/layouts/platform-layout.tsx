/**
 * platform-layout.tsx — Shell RIÊNG cho khu vực Platform (super-admin).
 *
 * Bao gồm guard riêng: nếu chưa đăng nhập platform → chuyển về /platform/login.
 * Không dùng chung SideNav / UserMenu của CRM (tránh lẫn danh tính người dùng).
 */
import { useEffect } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Building2, Palette, LogOut, ShieldCheck, Moon, Sun } from 'lucide-react'
import { usePlatformAuthStore } from '@/stores/platform-auth-store'
import { useUiStore } from '@/stores/ui-store'
import { Loading } from '@/components/shared/feedback'
import { Button } from '@/components/ui/button'
import { cn, initials } from '@/lib/utils'

const PLATFORM_NAV = [
  { label: 'Tổng quan', to: '/platform', icon: LayoutDashboard, end: true },
  { label: 'Tổ chức', to: '/platform/companies', icon: Building2, end: false },
  { label: 'Thương hiệu', to: '/platform/branding', icon: Palette, end: false },
]

export function PlatformLayout() {
  const { admin, loading, loadMe, logout } = usePlatformAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useUiStore()

  // Nạp profile platform một lần khi vào khu vực.
  useEffect(() => {
    if (!admin) loadMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) return <Loading label="Đang tải..." className="h-screen" />
  if (!admin) return <Navigate to="/platform/login" state={{ from: location }} replace />

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar riêng của platform */}
      <aside className="flex h-screen w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center gap-2 px-4">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <span className="text-sm font-bold tracking-tight">Platform Console</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
          {PLATFORM_NAV.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  )
                }
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {initials(admin.fullName)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-tight">{admin.fullName}</p>
              <p className="truncate text-xs text-sidebar-foreground/60 leading-tight">{admin.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={async () => {
                await logout()
                navigate('/platform/login', { replace: true })
              }}
            >
              <LogOut className="h-4 w-4" /> Đăng xuất
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Đổi giao diện"
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </aside>

      {/* Nội dung */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
