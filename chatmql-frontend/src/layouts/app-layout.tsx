import { Outlet } from 'react-router-dom'
import { Search } from 'lucide-react'
import { SideNav } from '@/components/shared/side-nav'
import { TopNav } from '@/components/shared/top-nav'
import { UserMenu } from '@/components/shared/user-menu'
import { NotificationsBell } from '@/components/shared/notifications-bell'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui-store'
import { ImpersonationBanner } from '@/pages/conversations/view-as-staff'

function MainContent() {
  // min-w-0: cột flex mặc định không co dưới min-content — nội dung dài (bảng,
  // markdown...) sẽ đẩy tràn ngang làm cả trang "trượt" sau sidebar ở menu dọc.
  // overflow-x-hidden chặn cuộn ngang toàn trang; phần rộng phải tự cuộn trong
  // khung riêng của nó.
  return (
    <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto max-w-[1400px] p-6">
        <Outlet />
      </div>
    </main>
  )
}

export function AppLayout() {
  const navMode = useUiStore((s) => s.navMode)

  // Kiểu menu NGANG: thanh điều hướng trên cùng, nội dung full-width bên dưới.
  if (navMode === 'horizontal') {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <ImpersonationBanner />
        <TopNav />
        <MainContent />
      </div>
    )
  }

  // Kiểu menu DỌC (mặc định): sidebar bên trái + header + nội dung.
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <ImpersonationBanner />
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <SideNav />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Tìm kiếm khách hàng, hội thoại..." className="pl-9" />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <NotificationsBell />
            <UserMenu />
          </div>
        </header>
        <MainContent />
        </div>
      </div>
    </div>
  )
}
