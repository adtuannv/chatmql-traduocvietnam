import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { useMyPermissions } from '@/hooks/use-settings'
import { FEATURES } from '@/lib/features'
import { Loading, EmptyState } from './feedback'
import type { Role } from '@/types/api'

/**
 * Yêu cầu đã đăng nhập; nếu chưa → /login.
 * `roles`      — vai trò gốc được vào (lớp cũ, bám chỗ backend trả 403).
 * `permission` — khoá quyền động (`module.view`): thiếu quyền thì hiện màn
 *                "không có quyền" thay vì redirect (redirect về /dashboard có
 *                thể vòng lặp khi chính dashboard cũng bị cấm).
 * Server luôn kiểm tra lại — đây chỉ là lớp trải nghiệm.
 */
export function ProtectedRoute({
  children, roles, permission,
}: { children: ReactNode; roles?: Role[]; permission?: string }) {
  const { user, loading } = useAuthStore()
  const location = useLocation()
  const permsQ = useMyPermissions()

  if (loading) return <Loading label="Đang tải..." className="h-screen" />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />

  if (permission && FEATURES.ROLES_PERMISSIONS) {
    if (permsQ.isLoading) return <Loading label="Đang tải..." className="h-screen" />
    if (permsQ.data && !permsQ.data.has(permission)) {
      return (
        <div className="flex h-[60vh] items-center justify-center">
          <EmptyState
            icon={ShieldAlert}
            title="Bạn không có quyền vào mục này"
            description="Vai trò của bạn chưa được cấp quyền xem. Liên hệ quản trị viên nếu bạn cần truy cập."
          />
        </div>
      )
    }
  }
  return <>{children}</>
}
