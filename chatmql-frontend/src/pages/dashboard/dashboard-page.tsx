/**
 * dashboard-page.tsx — Màn Tổng quan (theo bàn giao tong-quan-BAN-GIAO.md).
 *
 * Bố cục: lời chào + nút ↻ Làm mới → 6 thẻ KPI nhanh → khối báo cáo
 * "Hiệu quả Chat → Đơn hàng" (kèm biểu đồ Tin nhắn theo ngày + Tags theo hội
 * thoại). Khối "Kinh doanh" (OverviewCards) đã BỎ theo spec §1 — file
 * overview-cards.tsx vẫn giữ nguyên, chỉ không render nữa.
 */
import { useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock, MailOpen, MessageSquare, MessageSquareWarning, RefreshCw, UserPlus, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { StatCard } from '@/components/shared/stat-card'
import { Loading } from '@/components/shared/feedback'
import { useApiQuery } from '@/hooks/use-api'
import { useAuthStore } from '@/stores/auth-store'
import { ChatOrderReport } from './chat-order-report'

interface Kpi {
  messagesToday: number
  messagesUnreplied: number
  messagesUnread: number
  appointmentsToday: number
  newContactsThisWeek: number
  totalContacts: number
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const { data, isLoading } = useApiQuery<Kpi>(['dashboard-kpi'], '/dashboard/kpi')

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dashboard-kpi'] })
    qc.invalidateQueries({ queryKey: ['chat-report'] })
    qc.invalidateQueries({ queryKey: ['dashboard-message-volume'] })
    toast.success('Đã làm mới số liệu')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={`Xin chào, ${user?.fullName || ''} 👋`}
          description="Đây là tổng quan hoạt động hôm nay của bạn."
        />
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
          Làm mới
        </Button>
      </div>

      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Tin nhắn hôm nay" value={data.messagesToday} icon={MessageSquare} hint="Hôm nay" />
          <StatCard
            label="Chưa trả lời"
            value={data.messagesUnreplied}
            icon={MessageSquareWarning}
            tone="warning"
            hint="Cần xử lý"
          />
          <StatCard label="Chưa đọc" value={data.messagesUnread} icon={MailOpen} hint="Tin nhắn chưa xem" />
          <StatCard
            label="Lịch hẹn hôm nay"
            value={data.appointmentsToday}
            icon={CalendarClock}
            tone="success"
          />
          <StatCard
            label="KH mới tuần này"
            value={data.newContactsThisWeek}
            icon={UserPlus}
            hint="Trong 7 ngày qua"
          />
          <StatCard label="Tổng khách hàng" value={data.totalContacts} icon={Users} hint="Đang hoạt động" />
        </div>
      )}

      {/* ★ Khối báo cáo chính: Hiệu quả Chat → Đơn hàng */}
      <ChatOrderReport />
    </div>
  )
}
