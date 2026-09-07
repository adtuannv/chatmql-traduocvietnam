/**
 * resources-dialog.tsx — Panel "Thư viện" của một hội thoại.
 *
 * Mở từ icon cạnh nút chế độ AI. Gom mọi thứ đã trao đổi với khách qua
 * `GET /conversations/:id/shared-media` (backend TDVN — 50 tin mới nhất, hook
 * `useConversationResources` bóc `content` JSON thành ResourceItem) và chia
 * 3 tab: Ảnh/Video · Files · Links.
 *
 * Panel trượt từ mép phải (giống Zalo) thay vì hộp thoại giữa màn hình, để
 * nhân viên vẫn nhìn thấy mạch hội thoại bên trái khi tra tài nguyên.
 */
import { useMemo, useState } from 'react'
import { Download, FileText, Link2, Play, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/misc'
import { EmptyState, ErrorState, Loading } from '@/components/shared/feedback'
import { useConversationResources, type ResourceItem } from '@/hooks/use-conversations'
import { formatClock } from './lib'

interface Props {
  conversationId: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 29983 → "29,3 KB". Zalo chỉ trả cỡ tệp, các loại khác không có. */
function formatSize(bytes?: number): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1).replace('.', ',')} ${units[unit]}`
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** Tên miền để nhận diện nhanh link, ví dụ "facebook.com". */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Ô ảnh/video vuông trong lưới. */
function MediaCell({ item }: { item: ResourceItem }) {
  const [broken, setBroken] = useState(false)
  const preview = item.thumb || item.url
  const isVideo = item.kind === 'video'

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      title={`${isVideo ? 'Video' : 'Ảnh'} · ${formatDay(item.sentAt)} ${formatClock(item.sentAt)}`}
      className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
    >
      {broken || (isVideo && !item.thumb) ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
          {isVideo ? <Play className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
          <span className="text-[10px]">{isVideo ? 'Video' : 'Không tải được'}</span>
        </div>
      ) : (
        <img
          src={preview}
          alt={item.title || ''}
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      )}
      {isVideo && !broken && item.thumb && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
          <Play className="h-6 w-6 fill-white text-white" />
        </span>
      )}
    </a>
  )
}

/** Một dòng tệp hoặc liên kết. */
function ResourceRow({ item }: { item: ResourceItem }) {
  const isLink = item.kind === 'link'
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-lg border p-2.5 transition-colors hover:bg-accent"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {isLink ? <Link2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {item.title || (isLink ? hostOf(item.url) : 'Tệp đính kèm')}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {isLink ? item.url : [formatSize(item.size), formatDay(item.sentAt)].filter(Boolean).join(' · ')}
        </span>
      </span>
      {isLink ? (
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
    </a>
  )
}

export function ResourcesDialog({ conversationId, open, onOpenChange }: Props) {
  // `enabled` theo `open` — chỉ gọi API khi nhân viên thực sự mở panel.
  const { data, isLoading, isError } = useConversationResources(conversationId, open)

  const tabs = useMemo(
    () => [
      { value: 'media', label: 'Ảnh/Video', items: data?.media ?? [], empty: 'Chưa có ảnh hay video nào.' },
      { value: 'files', label: 'Files', items: data?.files ?? [], empty: 'Chưa có tệp nào.' },
      { value: 'links', label: 'Links', items: data?.links ?? [], empty: 'Chưa có liên kết nào.' },
    ],
    [data],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="left-auto right-0 top-0 h-full max-h-full w-full max-w-md translate-x-0 translate-y-0 grid-rows-[auto_1fr] gap-0 rounded-none border-y-0 border-r-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-base">Thư viện</DialogTitle>
          <DialogDescription className="text-xs">
            Ảnh, tệp và liên kết đã trao đổi trong hội thoại này.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loading label="Đang tải tài nguyên…" />
          </div>
        ) : isError ? (
          <div className="p-4">
            <ErrorState message="Không tải được tài nguyên của hội thoại." />
          </div>
        ) : (
          <Tabs defaultValue="media" className="flex min-h-0 flex-col">
            <TabsList className="mx-4 mt-3 grid w-auto shrink-0 grid-cols-3">
              {tabs.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="text-xs">
                  {t.label}
                  {t.items.length > 0 && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">{t.items.length}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            {tabs.map((t) => (
              <TabsContent key={t.value} value={t.value} className="mt-0 min-h-0 flex-1">
                <ScrollArea className="h-full">
                  {t.items.length === 0 ? (
                    <div className="p-6">
                      <EmptyState title="Chưa có gì trong mục này." description={t.empty} />
                    </div>
                  ) : t.value === 'media' ? (
                    <div className="grid grid-cols-3 gap-2 p-4">
                      {t.items.map((item) => (
                        <MediaCell key={item.id} item={item} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 p-4">
                      {t.items.map((item) => (
                        <ResourceRow key={item.id} item={item} />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
