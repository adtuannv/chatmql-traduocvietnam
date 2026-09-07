import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MessagesSquare, ChevronsLeftRight } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { EmptyState } from '@/components/shared/feedback'
import { cn } from '@/lib/utils'
import {
  useConversation,
  useConversationCounts,
  useConversations,
  useConversationListRealtime,
  useMarkRead,
  useMarkAllRead,
} from '@/hooks/use-conversations'
import { ConversationList } from './conversation-list'
import { ChatPanel } from './chat-panel'
import { CrmPanel } from './crm-panel'
import { OrderForm } from './order-form'
import { useCrmPanelStore } from '@/stores/crm-panel-store'
import { FilterRail, type ConvFilter } from './filter-rail'
import { AddFriendDialog } from './add-friend-dialog'
import { AppRail } from './app-rail'
import { ConnectionsDialog, AppSettingsDialog, useMiniApps } from './embedded-apps-dialogs'

/** Trang Hội thoại — inbox realtime: cột lọc + danh sách + khung chat + hồ sơ KH. */
export function ConversationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { id: activeId } = useParams<{ id: string }>()

  const [filter, setFilter] = useState<ConvFilter>('all')
  const [accountId, setAccountId] = useState<string | undefined>()
  const [tag, setTag] = useState<string | undefined>()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  // Sidebar nhận realtime từ phòng org kể cả khi chưa mở hội thoại nào
  useConversationListRealtime()

  const [addFriendOpen, setAddFriendOpen] = useState(false)
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const { activeApps } = useMiniApps()

  // Tab đang mở của cột phải TDVN (Thông tin · Ghi chú · Tạo đơn · Tài liệu) — store
  // nhỏ vì nút "Lên đơn" nằm ở khung chat, cây component khác.
  const activeTab = useCrmPanelStore((s) => s.activeTab)
  const setTab = useCrmPanelStore((s) => s.setTab)

  // Chiều rộng cột CRM — kéo được, tối đa nửa màn hình, nhớ giữa các lần dùng.
  // Form tạo đơn cần tối thiểu 320px; mặc định 365px cho vừa lưới trường.
  const RIGHT_MIN = 320
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('chatmql_contact_panel_w'))
    return Number.isFinite(saved) && saved >= RIGHT_MIN ? saved : 365
  })
  const [resizing, setResizing] = useState(false)

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = rightWidth
      const maxW = Math.floor(window.innerWidth / 2) // tối đa nửa màn hình
      setResizing(true)

      const onMove = (ev: MouseEvent) => {
        // Kéo sang trái = rộng ra (cột nằm bên phải)
        const next = Math.min(maxW, Math.max(RIGHT_MIN, startW - (ev.clientX - startX)))
        setRightWidth(next)
      }
      const onUp = () => {
        setResizing(false)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'col-resize'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [rightWidth],
  )

  // Lưu lại chiều rộng khi thả chuột
  useEffect(() => {
    if (!resizing) localStorage.setItem('chatmql_contact_panel_w', String(rightWidth))
  }, [resizing, rightWidth])

  // Debounce ô tìm kiếm.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data, isLoading, isError } = useConversations({
    search,
    accountId,
    tag,
    unread: filter === 'unread',
    unreplied: filter === 'unreplied',
    // "AI tư vấn" = hội thoại đang để AI tự trả lời.
    aiMode: filter === 'ai' ? 'auto' : undefined,
    pinned: filter === 'pinned',
  })
  const { data: counts } = useConversationCounts()
  const { data: activeConv } = useConversation(activeId)
  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()

  const conversations = useMemo(() => data?.conversations ?? [], [data])

  // Đánh dấu đã đọc khi mở một hội thoại (một lần cho mỗi id).
  const markedRef = useRef<string | null>(null)
  useEffect(() => {
    if (activeId && markedRef.current !== activeId) {
      markedRef.current = activeId
      markRead.mutate(activeId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  function handleSelect(id: string) {
    navigate(`/conversations/${id}`)
  }

  async function handleMarkAllRead() {
    try {
      const res = await markAllRead.mutateAsync(accountId)
      toast.success(`Đã đánh dấu ${res.updated} hội thoại là đã đọc`)
    } catch {
      toast.error('Không đánh dấu được. Vui lòng thử lại.')
    }
  }

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ['conversations'] })
    queryClient.invalidateQueries({ queryKey: ['conversation-counts'] })
    toast.success('Đã làm mới')
  }

  return (
    <>
      <div className="flex h-[calc(100vh-8rem)] min-h-[520px] overflow-hidden rounded-xl border bg-card">
        {/* Cột lọc (icon) */}
        <FilterRail
          filter={filter}
          onFilterChange={setFilter}
          accountId={accountId}
          onAccountChange={setAccountId}
          counts={counts}
        />

        {/* Cột danh sách hội thoại */}
        <aside className="flex w-72 shrink-0 flex-col border-r lg:w-80">
          <ConversationList
            items={conversations}
            activeId={activeId}
            search={searchInput}
            tag={tag}
            isLoading={isLoading}
            isError={isError}
            onSearchChange={setSearchInput}
            onTagChange={setTag}
            onSelect={handleSelect}
            onAddFriend={() => setAddFriendOpen(true)}
            onMarkAllRead={handleMarkAllRead}
            onRefresh={handleRefresh}
          />
        </aside>

        {/* Cột giữa: khung chat */}
        <main className="flex min-w-0 flex-1 flex-col">
          {activeId ? (
            <ChatPanel key={activeId} convId={activeId} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={MessagesSquare}
                title="Chọn một hội thoại"
                description="Chọn hội thoại ở cột bên trái để bắt đầu trò chuyện."
              />
            </div>
          )}
        </main>

        {/* Cột phải: thông tin khách hàng */}
        {/* Thanh kéo để mở rộng cột thông tin khách hàng */}
        <div
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Kéo để đổi chiều rộng khung thông tin"
          title="Kéo để đổi chiều rộng"
          className={cn(
            'group relative hidden w-1.5 shrink-0 cursor-col-resize xl:block',
            resizing ? 'bg-primary/40' : 'hover:bg-primary/20',
          )}
        >
          <span
            className={cn(
              'absolute left-1/2 top-1/2 flex h-8 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center',
              'rounded-full border bg-card text-muted-foreground shadow-sm transition-opacity',
              resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <ChevronsLeftRight className="h-3 w-3" />
          </span>
        </div>

        <aside
          className="hidden shrink-0 border-l xl:block"
          style={{ width: rightWidth }}
        >
          <AppRail
            apps={activeApps}
            onOpenConnections={() => setConnectionsOpen(true)}
            onOpenAppSettings={() => setAppSettingsOpen(true)}
          >
            {activeId ? (
              <CrmPanel
                convId={activeId}
                conv={activeConv}
                activeTab={activeTab}
                onTabChange={setTab}
                orderSlot={
                  <OrderForm
                    convId={activeId}
                    onCreated={() => {
                      queryClient.invalidateQueries({ queryKey: ['orders'] })
                      queryClient.invalidateQueries({ queryKey: ['conversations'] })
                    }}
                  />
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Thông tin khách hàng sẽ hiển thị tại đây.
              </div>
            )}
          </AppRail>
        </aside>
      </div>

      <AddFriendDialog open={addFriendOpen} onOpenChange={setAddFriendOpen} />
      <ConnectionsDialog open={connectionsOpen} onOpenChange={setConnectionsOpen} />
      <AppSettingsDialog open={appSettingsOpen} onOpenChange={setAppSettingsOpen} />
    </>
  )
}
