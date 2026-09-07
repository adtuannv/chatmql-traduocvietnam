/**
 * ai-assistant-panel.tsx — Tab "AI Trợ lý" nội bộ, nằm PHẲNG trong cột phải màn
 * Hội thoại (cùng chỗ với tab "Thông tin khách hàng" và các mini-app), không
 * phải popup. Chọn icon 🤖 ở hàng đáy cột → cột chuyển sang khung này.
 *
 * Nhân viên CHỌN MỘT AGENT trong "Đội AI" (Cài đặt → AI) rồi hỏi đáp/tra cứu tự
 * do — KHÔNG gắn với hội thoại/khách hàng đang mở, KHÔNG bao giờ gửi gì ra
 * ngoài. Chọn Agent nào thì trả lời theo đúng persona/playbook của Agent đó
 * (backend: assistant-service.ts). Đổi Agent → làm mới lịch sử, tránh lẫn ngữ
 * cảnh giữa 2 Agent. Panel luôn được mount (chỉ ẩn/hiện) nên đổi tab qua lại
 * không mất lịch sử hỏi đáp.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, Sparkles, Trash2, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea, Textarea } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import { apiError } from '@/lib/api-client'
import { useAiBots } from '@/hooks/use-ai'
import { useAskAssistant, type AssistantTurn } from '@/hooks/use-ai-assistant'

const GENERAL_BOT = '__general__'

interface DisplayMessage extends AssistantTurn {
  id: string
  at: Date
  error?: boolean
}

function formatTime(d: Date): string {
  return d.toLocaleString('vi-VN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function AiAssistantPanel({ active }: { active: boolean }) {
  const botsQ = useAiBots()
  const [botId, setBotId] = useState<string>(GENERAL_BOT)
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const ask = useAskAssistant()
  const bottomRef = useRef<HTMLDivElement>(null)

  const bots = (botsQ.data?.bots ?? []).filter((b) => b.enabled)
  const activeBot = botId === GENERAL_BOT ? null : bots.find((b) => b.id === botId)
  const botEmoji = activeBot?.avatarEmoji || '🤖'

  useEffect(() => {
    if (active) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active, messages, ask.isPending])

  const changeBotId = (v: string) => {
    setBotId(v)
    setMessages([]) // đổi Agent → làm mới hội thoại, không lẫn ngữ cảnh giữa 2 Agent
  }

  const send = () => {
    const message = text.trim()
    if (!message || ask.isPending) return

    const history = messages.filter((m) => !m.error).map(({ role, text: t }) => ({ role, text: t }))
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: message, at: new Date() }])
    setText('')

    ask.mutate(
      { message, botId: botId === GENERAL_BOT ? undefined : botId, history },
      {
        onSuccess: (r) => {
          setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: r.reply, at: new Date() }])
        },
        onError: (err) => {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: 'assistant', text: apiError(err), at: new Date(), error: true },
          ])
        },
      },
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-b from-orange-50 via-orange-50/60 to-background dark:from-orange-950/30 dark:via-orange-950/10">
      {/* ── Header: tiêu đề · chọn Agent ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-orange-100 px-3 py-2.5 dark:border-orange-900/40">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight">AI Trợ lý</p>
          <p className="truncate text-[11px] text-muted-foreground">Nội bộ — không gửi cho khách</p>
        </div>

        <Select value={botId} onValueChange={changeBotId}>
          <SelectTrigger
            className="ml-auto h-9 w-auto min-w-[3.25rem] gap-1.5 rounded-lg border-orange-200 bg-background/80 px-2.5 text-sm dark:border-orange-900/50"
            aria-label="Chọn Agent để hỏi"
            title={activeBot ? `Đang hỏi: ${activeBot.name}` : 'Trợ lý chung (mặc định tổ chức)'}
          >
            <SelectValue>
              <span className="flex items-center gap-1.5">
                <span className="text-lg leading-none">{botEmoji}</span>
                <span className="max-w-[6.5rem] truncate">{activeBot?.name ?? 'Trợ lý chung'}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value={GENERAL_BOT}>🤖 Trợ lý chung (mặc định tổ chức)</SelectItem>
            {bots.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.avatarEmoji || '🤖'} {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Khung chat ── */}
      <div className="relative min-h-0 flex-1">
        {messages.length > 0 && (
          <Button
            variant="outline"
            size="icon"
            className="absolute right-3 top-3 z-10 h-8 w-8 bg-background/90"
            onClick={() => setMessages([])}
            disabled={ask.isPending}
            title="Xoá lịch sử hỏi đáp"
            aria-label="Xoá lịch sử hỏi đáp"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}

        <ScrollArea className="h-full [&>div]:!block">
          <div className="space-y-3 px-3 py-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
                <span className="text-4xl">{botEmoji}</span>
                <p className="text-sm font-medium">
                  {activeBot ? `Hỏi Agent "${activeBot.name}"` : 'Hỏi Trợ lý chung'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {activeBot
                    ? 'Trả lời theo persona/kịch bản riêng của Agent này.'
                    : 'Hỏi về sản phẩm, chính sách, quy trình bán hàng…'}
                  {' '}Chỉ dựa trên dữ liệu nội bộ — không dùng để soạn tin gửi thẳng cho khách.
                </p>
              </div>
            ) : (
              <div className="flex justify-center">
                <span className="rounded-md bg-background/80 px-3 py-1 text-[11px] italic text-muted-foreground shadow-sm">
                  {formatTime(messages[0].at)}
                </span>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={cn('flex items-end gap-2', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base',
                    m.role === 'user' ? 'bg-muted text-muted-foreground' : 'bg-background shadow-sm',
                  )}
                  aria-hidden
                >
                  {m.role === 'user' ? <User className="h-4 w-4" /> : botEmoji}
                </span>
                <div
                  className={cn(
                    'max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm',
                    m.role === 'user'
                      ? 'rounded-br-md bg-primary text-primary-foreground'
                      : m.error
                        ? 'rounded-bl-md bg-destructive/10 text-destructive'
                        : 'rounded-bl-md bg-background text-foreground',
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {ask.isPending && (
              <div className="flex items-end gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-base shadow-sm" aria-hidden>
                  {botEmoji}
                </span>
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-background px-3.5 py-2 text-xs text-muted-foreground shadow-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tra cứu…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </div>

      {/* ── Ô nhập ── */}
      <div className="shrink-0 border-t border-orange-100 bg-background/70 p-2.5 dark:border-orange-900/40">
        <div className="flex items-end gap-2 rounded-xl border-2 border-amber-200 bg-background p-1.5 focus-within:border-amber-400 dark:border-amber-900/60 dark:focus-within:border-amber-700">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Nhập tin nhắn…"
            className="max-h-28 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-0"
            rows={1}
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg"
            onClick={send}
            disabled={!text.trim() || ask.isPending}
            aria-label="Gửi câu hỏi"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
