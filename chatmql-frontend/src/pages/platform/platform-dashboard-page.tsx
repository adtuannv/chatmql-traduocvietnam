/**
 * platform-dashboard-page.tsx — Tổng quan toàn hệ thống (report overview).
 * Route `/platform`.
 */
import { Building2, CheckCircle2, Ban, CalendarX, Infinity as InfinityIcon, Clock, Users, MessageSquare, Contact } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { StatCard } from '@/components/shared/stat-card'
import { Loading, ErrorState } from '@/components/shared/feedback'
import { usePlatformOverview } from '@/hooks/use-platform'
import { usePlatformAuthStore } from '@/stores/platform-auth-store'

export function PlatformDashboardPage() {
  const admin = usePlatformAuthStore((s) => s.admin)
  const { data, isLoading, isError } = usePlatformOverview()

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Xin chào, ${admin?.fullName || 'Super Admin'} 👋`}
        description="Tổng quan toàn hệ thống ChatMQL (đa tổ chức)."
      />

      {isLoading ? (
        <Loading />
      ) : isError || !data ? (
        <ErrorState message="Không tải được số liệu tổng quan." />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Tổng tổ chức" value={data.companies.total} icon={Building2} />
            <StatCard label="Đang hoạt động" value={data.companies.active} icon={CheckCircle2} tone="success" />
            <StatCard label="Đã khóa" value={data.companies.suspended} icon={Ban} tone="destructive" />
            <StatCard label="Đã hết hạn" value={data.companies.expired} icon={CalendarX} tone="warning" />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Không giới hạn" value={data.companies.unlimited} icon={InfinityIcon} />
            <StatCard
              label="Sắp hết hạn (7 ngày)"
              value={data.companies.expiringIn7d}
              icon={Clock}
              tone="warning"
              hint="Cần theo dõi gia hạn"
            />
            <StatCard label="Tổ chức mới (30 ngày)" value={data.companies.newLast30d} icon={Building2} tone="success" />
            <StatCard label="Tổng người dùng" value={data.users} icon={Users} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Tổng khách hàng" value={data.contacts} icon={Contact} />
            <StatCard label="Tổng hội thoại" value={data.conversations} icon={MessageSquare} />
          </div>
        </div>
      )}
    </div>
  )
}
