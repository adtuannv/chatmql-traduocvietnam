/**
 * settings-page.tsx — Khung màn Cài đặt: thanh tab ngang + nội dung bên dưới.
 *
 * 8 module chia 2 nhóm (Cá nhân / Tổ chức), ngăn nhau bằng vạch dọc trên thanh
 * tab. Mỗi mục khai báo `roles` để chỉ
 * hiện với vai trò backend thực sự cho phép — theo nguyên tắc BRD §5.3.1
 * "không có quyền → không render", không render rồi disable.
 *
 * Module đang chọn nằm trên URL (`?m=`) để F5 hay gửi link vẫn đúng chỗ.
 */
import { useSearchParams } from 'react-router-dom'
import {
  Building2, Lock, Smartphone, Tag, User, Users,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import type { Role } from '@/types/api'

import { ProfilePage } from './profile-page'
import { SecuritySection } from './security-section'
import { CompanyTab } from './company-tab'
import { EmployeesSection } from './employees-section'
import { TagsTab } from './tags-tab'
import { ZaloSyncSection } from './zalo-sync-section'

interface SettingsModule {
  id: string
  label: string
  icon: LucideIcon
  description: string
  render: () => React.ReactNode
  /** Bỏ trống = mọi vai trò. Bám đúng chỗ backend trả 403. */
  roles?: Role[]
}

const STAFF: Role[] = ['owner', 'admin', 'manager']

const GROUPS: { title: string; items: SettingsModule[] }[] = [
  {
    title: 'Cá nhân',
    items: [
      {
        id: 'profile', label: 'Hồ sơ của tôi', icon: User,
        description: 'Họ tên và ảnh đại diện của bạn.',
        render: () => <ProfilePage embedded />,
      },
      {
        id: 'security', label: 'Mật khẩu & Bảo mật', icon: Lock,
        description: 'Đổi mật khẩu và quản lý API key.',
        render: () => <SecuritySection />,
      },
    ],
  },
  {
    title: 'Tổ chức',
    items: [
      {
        id: 'company', label: 'Thông tin công ty', icon: Building2,
        description: 'Tên, thông tin liên hệ và cấu hình chung.',
        render: () => <CompanyTab />,
      },
      {
        id: 'employees', label: 'Quản lý nhân viên', icon: Users,
        description:
          'Tài khoản đăng nhập ChatMQL và tài khoản giao tiếp (Zalo OA · Zalo cá nhân · Facebook…) từng người phụ trách.',
        render: () => <EmployeesSection />, roles: STAFF,
      },
      {
        id: 'tags', label: 'Quản lý nhãn', icon: Tag,
        description: 'Nhãn dùng chung với thẻ phân loại ở màn Hội thoại.',
        render: () => <TagsTab />,
      },
      {
        id: 'zalo-sync', label: 'Đồng bộ & Lịch sử Zalo', icon: Smartphone,
        description: 'Đồng bộ danh bạ và kéo lịch sử tin nhắn cũ của từng tài khoản Zalo cá nhân.',
        render: () => <ZaloSyncSection />, roles: STAFF,
      },
    ],
  },
]

export function SettingsPage() {
  const role = useAuthStore((s) => s.user?.role)
  const [params, setParams] = useSearchParams()

  const groups = GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.roles || (role && i.roles.includes(role))) }))
    .filter((g) => g.items.length > 0)

  const all = groups.flatMap((g) => g.items)
  // Vai trò không được vào module trên URL → rơi về module đầu tiên hợp lệ.
  const active = all.find((m) => m.id === params.get('m')) ?? all[0]

  if (!active) return null

  return (
    <div className="space-y-4">
      <PageHeader title="Cài đặt" description="Cấu hình cá nhân và tổ chức." />

      {/* Thanh tab ngang — cuộn ngang trên màn hẹp thay vì xuống dòng lộn xộn */}
      <div className="flex items-center gap-1 overflow-x-auto border-b pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((g, gi) => (
          <div key={g.title} className="flex items-center gap-1">
            {gi > 0 && <span className="mx-1.5 h-5 w-px shrink-0 bg-border" aria-hidden />}
            {g.items.map((m) => {
              const Icon = m.icon
              const isActive = m.id === active.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setParams({ m: m.id }, { replace: true })}
                  title={m.description}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'border-primary font-semibold text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {m.label}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <section className="min-w-0">
        <p className="mb-4 text-xs text-muted-foreground">{active.description}</p>
        {active.render()}
      </section>
    </div>
  )
}
