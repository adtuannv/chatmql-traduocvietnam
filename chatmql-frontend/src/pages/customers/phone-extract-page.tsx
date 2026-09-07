import { useState } from 'react'
import { PhoneIncoming, ScanSearch, Check } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { StatCard } from '@/components/shared/stat-card'
import { EmptyState } from '@/components/shared/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/misc'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { initials } from '@/lib/utils'
import { apiError } from '@/lib/api-client'
import { useExtractPhones, type PhoneMatch } from '@/hooks/use-contacts'

export function PhoneExtractPage() {
  const extract = useExtractPhones()
  const [matches, setMatches] = useState<PhoneMatch[] | null>(null)
  const [scanned, setScanned] = useState<number | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const onScan = () => {
    extract.mutate(
      { dryRun: true },
      {
        onSuccess: (r) => {
          setMatches(r.matches ?? [])
          setScanned(r.scanned)
          setExcluded(new Set())
          toast.success(`Đã quét ${r.scanned} liên hệ · tìm thấy ${r.matched} số điện thoại`)
        },
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectedCount = (matches?.length ?? 0) - excluded.size

  const onApply = () => {
    if (!matches?.length) return
    if (selectedCount === 0) {
      toast.error('Chưa chọn liên hệ nào để áp dụng')
      return
    }
    if (!confirm(`Cập nhật số điện thoại cho ${selectedCount} liên hệ?`)) return
    extract.mutate(
      { dryRun: false, excludeIds: [...excluded] },
      {
        onSuccess: (r) => {
          toast.success(`Đã cập nhật ${r.updated} liên hệ`)
          setMatches(null)
          setScanned(null)
          setExcluded(new Set())
        },
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  const isApplying = extract.isPending

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trích số điện thoại"
        description="Quét các liên hệ chưa có số điện thoại và tự động lấy số từ tên hiển thị."
        actions={
          <Button onClick={onScan} disabled={isApplying}>
            <ScanSearch className="h-4 w-4" /> Quét liên hệ
          </Button>
        }
      />

      {matches === null ? (
        <EmptyState
          icon={PhoneIncoming}
          title="Chưa quét"
          description="Nhấn “Quét liên hệ” để tìm các số điện thoại ẩn trong tên liên hệ."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Đã quét" value={scanned ?? 0} icon={ScanSearch} hint="Liên hệ chưa có SĐT" />
            <StatCard label="Tìm thấy" value={matches.length} icon={PhoneIncoming} tone="success" />
            <StatCard label="Sẽ cập nhật" value={selectedCount} icon={Check} tone="warning" />
          </div>

          {matches.length === 0 ? (
            <EmptyState title="Không tìm thấy số điện thoại nào" description="Tất cả liên hệ đều đã có số hoặc không chứa số hợp lệ." />
          ) : (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Kết quả ({matches.length})</CardTitle>
                <Button onClick={onApply} disabled={isApplying || selectedCount === 0}>
                  <Check className="h-4 w-4" />
                  {isApplying ? 'Đang áp dụng...' : `Áp dụng (${selectedCount})`}
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {matches.map((m) => {
                  const checked = !excluded.has(m.id)
                  return (
                    <label
                      key={m.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggle(m.id)} />
                      <Avatar className="h-9 w-9">
                        <AvatarFallback>{initials(m.fullName)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{m.fullName || 'Chưa có tên'}</p>
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums text-primary">
                        {m.extractedPhone}
                      </span>
                    </label>
                  )
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
