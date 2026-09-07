/**
 * group-members-menu.tsx — Nút "Thành viên (n) ⌄" ngay dưới tên nhóm.
 * Mở danh sách thành viên (avatar · tên · uid) theo mẫu: nút Đồng bộ kéo lại
 * từ Zalo, nút Xóa gỡ thành viên (cần quyền trưởng/phó nhóm trên Zalo).
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Users, ChevronDown, RefreshCw, MinusCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
} from '@/components/ui/dropdown-menu'
import { apiError } from '@/lib/api-client'
import { FEATURES } from '@/lib/features'
import { initials } from '@/lib/utils'
import {
  refreshGroupMembers, useRemoveGroupMember, type GroupMember,
} from '@/hooks/use-conversations'

export function GroupMembersMenu({ convId, members }: {
  convId: string
  members: GroupMember[]
}) {
  const qc = useQueryClient()
  const removeMember = useRemoveGroupMember(convId)
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    try {
      await refreshGroupMembers(convId)
      await qc.invalidateQueries({ queryKey: ['conversation', convId, 'group-members'] })
      toast.success('Đã đồng bộ thành viên từ Zalo')
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSyncing(false)
    }
  }

  async function handleRemove(m: GroupMember) {
    if (!window.confirm(`Gỡ "${m.name}" khỏi nhóm Zalo?`)) return
    try {
      await removeMember.mutateAsync({ memberId: m.uid })
      toast.success(`Đã gỡ ${m.name} khỏi nhóm`)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Users className="h-3.5 w-3.5" />
          Thành viên ({members.length})
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Users className="h-4 w-4" /> Thành viên ({members.length})
          </span>
          <Button variant="outline" size="sm" onClick={() => void handleSync()} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} /> Đồng bộ
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {members.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              Chưa có dữ liệu thành viên — bấm "Đồng bộ" để kéo từ Zalo.
            </p>
          ) : members.map((m) => (
            <div key={m.uid} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
              <Avatar className="h-8 w-8">
                {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.name} />}
                <AvatarFallback>{initials(m.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {m.name}
                  {m.isAdmin && <Badge variant="secondary" className="px-1.5 text-[10px]">Quản trị</Badge>}
                </p>
                <p className="truncate text-[11px] text-primary">zlw{m.uid}</p>
              </div>
              {/* Backend TDVN không có /remove-member → ẩn nút */}
              {FEATURES.CHAT_REMOVE_MEMBER && (
                <Button
                  variant="outline" size="sm"
                  disabled={removeMember.isPending}
                  onClick={() => void handleRemove(m)}
                >
                  <MinusCircle className="h-3.5 w-3.5" /> Xóa
                </Button>
              )}
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
