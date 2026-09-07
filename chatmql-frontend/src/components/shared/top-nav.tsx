import { useLayoutEffect, useRef, useState } from 'react'
import { FEATURES } from '@/lib/features'
import { useMyPermissions } from '@/hooks/use-settings'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { BookOpen, PanelLeft, MoreHorizontal } from 'lucide-react'
import { filterNavByPermissions, navForRole, type NavItem } from './nav-config'
import { BrandLogo } from './brand-logo'
import { UserMenu } from './user-menu'
import { NotificationsBell } from './notifications-bell'
import { UserGuideDialog } from './user-guide-dialog'
import { useUiStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/misc'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

const ITEM_CLS =
  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors'
const INACTIVE =
  'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground'
const ACTIVE = 'bg-primary text-primary-foreground'

const GAP = 4 // gap-1
const MORE_W = 120 // chỗ dành cho nút "Xem thêm"

export function TopNav() {
  const setNavMode = useUiStore((s) => s.setNavMode)
  const [guideOpen, setGuideOpen] = useState(false)
  const role = useAuthStore((s) => s.user?.role)
  // RBAC động: menu lọc thêm theo /me/permissions (đang tải thì giữ nguyên
  // theo vai trò gốc để không nhấp nháy).
  const permsQ = useMyPermissions()
  const nav = filterNavByPermissions(
    navForRole(role),
    FEATURES.ROLES_PERMISSIONS ? permsQ.data : undefined,
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const measurerRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(nav.length)

  useLayoutEffect(() => {
    const container = containerRef.current
    const measurer = measurerRef.current
    if (!container || !measurer) return
    const widths = [...measurer.children].map((c) => (c as HTMLElement).offsetWidth)

    const compute = () => {
      const avail = container.clientWidth
      const fit = (budget: number) => {
        let total = 0
        let count = 0
        for (const w of widths) {
          total += w + (count > 0 ? GAP : 0)
          if (total <= budget) count++
          else break
        }
        return count
      }
      let count = fit(avail)
      if (count < widths.length) count = fit(avail - MORE_W) // chừa chỗ nút Xem thêm
      setVisibleCount(count)
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(container)
    return () => ro.disconnect()
  }, [nav.length])

  const visible = nav.slice(0, visibleCount)
  const overflow = nav.slice(visibleCount)

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground">
      <div className="shrink-0 rounded-md bg-white/95 px-2 py-1">
        <BrandLogo />
      </div>

      {/* Bộ đo ẩn: đo bề rộng từng mục để tính số mục hiển thị vừa đủ.
          left-0 + max-w-full + overflow-hidden: các mục (shrink-0) vẫn giữ bề
          rộng tự nhiên để đo, nhưng hộp đo KHÔNG nới scrollWidth của trang —
          trước đây nó rộng ~1400px làm cả trang kéo lệch ngang được. */}
      <div ref={measurerRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 -z-10 flex max-w-full gap-1 overflow-hidden">
        {nav.map((item) => (
          <ItemContent key={item.to} item={item} className={cn(ITEM_CLS, INACTIVE)} />
        ))}
      </div>

      {/* Menu ngang thật */}
      <div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {visible.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              data-tour={`nav-${item.to.replace('/', '')}`}
              className={({ isActive }) => cn(ITEM_CLS, isActive ? ACTIVE : INACTIVE)}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="whitespace-nowrap">{item.label}</span>
            </NavLink>
          )
        })}
        {overflow.length > 0 && <MoreMenu items={overflow} />}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/* Đặt cạnh nút đổi giao diện: người mới tìm hướng dẫn ở góc phải
            thanh trên cùng, không phải trong trang Cài đặt. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setGuideOpen(true)}
          data-tour="hdsd"
          className="h-8 gap-1.5 px-2 text-[12px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent"
          title="Hướng dẫn sử dụng"
        >
          <BookOpen className="h-4 w-4" /> HDSD
        </Button>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Chuyển menu dọc"
              onClick={() => setNavMode('vertical')}
              className="text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <PanelLeft className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Menu dọc</TooltipContent>
        </Tooltip>
        <NotificationsBell className="text-sidebar-foreground hover:bg-sidebar-accent" />
        <UserMenu />
      </div>

      <UserGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </header>
  )
}

function ItemContent({ item, className }: { item: NavItem; className?: string }) {
  const Icon = item.icon
  return (
    <div className={className}>
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="whitespace-nowrap">{item.label}</span>
    </div>
  )
}

function MoreMenu({ items }: { items: NavItem[] }) {
  const navigate = useNavigate()
  const location = useLocation()
  const hasActive = items.some((i) => location.pathname.startsWith(i.to))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn(ITEM_CLS, hasActive ? ACTIVE : INACTIVE)} aria-label="Xem thêm menu">
          <MoreHorizontal className="h-[18px] w-[18px] shrink-0" />
          <span className="whitespace-nowrap">Xem thêm</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <DropdownMenuItem key={item.to} onClick={() => navigate(item.to)}>
              <Icon className="mr-2 h-4 w-4" />
              {item.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
