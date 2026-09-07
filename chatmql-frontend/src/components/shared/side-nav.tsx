import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { FEATURES } from '@/lib/features'
import { useMyPermissions } from '@/hooks/use-settings'
import { BookOpen, PanelLeftClose, PanelLeft, PanelTop } from 'lucide-react'
import { filterNavByPermissions, navForRole } from './nav-config'
import { BrandLogo } from './brand-logo'
import { useUiStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/misc'
import { UserGuideDialog } from './user-guide-dialog'

export function SideNav() {
  const { sidebarCollapsed, toggleSidebar, setNavMode } = useUiStore()
  const [guideOpen, setGuideOpen] = useState(false)
  const role = useAuthStore((s) => s.user?.role)
  // RBAC động: menu lọc thêm theo /me/permissions (đang tải thì giữ nguyên
  // theo vai trò gốc để không nhấp nháy).
  const permsQ = useMyPermissions()
  const nav = filterNavByPermissions(
    navForRole(role),
    FEATURES.ROLES_PERMISSIONS ? permsQ.data : undefined,
  )

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200',
        sidebarCollapsed ? 'w-[68px]' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center px-3',
          sidebarCollapsed ? 'justify-center' : 'justify-start',
        )}
      >
        {sidebarCollapsed ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white/95 text-lg font-bold text-primary">
            e
          </span>
        ) : (
          <div className="rounded-md bg-white/95 px-2 py-1">
            <BrandLogo />
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {nav.map((item) => {
          const Icon = item.icon
          const link = (
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex w-full items-center rounded-lg py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  sidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-3',
                )
              }
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          )
          return sidebarCollapsed ? (
            <Tooltip key={item.to} delayDuration={0}>
              <TooltipTrigger asChild>
                <div>{link}</div>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            <div key={item.to}>{link}</div>
          )
        })}
      </nav>

      <div className="space-y-1 px-2 py-2">
        {/* Cùng chỗ với nút đổi giao diện, giống hệt bên menu ngang. */}
        <NavButton
          collapsed={sidebarCollapsed}
          onClick={() => setGuideOpen(true)}
          icon={<BookOpen className="h-4 w-4 shrink-0" />}
          label="HDSD"
        />
        <NavButton
          collapsed={sidebarCollapsed}
          onClick={() => setNavMode('horizontal')}
          icon={<PanelTop className="h-4 w-4 shrink-0" />}
          label="Menu ngang"
        />
        <NavButton
          collapsed={sidebarCollapsed}
          onClick={toggleSidebar}
          icon={sidebarCollapsed ? <PanelLeft className="h-4 w-4 shrink-0" /> : <PanelLeftClose className="h-4 w-4 shrink-0" />}
          label={sidebarCollapsed ? 'Mở rộng' : 'Thu gọn'}
        />
      </div>

      <UserGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </aside>
  )
}

function NavButton({
  collapsed,
  onClick,
  icon,
  label,
}: {
  collapsed: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  const btn = (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center rounded-lg py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
        collapsed ? 'justify-center px-0' : 'gap-2 px-3',
      )}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </button>
  )
  return collapsed ? (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  ) : (
    btn
  )
}
