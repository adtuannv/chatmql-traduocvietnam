import { useState } from 'react'
import { CopyCheck, RefreshCw, GitMerge, X } from 'lucide-react'
import dayjs from 'dayjs'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { Loading, EmptyState, ErrorState } from '@/components/shared/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/lib/utils'
import { apiError } from '@/lib/api-client'
import {
  stageBadgeVariant,
  stageLabel,
  useDismissDuplicateGroup,
  useDuplicateGroups,
  useMergeDuplicateGroup,
  useScanDuplicates,
  type DuplicateContact,
  type DuplicateGroup,
} from '@/hooks/use-contacts'

const MATCH_LABELS: Record<string, string> = {
  avatar: 'Ảnh đại diện',
  phone: 'Số điện thoại',
  email: 'Email',
}

export function DuplicateContactsPage() {
  const { data, isLoading, isError } = useDuplicateGroups()
  const scan = useScanDuplicates()

  const onScan = () => {
    scan.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(`Đã quét ${r.scanned} liên hệ · tìm thấy ${r.newGroups} nhóm mới`),
      onError: (e) => toast.error(apiError(e)),
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liên hệ trùng"
        description="Phát hiện và gộp các liên hệ trùng lặp theo số điện thoại, email hoặc ảnh đại diện."
        actions={
          <Button onClick={onScan} disabled={scan.isPending}>
            <RefreshCw className={`h-4 w-4 ${scan.isPending ? 'animate-spin' : ''}`} />
            {scan.isPending ? 'Đang quét...' : 'Quét trùng lặp'}
          </Button>
        }
      />

      {isLoading ? (
        <Loading label="Đang tải nhóm trùng lặp..." />
      ) : isError ? (
        <ErrorState />
      ) : !data?.groups.length ? (
        <EmptyState
          icon={CopyCheck}
          title="Không có nhóm trùng lặp"
          description="Nhấn “Quét trùng lặp” để tìm các liên hệ có thể bị trùng."
        />
      ) : (
        <div className="space-y-4">
          {data.groups.map((g) => (
            <DuplicateGroupCard key={g.id} group={g} />
          ))}
        </div>
      )}
    </div>
  )
}

function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const merge = useMergeDuplicateGroup()
  const dismiss = useDismissDuplicateGroup()
  const [primaryId, setPrimaryId] = useState(group.contacts[0]?.id ?? '')

  const onMerge = () => {
    if (!primaryId) return
    if (!confirm('Gộp toàn bộ liên hệ trong nhóm vào liên hệ chính đã chọn?')) return
    merge.mutate(
      { groupId: group.id, primaryContactId: primaryId },
      {
        onSuccess: (r: { mergedCount?: number }) =>
          toast.success(`Đã gộp ${r.mergedCount ?? ''} liên hệ`),
        onError: (e) => toast.error(apiError(e)),
      },
    )
  }

  const onDismiss = () =>
    dismiss.mutate(group.id, {
      onSuccess: () => toast.success('Đã bỏ qua nhóm này'),
      onError: (e) => toast.error(apiError(e)),
    })

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Badge variant="warning">{MATCH_LABELS[group.matchType] ?? group.matchType}</Badge>
          <span className="text-sm font-normal text-muted-foreground">
            {group.contacts.length} liên hệ · độ tin cậy {Math.round(group.confidence * 100)}%
          </span>
        </CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onDismiss} disabled={dismiss.isPending}>
            <X className="h-4 w-4" /> Bỏ qua
          </Button>
          <Button size="sm" onClick={onMerge} disabled={merge.isPending || !primaryId}>
            <GitMerge className="h-4 w-4" /> Gộp vào liên hệ chính
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">Chọn liên hệ chính để giữ lại:</p>
        {group.contacts.map((c) => (
          <DuplicateRow
            key={c.id}
            contact={c}
            selected={primaryId === c.id}
            onSelect={() => setPrimaryId(c.id)}
          />
        ))}
      </CardContent>
    </Card>
  )
}

function DuplicateRow({
  contact,
  selected,
  onSelect,
}: {
  contact: DuplicateContact
  selected: boolean
  onSelect: () => void
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
      }`}
    >
      <input
        type="radio"
        checked={selected}
        onChange={onSelect}
        className="h-4 w-4 accent-primary"
      />
      <Avatar className="h-9 w-9">
        {contact.avatarUrl && <AvatarImage src={contact.avatarUrl} alt={contact.fullName ?? ''} />}
        <AvatarFallback>{initials(contact.fullName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{contact.fullName || 'Chưa có tên'}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[contact.phone, contact.email].filter(Boolean).join(' · ') || 'Không có liên hệ'}
        </p>
      </div>
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <Badge variant={stageBadgeVariant(contact.lifecycleStage)}>
          {stageLabel(contact.lifecycleStage)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {contact._count?.conversations ?? 0} hội thoại
        </span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {dayjs(contact.createdAt).format('DD/MM/YYYY')}
        </span>
      </div>
    </label>
  )
}
