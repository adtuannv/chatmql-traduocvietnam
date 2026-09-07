import { Construction } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/feedback'

/** Placeholder tạm cho các trang chưa triển khai (sẽ được thay bằng trang thật). */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <EmptyState
        icon={Construction}
        title="Trang đang được xây dựng"
        description={`Chức năng "${title}" sẽ sớm hoàn thiện.`}
      />
    </div>
  )
}
