import { useState } from 'react'
import {
  Bot, FileText, Sparkles, MoreVertical, Reply, Share2, Copy, Undo2, Trash2, SmilePlus, IdCard, CreditCard, Phone, Play,
} from 'lucide-react'
import { cn, initials } from '@/lib/utils'
import { API_ORIGIN } from '@/lib/config'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { describeMessage, type MessageView } from './message-content'
import type { ChatMessage } from '@/hooks/use-conversations'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  fileAttachments,
  formatClock,
  imageAttachments,
  parseContent,
  stickerUrlFromContent,
} from './lib'

/**
 * Cảm xúc nhanh — backend (`zalo-reactions.ts`) nhận CHÍNH EMOJI, không phải mã
 * nội bộ của zca-js; chỉ 6 emoji này được hỗ trợ. Chuỗi rỗng = gỡ cảm xúc.
 */
const QUICK_REACTIONS: { icon: string; label: string }[] = [
  { icon: '❤️', label: '❤️' },
  { icon: '👍', label: '👍' },
  { icon: '😂', label: '😂' },
  { icon: '😮', label: '😮' },
  { icon: '😢', label: '😢' },
  { icon: '😡', label: '😡' },
]

/** Thao tác nào backend không có thì chat-panel không truyền → menu tự ẩn mục đó. */
export interface MessageActions {
  onReply: (m: ChatMessage) => void
  onUndo: (m: ChatMessage) => void
  onForward?: (m: ChatMessage) => void
  onReact?: (m: ChatMessage, icon: string) => void
  onDelete?: (m: ChatMessage) => void
}

/**
 * Ảnh Zalo CDN (zadn.vn / zalo.me) thường bị chặn khi trình duyệt tải trực tiếp.
 * Backend TDVN có `GET /api/v1/media/proxy?url=` (công khai) để tải hộ.
 */
const PROXY_HOSTS = /(^|\.)(zadn\.vn|zalo\.me|zaloapp\.com)$/i

function proxiedUrl(url: string): string {
  return `${API_ORIGIN}/api/v1/media/proxy?url=${encodeURIComponent(url)}`
}

/** Ảnh ngoài API/data-URL thì cho phép fallback qua proxy; host Zalo đi thẳng proxy. */
function pickImageSrc(url: string): { src: string; fallback: string | null } {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return { src: url, fallback: null }
  let host = ''
  try {
    const u = new URL(url, window.location.origin)
    host = u.hostname
    if (API_ORIGIN && u.origin === API_ORIGIN) return { src: url, fallback: null }
    if (!API_ORIGIN && u.origin === window.location.origin) return { src: url, fallback: null }
  } catch {
    return { src: url, fallback: null }
  }
  if (PROXY_HOSTS.test(host)) return { src: proxiedUrl(url), fallback: null }
  return { src: url, fallback: proxiedUrl(url) }
}

/** `<img>` tự đổi sang proxy khi tải lỗi lần đầu. */
function ProxiedImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const picked = pickImageSrc(url)
  const [src, setSrc] = useState(picked.src)
  const [triedFallback, setTriedFallback] = useState(false)
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => {
        if (picked.fallback && !triedFallback) {
          setTriedFallback(true)
          setSrc(picked.fallback)
        }
      }}
    />
  )
}

/** Bong bóng tin nhắn: hệ thống ở giữa, khách bên trái, mình bên phải. */

/**
 * Cảm xúc đã thả lên một tin nhắn — gom theo emoji kèm số lượt, giống Zalo.
 *
 * Trước đây phần này KHÔNG được vẽ: backend nhận và lưu đủ, API cũng trả về,
 * nhưng giao diện bỏ qua hoàn toàn nên khách thả tim mà nhân viên không thấy gì.
 */
function MessageReactions({ reactions }: {
  reactions?: { emoji: string; reactorId: string; reactorName?: string | null }[]
}) {
  if (!reactions?.length) return null

  // Gom theo emoji, giữ danh sách TÊN người thả để hiện tooltip (như Zalo).
  const grouped = new Map<string, string[]>()
  for (const r of reactions) {
    const who = r.reactorName || `zlw${r.reactorId}`
    grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), who])
  }

  return (
    <div className="-mt-1.5 flex flex-wrap gap-1 px-1">
      {[...grouped.entries()].map(([emoji, names]) => (
        <span
          key={emoji}
          title={names.join(', ')}
          className="inline-flex cursor-default items-center gap-0.5 rounded-full border bg-card px-1.5 py-0.5 text-[11px] leading-none shadow-sm"
        >
          <span className="text-[13px]">{emoji}</span>
          {names.length > 1 && <span className="text-muted-foreground">{names.length}</span>}
        </span>
      ))}
    </div>
  )
}

/** Người đã xem tới tin này — chat-panel tính từ `conversation.seenBy`. */
export interface SeenViewer {
  name: string
  avatarUrl?: string | null
}

export function MessageBubble({
  message,
  actions,
  seenViewers,
}: {
  message: ChatMessage
  actions?: MessageActions
  seenViewers?: SeenViewer[]
}) {
  const isSelf = message.senderType === 'self'
  const isSystem = message.senderType === 'system'
  const view = describeMessage(message)

  // Sự kiện nhóm, cuộc gọi, nhắc sinh nhật… tới từ Zalo với senderType
  // 'contact'/'self' nhưng bản chất là thông báo — vẽ chip giữa màn như Zalo.
  if (isSystem || view.kind === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {view.kind === 'system' ? view.text : message.content || 'Sự kiện hệ thống'}
        </span>
      </div>
    )
  }

  const parsed = parseContent(message.content, message.contentType)
  const images = [...imageAttachments(message.attachments)]
  if (parsed.imageUrl) images.push(parsed.imageUrl)
  const files = fileAttachments(message.attachments)
  const isSticker = message.contentType === 'sticker'
  // `parseContent` trả NGUYÊN chuỗi JSON khi không nhận ra dạng ảnh/tệp — đó
  // chính là đường JSON lọt ra màn hình. Khi tin không kèm media thì lấy bản đã
  // diễn giải; khi có media thì phần chữ vốn đã trống nên giữ nguyên.
  const hasMedia = images.length > 0 || files.length > 0 || !!parsed.fileHref
  const bodyText = view.kind === 'text' && !hasMedia ? view.text : parsed.text

  return (
    <div
      className={cn(
        'group/msg flex w-full items-center gap-1',
        isSelf ? 'justify-end' : 'justify-start',
      )}
    >
      {/* Menu thao tác — bên trái với tin của mình */}
      {isSelf && actions && !message.isDeleted && (
        <MessageMenu message={message} actions={actions} isSelf />
      )}

      <div className={cn('flex max-w-[78%] flex-col gap-1', isSelf ? 'items-end' : 'items-start')}>
        {!isSelf && message.senderName && (
          <span className="px-1 text-xs font-medium text-muted-foreground">{message.senderName}</span>
        )}

        {message.isDeleted ? (
          <div
            className={cn(
              'rounded-2xl border border-dashed px-3.5 py-2 text-sm italic text-muted-foreground',
              isSelf ? 'rounded-br-sm' : 'rounded-bl-sm',
            )}
          >
            Tin nhắn đã được thu hồi
          </div>
        ) : message.visibility === 'internal' || message.visibility === 'private' ? (
          /* Tin NỘI BỘ / RIÊNG TƯ — style tách biệt hẳn tin gửi khách */
          <div
            className={cn(
              'rounded-2xl border px-3.5 py-2 text-sm shadow-sm',
              isSelf ? 'rounded-br-sm' : 'rounded-bl-sm',
              message.visibility === 'internal'
                ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100'
                : 'border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-100',
            )}
          >
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide opacity-80">
              {message.visibility === 'internal' ? '🔒 Nội bộ' : '🔐 Riêng tư'}
              <span className="font-medium normal-case tracking-normal">
                · {message.repliedBy?.fullName || message.senderName || 'Nhân viên'}
              </span>
            </div>
            {message.reply && (
              <div className="mb-1.5 rounded-md border-l-2 border-current/40 bg-black/5 px-2 py-1 text-xs opacity-75 dark:bg-white/5">
                {message.reply.content?.slice(0, 120)}
              </div>
            )}
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          </div>
        ) : isSticker ? (
          <StickerBubble content={message.content} />
        ) : message.contentType === 'card' ? (
          <CardBubble content={message.content} isSelf={isSelf} />
        ) : message.contentType === 'bank_card' ? (
          <BankCardBubble content={message.content} isSelf={isSelf} />
        ) : message.contentType === 'link' ? (
          <LinkBubble content={message.content} isSelf={isSelf} />
        ) : view.kind === 'video' ? (
          <VideoBubble view={view} isSelf={isSelf} />
        ) : view.kind === 'card' ? (
          <GenericCardBubble view={view} isSelf={isSelf} />
        ) : (
          <div
            className={cn(
              'overflow-hidden rounded-2xl text-sm shadow-sm',
              isSelf
                ? 'rounded-br-sm bg-primary text-primary-foreground'
                : 'rounded-bl-sm bg-muted text-foreground',
              images.length || files.length ? 'p-1.5' : 'px-3.5 py-2',
            )}
          >
            {message.aiGenerated && (
              <span className="mb-1 flex items-center gap-1 px-1 text-[11px] opacity-80">
                <Sparkles className="h-3 w-3" /> AI
              </span>
            )}

            {message.reply?.content && (
              <div
                className={cn(
                  'mb-1 border-l-2 px-2 py-1 text-xs opacity-80',
                  isSelf ? 'border-primary-foreground/40' : 'border-border',
                )}
              >
                {message.reply.content}
              </div>
            )}

            {images.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer" className="block">
                <ProxiedImage
                  url={src}
                  alt="Hình ảnh"
                  className="mb-1 max-h-64 w-full rounded-lg object-cover"
                />
              </a>
            ))}

            {files.map((f, i) => (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'my-0.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm underline-offset-2 hover:underline',
                  isSelf ? 'bg-primary-foreground/10' : 'bg-background',
                )}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{f.title || 'Tệp đính kèm'}</span>
              </a>
            ))}

            {parsed.fileHref && (
              <a
                href={parsed.fileHref}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'my-0.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:underline',
                  isSelf ? 'bg-primary-foreground/10' : 'bg-background',
                )}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{parsed.fileTitle}</span>
              </a>
            )}

            {bodyText && <p className="whitespace-pre-wrap break-words px-2 py-0.5">{bodyText}</p>}
          </div>
        )}

        <MessageReactions reactions={message.reactions} />

        <span className="px-1 text-[11px] text-muted-foreground">{formatClock(message.sentAt)}</span>

        {/* "Đã xem" như Zalo: avatar nhỏ dưới TIN CUỐI mà mỗi người đã xem tới */}
        {isSelf && seenViewers && seenViewers.length > 0 && (
          <div
            className="-mt-0.5 flex items-center gap-1 px-1"
            title={`Đã xem: ${seenViewers.map((v) => v.name).join(', ')}`}
          >
            <span className="text-[10px] text-muted-foreground">Đã xem</span>
            <div className="flex -space-x-1">
              {seenViewers.slice(0, 6).map((v, i) => (
                <Avatar key={i} className="h-3.5 w-3.5 border border-background">
                  {v.avatarUrl && <AvatarImage src={v.avatarUrl} alt="" />}
                  <AvatarFallback className="text-[7px]">{initials(v.name)}</AvatarFallback>
                </Avatar>
              ))}
            </div>
            {seenViewers.length > 6 && (
              <span className="text-[10px] text-muted-foreground">+{seenViewers.length - 6}</span>
            )}
          </div>
        )}
      </div>

      {/* Menu thao tác — bên phải với tin của khách */}
      {!isSelf && actions && !message.isDeleted && (
        <MessageMenu message={message} actions={actions} isSelf={false} />
      )}
    </div>
  )
}

/** Menu thao tác trên từng tin nhắn — chỉ hiện khi rê chuột vào tin */
function MessageMenu({
  message,
  actions,
  isSelf,
}: {
  message: ChatMessage
  actions: MessageActions
  isSelf: boolean
}) {
  const canCopy = !!message.content && message.contentType === 'text'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Thao tác tin nhắn"
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground',
            'opacity-0 transition-opacity hover:bg-muted focus:opacity-100 group-hover/msg:opacity-100',
            'data-[state=open]:opacity-100',
          )}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={isSelf ? 'end' : 'start'} className="w-52">
        {/* Hàng cảm xúc nhanh — chỉ khi backend nhận reaction */}
        {actions.onReact && (
          <>
            <div className="flex items-center gap-0.5 px-1.5 py-1.5">
              {QUICK_REACTIONS.map((r) => (
                <button
                  key={r.icon}
                  type="button"
                  title={`Thả ${r.label}`}
                  onClick={() => actions.onReact?.(message, r.icon)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-base transition-transform hover:scale-110 hover:bg-muted"
                >
                  {r.label}
                </button>
              ))}
              <button
                type="button"
                title="Gỡ cảm xúc"
                onClick={() => actions.onReact?.(message, '')}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <SmilePlus className="h-3.5 w-3.5" />
              </button>
            </div>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem onClick={() => actions.onReply(message)}>
          <Reply className="mr-2 h-4 w-4" />
          Trả lời
        </DropdownMenuItem>
        {actions.onForward && (
          <DropdownMenuItem onClick={() => actions.onForward?.(message)}>
            <Share2 className="mr-2 h-4 w-4" />
            Chuyển tiếp
          </DropdownMenuItem>
        )}
        {canCopy && (
          <DropdownMenuItem onClick={() => navigator.clipboard.writeText(message.content ?? '')}>
            <Copy className="mr-2 h-4 w-4" />
            Sao chép
          </DropdownMenuItem>
        )}

        {(isSelf || actions.onDelete) && <DropdownMenuSeparator />}
        {isSelf && (
          <DropdownMenuItem onClick={() => actions.onUndo(message)} className="text-destructive">
            <Undo2 className="mr-2 h-4 w-4" />
            Thu hồi
          </DropdownMenuItem>
        )}
        {actions.onDelete && (
          <DropdownMenuItem onClick={() => actions.onDelete?.(message)} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            Xoá chỉ ở phía tôi
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StickerBubble({ content }: { content: string | null }) {
  // Backend lưu sticker dạng URL, JSON {"id":...} hoặc chuỗi số → quy về URL CDN Zalo.
  const url = stickerUrlFromContent(content)
  const [failed, setFailed] = useState(false)

  if (url && !failed) {
    return (
      <img
        src={url}
        alt="Sticker"
        loading="lazy"
        className="h-28 w-28 object-contain"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
      <Bot className="h-4 w-4" /> Sticker
    </div>
  )
}

/* ── Thẻ nội dung đặc biệt: danh thiếp / thẻ ngân hàng / link ───────── */

/** Đọc JSON an toàn — nội dung tin nhắn có thể là JSON hoặc text thường */
function safeParse(content: string | null): Record<string, unknown> | null {
  if (!content) return null
  try {
    const o = JSON.parse(content)
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const cardShell = (isSelf: boolean) =>
  cn(
    'w-64 overflow-hidden rounded-2xl border shadow-sm',
    isSelf ? 'rounded-br-sm border-primary/30 bg-primary/10' : 'rounded-bl-sm border-border bg-muted',
  )

/** Danh thiếp Zalo */
function CardBubble({ content, isSelf }: { content: string | null; isSelf: boolean }) {
  const o = safeParse(content)
  const userId = String(o?.userId ?? '')
  const phone = o?.phoneNumber ? String(o.phoneNumber) : ''
  if (!userId) return <PlainBubble content={content} isSelf={isSelf} />

  return (
    <div className={cardShell(isSelf)}>
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <IdCard className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold">Danh thiếp</span>
      </div>
      <div className="space-y-1 px-3 py-2.5 text-sm">
        {phone && (
          <p className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{formatPhone(phone)}</span>
          </p>
        )}
        <p className="truncate text-xs text-muted-foreground">UID: {userId}</p>
      </div>
    </div>
  )
}

/** Thẻ ngân hàng / số tài khoản */
function BankCardBubble({ content, isSelf }: { content: string | null; isSelf: boolean }) {
  const o = safeParse(content)
  const acc = o?.numAccBank ? String(o.numAccBank) : ''
  const name = o?.nameAccBank ? String(o.nameAccBank) : ''
  const bin = o?.binBank != null ? String(o.binBank) : ''
  if (!acc) return <PlainBubble content={content} isSelf={isSelf} />

  return (
    <div className={cardShell(isSelf)}>
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <CreditCard className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold">Thông tin chuyển khoản</span>
      </div>
      <div className="space-y-1.5 px-3 py-2.5">
        <div>
          <p className="text-[11px] text-muted-foreground">Số tài khoản</p>
          <p className="select-all font-mono text-sm font-semibold tracking-wide">{acc}</p>
        </div>
        {name && (
          <div>
            <p className="text-[11px] text-muted-foreground">Chủ tài khoản</p>
            <p className="text-sm font-medium">{name}</p>
          </div>
        )}
        {bin && <p className="text-[11px] text-muted-foreground">Mã ngân hàng: {bin}</p>}
      </div>
    </div>
  )
}

/**
 * Video Zalo: `content` là JSON có `href` (video) và `thumb` (ảnh đại diện).
 * Không phát nội tuyến — CDN Zalo hay chặn theo referer; mở tab mới chắc ăn hơn.
 */
function VideoBubble({ view, isSelf }: { view: Extract<MessageView, { kind: 'video' }>; isSelf: boolean }) {
  const secs = view.durationMs ? Math.round(view.durationMs / 1000) : 0
  return (
    <a
      href={view.href}
      target="_blank"
      rel="noreferrer"
      className={cn(cardShell(isSelf), 'group/vid relative block overflow-hidden')}
    >
      {view.thumb ? (
        <img src={view.thumb} alt="" className="h-44 w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-28 w-56 items-center justify-center bg-muted" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white transition-transform group-hover/vid:scale-110">
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </span>
      </span>
      {secs > 0 && (
        <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] text-white">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
        </span>
      )}
    </a>
  )
}

/**
 * Thẻ chung cho các loại Zalo gửi kèm `title`/`description`/`thumb` mà hệ thống
 * chưa có bộ vẽ riêng (lời nhắc, danh thiếp, nội dung chia sẻ…). Có thẻ này thì
 * không loại nào còn rơi xuống nhánh chữ và in ra JSON.
 */
function GenericCardBubble({ view, isSelf }: { view: Extract<MessageView, { kind: 'card' }>; isSelf: boolean }) {
  const inner = (
    <>
      {view.thumb && <img src={view.thumb} alt="" className="h-28 w-full object-cover" loading="lazy" />}
      <div className="space-y-0.5 px-3 py-2">
        <p className="line-clamp-2 text-sm font-medium">{view.title}</p>
        {view.description && (
          <p className="line-clamp-3 text-xs text-muted-foreground">{view.description}</p>
        )}
      </div>
    </>
  )
  // Chỉ mở link khi thực sự là link xem được, không mở ảnh minh hoạ của Zalo.
  const isLink = !!view.href && view.href !== view.thumb && /^https?:\/\//.test(view.href)
  return isLink ? (
    <a href={view.href} target="_blank" rel="noreferrer" className={cn(cardShell(isSelf), 'block hover:opacity-90')}>
      {inner}
    </a>
  ) : (
    <div className={cn(cardShell(isSelf))}>{inner}</div>
  )
}

/** Link có xem trước — nội dung Zalo trả về rất dài, chỉ lấy phần cần thiết */
function LinkBubble({ content, isSelf }: { content: string | null; isSelf: boolean }) {
  const o = safeParse(content)
  const href = String(o?.href ?? o?.link ?? '')
  const title = String(o?.title ?? '')
  const desc = String(o?.description ?? o?.desc ?? '')
  const thumb = String(o?.thumb ?? o?.thumbUrl ?? '')
  if (!href && !title) return <PlainBubble content={content} isSelf={isSelf} />

  return (
    <a
      href={href || undefined}
      target="_blank"
      rel="noreferrer"
      className={cn(cardShell(isSelf), 'block transition-opacity hover:opacity-90')}
    >
      {thumb && (
        <img src={thumb} alt="" className="h-28 w-full object-cover" loading="lazy" />
      )}
      <div className="space-y-0.5 px-3 py-2">
        <p className="line-clamp-2 text-sm font-medium">{title || href}</p>
        {desc && <p className="line-clamp-2 text-xs text-muted-foreground">{desc}</p>}
        {href && <p className="truncate text-[11px] text-primary">{href}</p>}
      </div>
    </a>
  )
}

/** Dự phòng khi không đọc được cấu trúc — hiện text gọn thay vì JSON thô */
function PlainBubble({ content, isSelf }: { content: string | null; isSelf: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl px-3.5 py-2 text-sm shadow-sm',
        isSelf ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted',
      )}
    >
      {content && content.trim().startsWith('{') ? '[Nội dung đặc biệt]' : content}
    </div>
  )
}

/** 84xxxxxxxxx → 0xxx xxx xxx cho dễ đọc */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  const local = digits.startsWith('84') ? `0${digits.slice(2)}` : digits
  return local.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3')
}
