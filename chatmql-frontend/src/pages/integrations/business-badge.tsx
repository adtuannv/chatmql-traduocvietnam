/**
 * business-badge.tsx — Đánh dấu nick Zalo cá nhân là Business (Pro) hay thường.
 *
 * Zalo Business có hạn mức gửi và bộ tính năng khác tài khoản thường, nên khi
 * chia việc cho từng nick thì phải nhìn là biết ngay. Dữ liệu vốn đã có sẵn
 * trong cơ sở dữ liệu nhưng không màn nào hiện ra, cũng không chỗ nào sửa —
 * đội vận hành phải nhớ trong đầu nick nào là Pro.
 *
 * Chỉ quản trị mới đổi được; người khác vẫn thấy nhãn nhưng không bấm được.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { BadgeCheck, Check, ChevronDown, Circle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { apiError } from '@/lib/api-client'
import { useSetZaloBusiness, type ChannelAccount } from '@/hooks/use-integrations'

/** Nhãn chỉ để xem — dùng ở những chỗ không cho sửa. */
export function BusinessBadge({ acc }: { acc: ChannelAccount }) {
  if (!acc.isBusiness) return null
  return (
    <Badge className="h-[18px] gap-0.5 border-amber-300 bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-100">
      <BadgeCheck className="h-3 w-3" />
      {(acc.businessTier || 'pro').toUpperCase()}
    </Badge>
  )
}

export function BusinessSwitch({ acc, canEdit }: { acc: ChannelAccount; canEdit: boolean }) {
  const dat = useSetZaloBusiness()
  const [mo, setMo] = useState(false)

  if (!canEdit) return <BusinessBadge acc={acc} />

  const doi = (isBusiness: boolean, tier?: string) => {
    dat.mutate(
      { id: acc.id, isBusiness, businessTier: tier },
      {
        onSuccess: () => {
          toast.success(isBusiness ? `Đã đánh dấu Business ${(tier || 'pro').toUpperCase()}` : 'Đã chuyển về tài khoản thường')
          setMo(false)
        },
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  const dangChon = acc.isBusiness ? (acc.businessTier || 'pro') : ''

  return (
    <DropdownMenu open={mo} onOpenChange={setMo}>
      <DropdownMenuTrigger
        className={cn(
          'flex h-[18px] shrink-0 items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-semibold transition-colors',
          acc.isBusiness
            ? 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200'
            : 'border-border bg-muted text-muted-foreground hover:bg-accent',
        )}
        title="Đổi loại tài khoản"
      >
        {dat.isPending
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : acc.isBusiness ? <BadgeCheck className="h-3 w-3" /> : <Circle className="h-2.5 w-2.5" />}
        {acc.isBusiness ? (acc.businessTier || 'pro').toUpperCase() : 'Thường'}
        <ChevronDown className="h-2.5 w-2.5 opacity-60" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem className="gap-2" onSelect={() => doi(false)}>
          <Circle className="h-3 w-3 shrink-0" />
          <span className="flex-1">
            <span className="block text-[13px]">Tài khoản thường</span>
            <span className="block text-[11px] text-muted-foreground">Hạn mức gửi tiêu chuẩn</span>
          </span>
          {!acc.isBusiness && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
        </DropdownMenuItem>

        {(['pro', 'business'] as const).map((t) => (
          <DropdownMenuItem key={t} className="gap-2" onSelect={() => doi(true, t)}>
            <BadgeCheck className="h-3 w-3 shrink-0 text-amber-600" />
            <span className="flex-1">
              <span className="block text-[13px]">Zalo Business — {t.toUpperCase()}</span>
              <span className="block text-[11px] text-muted-foreground">
                {t === 'pro' ? 'Gói Pro, hạn mức cao hơn' : 'Gói Business cơ bản'}
              </span>
            </span>
            {dangChon === t && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
