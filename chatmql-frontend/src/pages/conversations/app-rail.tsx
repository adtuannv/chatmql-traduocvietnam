import { useEffect, useMemo, useState } from 'react'
import { Bot, ExternalLink, Settings2, User } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Loading } from '@/components/shared/feedback'
import { cn } from '@/lib/utils'
import { AiAssistantPanel } from './ai-assistant-panel'

/** Một mini-app nhúng ở cột phải màn Hội thoại (webview/form). */
export interface MiniApp {
  id: string
  name: string
  url: string
  /** Đường dẫn ảnh icon, có thể rỗng → dùng chữ cái đầu của tên. */
  icon?: string
  description?: string
  active: boolean
  order?: number
}

interface Props {
  /** Danh sách app đã lọc `active` và sắp xếp sẵn. */
  apps: MiniApp[]
  onOpenConnections: () => void
  onOpenAppSettings: () => void
  /** Nội dung tab mặc định "Thông tin khách hàng". */
  children: React.ReactNode
}

/** Id ảo của tab mặc định (hồ sơ khách hàng) — không trùng id app thật. */
const CONTACT_TAB = '__contact__'
/** Id ảo của tab "AI Trợ lý" nội bộ — cũng không trùng id app thật. */
const ASSISTANT_TAB = '__assistant__'

/** Ảnh icon của app, tự fallback sang chữ cái đầu khi ảnh lỗi/không có. */
function AppIcon({ app }: { app: MiniApp }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [app.icon])

  if (!app.icon || broken) {
    return (
      <span className="text-[13px] font-semibold uppercase leading-none">
        {app.name.trim().charAt(0) || '?'}
      </span>
    )
  }
  return (
    <img
      src={app.icon}
      alt=""
      className="h-5 w-5 object-contain"
      onError={() => setBroken(true)}
    />
  )
}

/**
 * Thanh icon mini-app nằm ngang dưới cùng cột phải.
 *
 * Icon đầu tiên luôn là "Thông tin khách hàng" (hiển thị `children`); các icon
 * sau mở webview tương ứng trong `iframe` chiếm hết chiều cao còn lại.
 */
export function AppRail({ apps, onOpenConnections, onOpenAppSettings, children }: Props) {
  const [activeId, setActiveId] = useState<string>(CONTACT_TAB)
  const [loadingFrame, setLoadingFrame] = useState(false)

  // App bị gỡ/tắt khi đang mở → quay lại tab hồ sơ khách hàng.
  useEffect(() => {
    if (activeId !== CONTACT_TAB && activeId !== ASSISTANT_TAB && !apps.some((a) => a.id === activeId)) {
      setActiveId(CONTACT_TAB)
    }
  }, [apps, activeId])

  const activeApp = useMemo(
    () => apps.find((a) => a.id === activeId),
    [apps, activeId],
  )

  const selectApp = (id: string) => {
    setActiveId(id)
    setLoadingFrame(id !== CONTACT_TAB)
  }

  const railBtn =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Vùng nội dung */}
      <div className="relative min-h-0 flex-1">
        {activeApp ? (
          <>
            <iframe
              key={activeApp.id}
              src={activeApp.url}
              title={activeApp.name}
              className="h-full w-full border-0 bg-background"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="no-referrer"
              onLoad={() => setLoadingFrame(false)}
            />
            {loadingFrame && (
              <div className="absolute inset-0 flex items-center justify-center bg-background">
                <Loading label="Đang tải ứng dụng…" />
              </div>
            )}
          </>
        ) : (
          <div className={cn('h-full', activeId === ASSISTANT_TAB && 'hidden')}>{children}</div>
        )}
        {/* Luôn mount để giữ lịch sử hỏi đáp khi đổi tab qua lại; chỉ ẩn/hiện. */}
        <div className={cn('h-full', activeId !== ASSISTANT_TAB && 'hidden')}>
          <AiAssistantPanel active={activeId === ASSISTANT_TAB} />
        </div>
      </div>
      {/* Hàng icon (đáy cột) — cuộn ngang khi nhiều app */}
      <div className="flex shrink-0 items-center gap-2 border-t bg-background px-3 py-2.5">
        {/* [&::-webkit-scrollbar]:hidden — thanh cuộn ngang chiếm chiều cao và cắt
            cụt nút khi có nhiều app; py-0.5 chừa chỗ cho viền `ring` của nút đang chọn. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            title="Thông tin khách hàng"
            aria-label="Thông tin khách hàng"
            onClick={() => selectApp(CONTACT_TAB)}
            className={cn(
              railBtn,
              'bg-muted/60 text-muted-foreground',
              activeId === CONTACT_TAB
                ? 'bg-primary/15 text-primary ring-1 ring-primary'
                : 'opacity-70 hover:opacity-100',
            )}
          >
            <User className="h-[18px] w-[18px]" />
          </button>

          {/* Tab "AI Trợ lý" — phẳng như tab hồ sơ khách, đặt ngay cạnh nó. */}
          <button
            type="button"
            title="AI Trợ lý — hỏi đáp, tra cứu thông tin nội bộ"
            aria-label="AI Trợ lý"
            onClick={() => selectApp(ASSISTANT_TAB)}
            className={cn(
              railBtn,
              'bg-muted/60 text-muted-foreground',
              activeId === ASSISTANT_TAB
                ? 'bg-primary/15 text-primary ring-1 ring-primary'
                : 'opacity-70 hover:opacity-100',
            )}
          >
            <Bot className="h-[18px] w-[18px]" />
          </button>

          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              title={app.name}
              aria-label={app.name}
              onClick={() => selectApp(app.id)}
              className={cn(
                railBtn,
                'bg-muted/60 text-muted-foreground',
                activeId === app.id
                  ? 'bg-primary/15 text-foreground ring-1 ring-primary'
                  : 'opacity-70 hover:opacity-100',
              )}
            >
              <AppIcon app={app} />
            </button>
          ))}
        </div>

        {activeApp && (
          <a
            href={activeApp.url}
            target="_blank"
            rel="noreferrer"
            title={`Mở ${activeApp.name} ở tab mới`}
            aria-label={`Mở ${activeApp.name} ở tab mới`}
            className={cn(railBtn, 'opacity-70 hover:bg-accent hover:opacity-100')}
          >
            <ExternalLink className="h-[18px] w-[18px]" />
          </a>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Cài đặt ứng dụng"
              aria-label="Cài đặt ứng dụng"
              className={cn(railBtn, 'opacity-70 hover:bg-accent hover:opacity-100')}
            >
              <Settings2 className="h-[18px] w-[18px]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onOpenConnections()}>
              Kết nối nền tảng
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenAppSettings()}>
              Cài đặt danh sách
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
