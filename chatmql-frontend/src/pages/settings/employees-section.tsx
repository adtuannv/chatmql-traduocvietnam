/**
 * employees-section.tsx — Module "Quản lý nhân viên".
 *
 * Gộp ba mục cũ (Nhân sự · Sơ đồ tổ chức · Phân quyền tài khoản) làm một, vì cả
 * ba đều xoay quanh MỘT quan hệ nhiều-nhiều duy nhất trong bảng
 * `ChannelAccountAccess`:
 *
 *     một nhân viên  ──phụ trách──  nhiều tài khoản giao tiếp
 *     một tài khoản  ──dùng chung── nhiều nhân viên
 *
 * Tách làm ba màn khiến người dùng phải nhớ sửa ở đâu mới đúng. Ở đây chỉ có hai
 * CHIỀU NHÌN của cùng dữ liệu, sửa bên nào cũng ra kết quả như nhau:
 *   · Theo nhân viên — ai đang giữ những tài khoản nào (mặc định, dùng nhiều nhất)
 *   · Theo tài khoản — tài khoản này đang có ai trực
 */
import { useState } from 'react'
import { Radio, Users } from 'lucide-react'
import { TeamTab } from './team-tab'
import { PermissionsSection } from './permissions-section'
import { cn } from '@/lib/utils'

type View = 'by-employee' | 'by-account'

const VIEWS: { id: View; label: string; icon: typeof Users; hint: string }[] = [
  {
    id: 'by-employee', label: 'Theo nhân viên', icon: Users,
    hint: 'Danh sách người có tài khoản đăng nhập ChatMQL và những kênh họ đang phụ trách.',
  },
  {
    id: 'by-account', label: 'Theo tài khoản', icon: Radio,
    hint: 'Từng tài khoản giao tiếp đang giao cho những ai — tiện khi cần bổ sung người trực.',
  },
]

export function EmployeesSection() {
  const [view, setView] = useState<View>('by-employee')
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border p-0.5">
          {VIEWS.map((v) => {
            const Icon = v.icon
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  v.id === view
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">{current.hint}</p>
      </div>

      {view === 'by-employee' ? <TeamTab /> : <PermissionsSection />}
    </div>
  )
}
