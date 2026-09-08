/**
 * channel-picker.tsx — Phần dùng chung của mọi bảng chọn tài khoản kênh.
 *
 * Có hai chỗ chọn tài khoản: bộ lọc ở màn Hội thoại và "Kênh áp dụng" ở màn
 * huấn luyện AI. Trước đây mỗi nơi tự dựng một kiểu, nên sửa một chỗ là chỗ kia
 * lệch. Gom về đây để hai bảng luôn hành xử giống nhau.
 *
 * Với 23 tài khoản mà tên lại na ná nhau ("Hoài Chang Trà Dược…" bốn dòng liền)
 * thì cuộn tay là hỏng việc — nên có ô tìm và danh sách giới hạn chiều cao.
 */
import { useMemo, useState } from 'react'
import { Search, Users, X } from 'lucide-react'
import { CHANNEL_GROUPS, groupOfPlatform, type ChannelGroupId } from '@/lib/channel-groups'
import { cn } from '@/lib/utils'
import type { ChannelAccount } from '@/hooks/use-integrations'

/**
 * Cao vừa đúng 10 dòng rồi cuộn.
 *
 * Đủ để thấy danh sách là một danh sách chứ không phải vài dòng cụt, mà không
 * chiếm hết màn hình. Ai cần dòng thứ 11 thì gõ vào ô tìm nhanh hơn cuộn.
 */
export const CAO_TOI_DA_10_DONG = 'max-h-[22.5rem] overflow-y-auto overscroll-contain'

/** Bỏ dấu để gõ "hoai chang" vẫn ra "Hoài Chang". */
function boDau(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
}

export interface BoLocKenh {
  tuKhoa: string
  datTuKhoa: (v: string) => void
  nhom: ChannelGroupId | null
  datNhom: (v: ChannelGroupId | null) => void
  /** Các nhóm THẬT SỰ có tài khoản — nhóm rỗng chỉ tổ nhiễu. */
  cacNhom: Array<{ id: ChannelGroupId; label: string; count: number; icon: typeof Users }>
  /** Danh sách sau khi lọc theo nhóm và từ khoá. */
  hienThi: ChannelAccount[]
  tong: number
}

export function useBoLocKenh(list: ChannelAccount[]): BoLocKenh {
  const [tuKhoa, datTuKhoa] = useState('')
  const [nhom, datNhom] = useState<ChannelGroupId | null>(null)

  const cacNhom = useMemo(() => {
    const dem = new Map<ChannelGroupId, number>()
    for (const a of list) {
      const g = groupOfPlatform(a.platform)
      dem.set(g, (dem.get(g) ?? 0) + 1)
    }
    return CHANNEL_GROUPS
      .map((g) => ({ id: g.id, label: g.label, count: dem.get(g.id) ?? 0, icon: g.icon }))
      .filter((g) => g.count > 0)
  }, [list])

  const nhomHopLe = nhom && cacNhom.some((g) => g.id === nhom) ? nhom : null

  const hienThi = useMemo(() => {
    const q = boDau(tuKhoa.trim())
    return list.filter((a) => {
      if (nhomHopLe && groupOfPlatform(a.platform) !== nhomHopLe) return false
      if (!q) return true
      return boDau(`${a.displayName ?? ''} ${a.phone ?? ''}`).includes(q)
    })
  }, [list, nhomHopLe, tuKhoa])

  return { tuKhoa, datTuKhoa, nhom: nhomHopLe, datNhom, cacNhom, hienThi, tong: list.length }
}

/** Ô tìm. Chặn phím nổi lên trên vì Radix nuốt ký tự để làm gõ-tắt-chọn-mục. */
export function OTimKenh({
  value, onChange, placeholder = 'Tìm tài khoản…',
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative px-2 pb-1.5">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border bg-background pl-7 pr-7 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Xoá từ khoá"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/** Thẻ lọc theo nền tảng — icon trước, bo góc nhỏ chứ không bo tròn. */
export function TheLocKenh({ loc }: { loc: BoLocKenh }) {
  if (loc.cacNhom.length < 2) return null
  return (
    <div className="flex flex-wrap gap-1 px-2 pb-2">
      <NutLoc
        icon={Users}
        label="Tất cả"
        count={loc.tong}
        active={!loc.nhom}
        onClick={() => loc.datNhom(null)}
      />
      {loc.cacNhom.map((g) => (
        <NutLoc
          key={g.id}
          icon={g.icon}
          label={g.label}
          count={g.count}
          active={loc.nhom === g.id}
          onClick={() => loc.datNhom(g.id)}
        />
      ))}
    </div>
  )
}

function NutLoc({
  icon: Icon, label, count, active, onClick,
}: {
  icon: typeof Users
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-transparent bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
}
