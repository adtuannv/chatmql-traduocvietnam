import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Sparkles, X, Search, MoreVertical, Pin, PinOff, MailOpen, PauseCircle, ChevronDown, Paperclip, Loader2, Image as ImageIcon, FolderOpen, Reply, Plus, IdCard, CreditCard, Link2, BellRing, BarChart3, Images, Lock, LockKeyhole, MessageCircle, ShoppingBag } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/misc'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { Loading, EmptyState, ErrorState } from '@/components/shared/feedback'
import { api, apiError } from '@/lib/api-client'
import { FEATURES } from '@/lib/features'
import { cn, initials } from '@/lib/utils'
import { getSocket } from '@/lib/socket'
import { useCrmPanelStore } from '@/stores/crm-panel-store'
import {
  useChatRealtime,
  useConversation,
  useMessages,
  useSendMessage,
  useSetAiMode,
  useSetAiPause,
  useTogglePin,
  useMarkUnread,
  useReactMessage,
  useUndoMessage,
  useDeleteMessage,
  type AiMode,
  type ChatMessage,
  useGroupMembers,
  useSetRequireMention,
} from '@/hooks/use-conversations'
import { MessageBubble, type MessageActions } from './message-bubble'
import { ForwardDialog } from './forward-dialog'
import { ResourcesDialog } from './resources-dialog'
import { ConversationTags } from './conversation-tags'
import { GroupMembersMenu } from './group-members-menu'
import { StickerPicker } from './sticker-picker'
import { SalesDocsDialog } from './sales-docs-dialog'
import { QuickMessagesPopover } from './quick-messages-popover'
import { SendExtrasDialog } from './send-extras-dialog'
import { ReminderDialog } from './reminder-dialog'
import { PollDialog } from './poll-dialog'
import {
  detectMentionQuery, filterMembers, insertMention, resolveMentions,
  MENTION_ALL_UID, type PendingMention,
} from './mentions'
import { ViewAsStaffButton } from './view-as-staff'
import { AI_MODES, platformLabel, messagePreview } from './lib'
import { useOrgMembers } from '@/hooks/use-settings'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Chế độ AI chọn được: bỏ 'suggest' vì đã có nút "AI Gợi ý" riêng ở thanh công cụ
 * (nhãn đầy đủ vẫn lấy từ AI_MODES để hiện đúng nếu hội thoại đang ở chế độ cũ).
 */
const SELECTABLE_AI_MODES = AI_MODES.filter((m) => m.value !== 'suggest')

/** Gợi ý AI: nhãn tiếng Việt + màu cho từng giọng văn */
type AiTone = 'concise' | 'friendly' | 'detailed'
interface AiSuggestion {
  suggestionId: string
  tone: AiTone
  text: string
}
const TONE_META: Record<AiTone, { label: string; cls: string }> = {
  concise: { label: 'Ngắn gọn', cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  friendly: { label: 'Thân thiện', cls: 'bg-pink-500/15 text-pink-600 dark:text-pink-400' },
  detailed: { label: 'Chi tiết', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
}

/** Bộ lọc tin nhắn theo người gửi */
type SenderFilter = 'all' | 'contact' | 'ai' | 'staff'
const SENDER_FILTERS: { value: SenderFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'contact', label: 'Khách' },
  { value: 'ai', label: 'AI' },
  { value: 'staff', label: 'Nhân viên' },
]

/** Các mốc tạm dừng AI (phút) */
const PAUSE_OPTIONS = [
  { minutes: 30, label: '30 phút' },
  { minutes: 60, label: '1 giờ' },
  { minutes: 240, label: '4 giờ' },
  { minutes: 1440, label: '24 giờ' },
]

// ── Cờ backend: nhóm nút/menu nào còn ít nhất một mục thì mới vẽ ─────
const HAS_CONV_MENU = FEATURES.CHAT_PIN || FEATURES.CHAT_MARK_UNREAD
const HAS_SEND_EXTRAS = FEATURES.CHAT_SEND_CARD || FEATURES.CHAT_SEND_BANK_CARD || FEATURES.CHAT_SEND_LINK
const HAS_CONV_TOOLS = FEATURES.CHAT_REMINDERS || FEATURES.CHAT_POLL
const HAS_PLUS_MENU = HAS_SEND_EXTRAS || HAS_CONV_TOOLS

/** Khung chat trung tâm cho hội thoại đang chọn. */
export function ChatPanel({ convId }: { convId: string }) {
  const queryClient = useQueryClient()
  const { data: conv } = useConversation(convId)
  const { data: msgData, isLoading, isError } = useMessages(convId)
  const sendMessage = useSendMessage(convId)
  const setAiMode = useSetAiMode(convId)
  const setAiPause = useSetAiPause(convId)
  const setRequireMention = useSetRequireMention(convId)
  const togglePin = useTogglePin()
  const markUnread = useMarkUnread()
  const reactMessage = useReactMessage(convId)
  const undoMessage = useUndoMessage(convId)
  const deleteMessage = useDeleteMessage(convId)
  const { typingName, aiTyping, aiDraft, clearAiDraft } = useChatRealtime(convId)

  const [text, setText] = useState('')
  // Ảnh DÁN vào ô soạn tin — chờ trong hàng đợi, bấm Gửi mới thật sự gửi
  // (dán nhầm thì bấm × xoá). url = objectURL để preview.
  const [pendingImages, setPendingImages] = useState<{ file: File; url: string }[]>([])
  // ── Chế độ gửi: external (khách) / internal (nội bộ) / private (riêng tư).
  // Backend enforce: internal/private KHÔNG BAO GIỜ đi ra kênh khách.
  // Backend TDVN bỏ qua `visibility` → khoá cứng ở 'external' (selector bị ẩn).
  const [sendMode, setSendMode] = useState<'external' | 'internal' | 'private'>('external')
  // Nội dung đang soạn là gợi ý AI nguyên văn → gửi kèm `source` để backend gắn badge.
  const [fromAiSuggest, setFromAiSuggest] = useState(false)
  const [internalMentions, setInternalMentions] = useState<{ id: string; fullName: string }[]>([])
  const myId = useAuthStore((s) => s.user?.id)
  // Danh bạ nội bộ cho @mention — endpoint mở cho mọi thành viên (member thường
  // gọi /settings/team sẽ bị 403 nên không dùng useTeam ở đây).
  const { data: orgMembers = [] } = useOrgMembers(sendMode !== 'external')
  // Danh sách tag đã chèn, THEO THỨ TỰ. Vị trí ký tự được quét lại lúc gửi
  // (xem mentions.ts) vì người dùng có thể sửa chữ phía trước bất cứ lúc nào.
  const [pendingMentions, setPendingMentions] = useState<PendingMention[]>([])
  const [mentionQuery, setMentionQuery] = useState<{ triggerAt: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const isGroup = conv?.threadType === 'group'
  const { data: groupMembers = [] } = useGroupMembers(convId, isGroup)
  // Gõ '@' gợi ý theo chế độ gửi:
  //   external (nhóm Zalo) → thành viên nhóm + '@Tất cả' (uid đặc biệt của Zalo)
  //   internal/private     → NHÂN VIÊN nội bộ (tag đồng nghiệp, khách không thấy)
  const mentionCandidates = mentionQuery
    ? filterMembers(
        sendMode !== 'external'
          ? orgMembers
              .filter((m) => m.id !== myId && !internalMentions.some((im) => im.id === m.id))
              .map((m) => ({ uid: m.id, name: m.fullName || 'Nhân viên', avatarUrl: m.avatarUrl }))
          : [{ uid: MENTION_ALL_UID, name: 'Tất cả', avatarUrl: null }, ...groupMembers],
        mentionQuery.query,
      ).slice(0, 8)
    : []
  const [searchOpen, setSearchOpen] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [msgSearch, setMsgSearch] = useState('')
  const [senderFilter, setSenderFilter] = useState<SenderFilter>('all')
  const [uploading, setUploading] = useState(false)
  const [suggestions, setSuggestions] = useState<AiSuggestion[] | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [salesDocsOpen, setSalesDocsOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null)
  const [extrasTab, setExtrasTab] = useState<'card' | 'bank' | 'link' | null>(null)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const typingSentRef = useRef(false)
  // Cảm xúc không đẩy được sang Zalo là chuyện thường (kênh khác, tin cũ không
  // có externalMsgId) — chỉ nhắc MỘT lần mỗi hội thoại, tránh spam toast.
  const reactWarnedRef = useRef(false)

  const allMessages = useMemo(() => msgData?.messages ?? [], [msgData])

  // Lọc tin nhắn: theo người gửi + theo từ khoá (đều xử lý phía client).
  const messages = useMemo(() => {
    const q = msgSearch.trim().toLowerCase()
    return allMessages.filter((m) => {
      if (q && !(m.content ?? '').toLowerCase().includes(q)) return false
      if (senderFilter === 'contact') return m.senderType === 'contact'
      if (senderFilter === 'ai') return !!m.aiGenerated
      if (senderFilter === 'staff') return m.senderType === 'self' && !m.aiGenerated
      return true
    })
  }, [allMessages, msgSearch, senderFilter])

  // ── "Đã xem": từ conversation.seenBy (uid → mốc tin mới nhất đã xem) tính
  // ra tin CỦA MÌNH cuối cùng mà mỗi người đã xem tới → đặt avatar dưới tin đó
  // (giống Zalo). Nhóm: tra tên/avatar từ thành viên nhóm; 1-1: chính là khách.
  const seenMarkers = useMemo(() => {
    const map: Record<string, { name: string; avatarUrl?: string | null }[]> = {}
    const seenBy = conv?.seenBy
    if (!seenBy) return map
    const accountUid = conv?.channelAccount?.externalUid
    for (const [uid, mark] of Object.entries(seenBy)) {
      if (!mark?.msgSentAt || (accountUid && uid === accountUid)) continue
      const seenT = new Date(mark.msgSentAt).getTime()
      let target: ChatMessage | null = null
      for (const m of allMessages) {
        if (m.senderType !== 'self' || m.isDeleted) continue
        // Tin nội bộ/riêng tư khách không thấy → không gắn "Đã xem" vào đó.
        if (m.visibility && m.visibility !== 'external') continue
        if (new Date(m.sentAt).getTime() <= seenT) target = m
        else break
      }
      if (!target) continue
      const member = isGroup ? groupMembers.find((g) => g.uid === uid) : null
      const viewer = isGroup
        ? { name: member?.name || `Người dùng …${uid.slice(-4)}`, avatarUrl: member?.avatarUrl ?? null }
        : { name: conv?.contact?.fullName || 'Khách hàng', avatarUrl: conv?.contact?.avatarUrl ?? null }
      ;(map[target.id] ??= []).push(viewer)
    }
    return map
  }, [conv?.seenBy, conv?.channelAccount?.externalUid, conv?.contact, allMessages, groupMembers, isGroup])

  // Còn hiệu lực tạm dừng AI?
  const pausedUntil = conv?.aiPausedUntil ? new Date(conv.aiPausedUntil) : null
  const isPaused = !!pausedUntil && pausedUntil.getTime() > Date.now()

  // Tự cuộn xuống cuối khi có tin mới / mở hội thoại / có chỉ báo đang nhập.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, typingName, aiTyping, convId])

  // Đổi hội thoại thì cho phép nhắc lại cảnh báo đồng bộ cảm xúc một lần nữa.
  useEffect(() => {
    reactWarnedRef.current = false
  }, [convId])

  // Chỉ báo "đang nhập" gửi tới server (throttle đơn giản).
  function emitTyping() {
    if (typingSentRef.current) return
    typingSentRef.current = true
    getSocket().emit('typing:start', convId)
    setTimeout(() => {
      typingSentRef.current = false
    }, 2500)
  }

  /**
   * Đổi chế độ gửi. internal/private → external: XOÁ nội dung đang soạn (không
   * mang tin nội bộ sang chế độ gửi khách) + cảnh báo rõ ràng chống gửi nhầm.
   */
  function switchSendMode(next: 'external' | 'internal' | 'private') {
    if (next === sendMode) return
    if (next !== 'external' && !FEATURES.CHAT_INTERNAL_NOTES) return
    if (next !== 'external' && pendingImages.length > 0) {
      // Ảnh chờ chỉ gửi được ra kênh khách — rời chế độ khách thì bỏ hàng đợi.
      pendingImages.forEach((p) => URL.revokeObjectURL(p.url))
      setPendingImages([])
      toast.info('Đã bỏ ảnh đang chờ gửi (chế độ nội bộ/riêng tư không gửi ảnh).')
    }
    if (sendMode !== 'external' && next === 'external') {
      setText('')
      setInternalMentions([])
      if (replyTo?.visibility && replyTo.visibility !== 'external') setReplyTo(null)
      toast.warning('⚠️ Tin nhắn tiếp theo sẽ được gửi TRỰC TIẾP cho khách hàng.')
    }
    if (next !== 'external') {
      toast.info(next === 'internal'
        ? '🔒 Chế độ NỘI BỘ — khách hàng không nhìn thấy, không gửi ra kênh.'
        : '🔐 Chế độ RIÊNG TƯ — chỉ bạn và người được chỉ định nhìn thấy.')
    }
    setSendMode(next)
  }

  // Reply một tin nội bộ → composer buộc về đúng chế độ đó (reply nội bộ phải
  // giữ nội bộ; backend cũng chặn chiều ngược lại).
  useEffect(() => {
    const v = replyTo?.visibility
    if (FEATURES.CHAT_INTERNAL_NOTES && (v === 'internal' || v === 'private') && sendMode === 'external') setSendMode(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyTo])

  async function handleSend() {
    const content = text.trim()
    const hasImages = sendMode === 'external' && pendingImages.length > 0
    if ((!content && !hasImages) || sendMessage.isPending || uploading) return

    // ── Có ảnh dán chờ gửi: upload lần lượt, chữ đang soạn thành caption ảnh 1 ──
    if (hasImages) {
      const imgs = pendingImages
      setText('')
      setPendingImages([])
      setUploading(true)
      getSocket().emit('typing:stop', convId)
      try {
        // eCDP: MỘT request chứa toàn bộ ảnh → một tin Zalo (album). Backend TDVN
        // giới hạn `files: 1` mỗi request → gửi lần lượt, chữ đi kèm ảnh đầu.
        await postImages(imgs.map((p) => p.file), content)
        imgs.forEach((p) => URL.revokeObjectURL(p.url))
        queryClient.invalidateQueries({ queryKey: ['conversation-messages', convId] })
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
      } catch (err) {
        // Khôi phục để gửi lại — không mất ảnh lẫn nội dung
        setText(content)
        setPendingImages(imgs)
        toast.error(apiError(err))
      } finally {
        setUploading(false)
      }
      return
    }

    // ── Nhánh NỘI BỘ / RIÊNG TƯ: backend save-only, không đi ra kênh khách ──
    if (sendMode !== 'external') {
      setText('')
      getSocket().emit('typing:stop', convId)
      try {
        await sendMessage.mutateAsync({
          content,
          visibility: sendMode,
          mentionUserIds: internalMentions.map((m) => m.id),
          ...(replyTo ? { replyMessageId: replyTo.id } : {}),
        })
        setReplyTo(null)
        setInternalMentions([])
        queryClient.invalidateQueries({ queryKey: ['conversation-messages', convId] })
      } catch (err) {
        setText(content)
        toast.error(apiError(err))
      }
      return
    }

    // Quét vị trí ngay trước khi gửi — chuỗi đã là bản cuối cùng.
    const mentions = resolveMentions(content, pendingMentions)
    setText('')
    setPendingMentions([])
    setMentionQuery(null)
    getSocket().emit('typing:stop', convId)
    const wasAi = fromAiSuggest
    setFromAiSuggest(false)
    try {
      await sendMessage.mutateAsync({
        content,
        ...(replyTo ? { replyMessageId: replyTo.id } : {}),
        ...(mentions.length ? { mentions } : {}),
        ...(wasAi ? { source: 'ai_suggest' as const } : {}),
      })
      setReplyTo(null)
      clearAiDraft()
    } catch (err) {
      setText(content) // khôi phục nội dung để gửi lại
      setPendingMentions(pendingMentions)
      toast.error(apiError(err))
    }
  }

  /** Chọn một người trong danh sách gợi ý '@' → chèn vào ô soạn tin. */
  function pickMention(member: { uid: string; name: string }) {
    const el = composerRef.current
    if (!el || !mentionQuery) return
    const { text: next, caret, token } = insertMention(
      text, mentionQuery.triggerAt, el.selectionStart ?? text.length, member.name,
    )
    setText(next)
    if (sendMode !== 'external') {
      // Tag nội bộ: backend nhận danh sách userId, không cần vị trí ký tự.
      setInternalMentions((prev) =>
        prev.some((m) => m.id === member.uid) ? prev : [...prev, { id: member.uid, fullName: member.name }],
      )
    } else {
      setPendingMentions((prev) => [...prev, { uid: member.uid, token }])
    }
    setMentionQuery(null)
    setMentionIndex(0)
    // Đặt lại con trỏ sau khi React vẽ xong, nếu không caret nhảy về cuối.
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  /**
   * Đẩy ảnh lên `/messages/image`. CHAT_MULTI_IMAGE_UPLOAD bật → một request
   * nhiều `file` (album); tắt (TDVN, `files: 1`) → mỗi ảnh một request, caption
   * chỉ gắn vào ảnh đầu tiên.
   */
  async function postImages(files: File[], caption?: string) {
    const headers = { 'Content-Type': 'multipart/form-data' }
    if (FEATURES.CHAT_MULTI_IMAGE_UPLOAD) {
      const form = new FormData()
      files.forEach((f) => form.append('file', f))
      if (caption) form.append('caption', caption)
      await api.post(`/conversations/${convId}/messages/image`, form, { headers })
      return
    }
    for (const [i, file] of files.entries()) {
      const form = new FormData()
      form.append('file', file)
      if (caption && i === 0) form.append('caption', caption)
      await api.post(`/conversations/${convId}/messages/image`, form, { headers })
    }
  }

  /** Gửi ảnh hoặc tệp từ máy — backend có 2 endpoint riêng */
  async function uploadFiles(files: File[]) {
    if (!files.length) return
    setUploading(true)
    try {
      const images = files.filter((f) => f.type.startsWith('image/'))
      const others = files.filter((f) => !f.type.startsWith('image/'))
      if (images.length > 0) await postImages(images)
      for (const file of others) {
        const form = new FormData()
        form.append('file', file)
        await api.post(`/conversations/${convId}/messages/file`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', convId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    // Phải COPY ra mảng trước: gán value = '' sẽ xoá luôn e.target.files
    // (FileList là tham chiếu sống) → mất tệp vừa chọn, không gửi được gì.
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // cho phép chọn lại cùng một tệp
    await uploadFiles(files)
  }

  /** Xin AI gợi ý câu trả lời dựa trên nội dung khách vừa hỏi */
  async function handleSuggest() {
    if (suggesting) return
    setSuggesting(true)
    try {
      const { data } = await api.post<{ suggestions: AiSuggestion[] }>('/ai/suggest', {
        conversationId: convId,
      })
      const list = data?.suggestions ?? []
      if (!list.length) {
        toast.error('AI chưa đưa ra được gợi ý. Thử lại sau.')
        return
      }
      setSuggestions(list)
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setSuggesting(false)
    }
  }

  /** Thao tác trên từng tin nhắn — mục nào backend không có thì không đưa vào (bubble tự ẩn). */
  const messageActions: MessageActions = {
    onReply: (m) => setReplyTo(m),
    onUndo: async (m) => {
      try {
        await undoMessage.mutateAsync(m.id)
        toast.success('Đã thu hồi tin nhắn')
      } catch (err) {
        toast.error(apiError(err))
      }
    },
    ...(FEATURES.CHAT_FORWARD ? { onForward: (m: ChatMessage) => setForwardMsg(m) } : {}),
    ...(FEATURES.CHAT_REACTIONS
      ? {
          onReact: async (m: ChatMessage, icon: string) => {
            try {
              const res = await reactMessage.mutateAsync({ messageId: m.id, icon })
              // Cảm xúc đã lưu trong CRM rồi, nên đây chỉ là thông báo nhẹ.
              if (res && !res.forwarded && !reactWarnedRef.current) {
                reactWarnedRef.current = true
                toast.message('Cảm xúc chỉ hiển thị trong CRM, chưa đồng bộ sang Zalo', {
                  description: res.reason,
                })
              }
            } catch (err) {
              toast.error(apiError(err))
            }
          },
        }
      : {}),
    ...(FEATURES.CHAT_DELETE_MESSAGE
      ? {
          onDelete: async (m: ChatMessage) => {
            try {
              await deleteMessage.mutateAsync({ messageId: m.id, onlyMe: true })
              toast.success('Đã xoá tin nhắn ở phía bạn')
            } catch (err) {
              toast.error(apiError(err))
            }
          },
        }
      : {}),
  }

  function applyDraft() {
    if (aiDraft) setText(aiDraft.content)
  }

  async function handleModeChange(mode: AiMode) {
    try {
      await setAiMode.mutateAsync(mode)
      toast.success(`Đã chuyển chế độ AI: ${AI_MODES.find((m) => m.value === mode)?.label}`)
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  /** 'chung' = bỏ ghi đè, trả về theo cài đặt chung của tổ chức. */
  async function handleRequireMention(v: string) {
    const gia_tri = v === 'chung' ? null : v === 'bat'
    try {
      await setRequireMention.mutateAsync(gia_tri)
      toast.success(
        gia_tri === null ? 'Nhóm này theo cài đặt chung'
          : gia_tri ? 'Nhóm này chỉ trả lời khi được nhắc tên'
            : 'Nhóm này trả lời mọi tin',
      )
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function handlePause(minutes: number) {
    try {
      await setAiPause.mutateAsync(minutes)
      toast.success(
        minutes > 0
          ? `Đã tạm dừng AI ${PAUSE_OPTIONS.find((p) => p.minutes === minutes)?.label ?? `${minutes} phút`}`
          : 'Đã bỏ tạm dừng AI',
      )
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function handleTogglePin() {
    try {
      const res = await togglePin.mutateAsync({ id: convId, pin: !conv?.isPinned })
      toast.success(res.isPinned ? 'Đã ghim lên đầu' : 'Đã bỏ ghim')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  async function handleMarkUnread() {
    try {
      await markUnread.mutateAsync(convId)
      toast.success('Đã đánh dấu là chưa đọc')
    } catch (err) {
      toast.error(apiError(err))
    }
  }

  const name = conv?.displayName || conv?.contact?.fullName || 'Hội thoại'

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b p-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-9 w-9">
            {conv?.contact?.avatarUrl && <AvatarImage src={conv.contact.avatarUrl} alt={name} />}
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-semibold">{name}</p>
              <ConversationTags
                contactId={conv?.contact?.id}
                tags={conv?.contact?.tags ?? []}
              />
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-xs text-muted-foreground">
                {platformLabel(conv?.channelAccount?.platform)}
                {conv?.channelAccount?.displayName ? ` · ${conv.channelAccount.displayName}` : ''}
                {/* Số điện thoại là thứ duy nhất phân biệt được các nick trùng
                    tên — công ty có tới bốn nick cùng tên "Hoài Chang Trà Dược
                    Việt Nam", chỉ khác số. Thiếu nó thì nhìn tiêu đề không biết
                    mình đang trực bằng nick nào. */}
                {conv?.channelAccount?.phone ? ` · ${conv.channelAccount.phone}` : ''}
              </p>
              {isGroup && convId && (
                <GroupMembersMenu convId={convId} members={groupMembers} />
              )}
            </div>
          </div>
        </div>

        <div data-tour="chat-header-tools" className="flex shrink-0 items-center gap-1.5">
          {/* Tìm trong hội thoại */}
          {searchOpen ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={msgSearch}
                onChange={(e) => setMsgSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setMsgSearch('')
                    setSearchOpen(false)
                  }
                }}
                placeholder="Tìm trong hội thoại…"
                className="h-8 w-40 pl-8 pr-7 text-xs"
              />
              <button
                type="button"
                aria-label="Đóng tìm kiếm"
                onClick={() => {
                  setMsgSearch('')
                  setSearchOpen(false)
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Tìm trong hội thoại"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-4 w-4" />
            </Button>
          )}

          {/* Thư viện hội thoại — ảnh/video, tệp, liên kết đã trao đổi */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            data-tour="chat-library"
            aria-label="Thư viện hội thoại"
            title="Thư viện: ảnh, tệp, liên kết"
            disabled={!convId}
            onClick={() => setResourcesOpen(true)}
          >
            <Images className="h-4 w-4" />
          </Button>

          {/* Chế độ AI — gồm cả tạm dừng AI */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs"
                disabled={!conv || setAiMode.isPending || setAiPause.isPending}
                data-tour="chat-ai-mode"
                aria-label="Chế độ AI"
              >
                {isPaused ? (
                  <PauseCircle className="h-3.5 w-3.5 text-warning" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                )}
                <span className="font-medium">
                  {AI_MODES.find((m) => m.value === conv?.aiMode)?.label ?? 'Chế độ AI'}
                </span>
                {isPaused && (
                  <Badge variant="warning" className="px-1 py-0 text-[9px]">
                    Tạm dừng
                  </Badge>
                )}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Chế độ AI
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={conv?.aiMode}
                onValueChange={(v) => handleModeChange(v as AiMode)}
              >
                {SELECTABLE_AI_MODES.map((m) => (
                  <DropdownMenuRadioItem key={m.value} value={m.value} className="text-sm">
                    {m.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>

              {/* Chỉ nhóm mới có ý nghĩa: hội thoại một-một thì mọi câu đều là
                  nói với mình, bắt khách gõ tên bot mới trả lời là vô lý. */}
              {isGroup && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Chỉ trả lời khi được nhắc tên
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={conv?.requireMention == null ? 'chung' : conv.requireMention ? 'bat' : 'tat'}
                    onValueChange={(v) => handleRequireMention(v)}
                  >
                    <DropdownMenuRadioItem value="chung" className="text-sm">
                      Theo cài đặt chung
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="bat" className="text-sm">
                      Bật cho nhóm này
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="tat" className="text-sm">
                      Tắt cho nhóm này
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {isPaused ? `Đang tạm dừng đến ${pausedUntil?.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : 'Tạm dừng AI'}
              </DropdownMenuLabel>
              {PAUSE_OPTIONS.map((p) => (
                <DropdownMenuItem
                  key={p.minutes}
                  onClick={() => handlePause(p.minutes)}
                  disabled={setAiPause.isPending}
                  className="text-sm"
                >
                  <PauseCircle className="mr-2 h-4 w-4" />
                  {p.label}
                </DropdownMenuItem>
              ))}
              {isPaused && (
                <DropdownMenuItem
                  onClick={() => handlePause(0)}
                  disabled={setAiPause.isPending}
                  className="text-sm"
                >
                  <X className="mr-2 h-4 w-4" />
                  Bỏ tạm dừng
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Menu thao tác — ẩn hẳn khi backend không có ghim lẫn đánh dấu chưa đọc */}
          {HAS_CONV_MENU && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Thao tác hội thoại">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {FEATURES.CHAT_PIN && (
                  <DropdownMenuItem onClick={handleTogglePin} disabled={togglePin.isPending}>
                    {conv?.isPinned ? (
                      <>
                        <PinOff className="mr-2 h-4 w-4" />
                        Bỏ ghim
                      </>
                    ) : (
                      <>
                        <Pin className="mr-2 h-4 w-4" />
                        Ghim lên đầu
                      </>
                    )}
                  </DropdownMenuItem>
                )}
                {FEATURES.CHAT_MARK_UNREAD && (
                  <DropdownMenuItem onClick={handleMarkUnread} disabled={markUnread.isPending}>
                    <MailOpen className="mr-2 h-4 w-4" />
                    Đánh dấu là chưa đọc
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Bộ lọc tin nhắn theo người gửi */}
      <div data-tour="chat-msg-filters" className="flex items-center gap-1.5 border-b bg-background/40 px-3 py-2">
        {SENDER_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setSenderFilter(f.value)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              senderFilter === f.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-muted',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Danh sách tin nhắn */}
      <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto bg-background/40 p-4">
        {isLoading ? (
          <Loading label="Đang tải tin nhắn…" />
        ) : isError ? (
          <ErrorState message="Không tải được tin nhắn." />
        ) : messages.length === 0 ? (
          <EmptyState title="Chưa có tin nhắn" description="Hãy gửi tin nhắn đầu tiên." />
        ) : (
          messages.map((m) => (
            <MessageBubble key={m.id} message={m} actions={messageActions} seenViewers={seenMarkers[m.id]} />
          ))
        )}

        {(typingName || aiTyping) && (
          <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground">
            <span className="flex gap-0.5">
              <Dot /> <Dot /> <Dot />
            </span>
            {aiTyping ? 'AI đang soạn tin…' : `${typingName} đang nhập…`}
          </div>
        )}
      </div>

      {/* Bản nháp AI */}
      {aiDraft && (
        <div className="flex items-start gap-2 border-t bg-primary/5 px-4 py-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-xs font-medium text-primary">
              AI gợi ý trả lời
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {Math.round((aiDraft.confidence || 0) * 100)}%
              </Badge>
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{aiDraft.content}</p>
          </div>
          <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={applyDraft}>
            Dùng
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={clearAiDraft}
            aria-label="Bỏ qua gợi ý"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Bảng gợi ý AI */}
      {suggestions && (
        <div className="border-t border-primary/30 bg-primary/5">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
              <Sparkles className="h-4 w-4" />
              AI gợi ý trả lời
            </span>
            <button
              type="button"
              onClick={() => setSuggestions(null)}
              aria-label="Đóng gợi ý"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="max-h-48 divide-y divide-primary/10 overflow-y-auto border-t border-primary/10">
            {suggestions.map((s) => {
              const meta = TONE_META[s.tone] ?? { label: s.tone, cls: 'bg-muted text-muted-foreground' }
              return (
                <li key={s.suggestionId}>
                  <button
                    type="button"
                    onClick={() => {
                      setText(s.text)
                      setFromAiSuggest(true)
                      setSuggestions(null)
                    }}
                    className="w-full px-3 py-2 text-left transition-colors hover:bg-primary/10"
                    title="Bấm để dùng nội dung này"
                  >
                    <span
                      className={cn(
                        'mb-1 inline-block rounded-md px-2 py-0.5 text-xs font-semibold',
                        meta.cls,
                      )}
                    >
                      {meta.label}
                    </span>
                    <p className="line-clamp-2 text-sm text-foreground">{s.text}</p>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Đang trả lời tin nhắn nào */}
      {replyTo && (
        <div className="flex items-center gap-2 border-t bg-muted/50 px-3 py-2">
          <Reply className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-primary">
              Trả lời {replyTo.senderType === 'self' ? 'chính bạn' : replyTo.senderName || 'khách'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {messagePreview({
                content: replyTo.content,
                contentType: replyTo.contentType,
                senderType: replyTo.senderType,
                isDeleted: replyTo.isDeleted,
              } as never)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            aria-label="Huỷ trả lời"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Thanh công cụ + ô soạn tin */}
      <div className="space-y-2 border-t p-3">
        {/* Thanh công cụ */}
        <div className="flex items-center gap-1">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFilePicked}
            aria-hidden
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFilePicked}
            aria-hidden
          />

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => imageInputRef.current?.click()}
            disabled={uploading}
            data-tour="chat-image"
            aria-label="Gửi ảnh từ máy"
            title="Gửi ảnh"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label="Gửi tệp từ máy"
            title="Gửi tệp"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <StickerPicker convId={convId} />

          {/* Ghi rõ chữ thay vì chỉ icon: nhân viên mới vào không đoán được
              cái thư mục này chứa tài liệu bán hàng hay tệp đính kèm. */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            onClick={() => setSalesDocsOpen(true)}
            data-tour="chat-docs"
            aria-label="Tài liệu bán hàng"
            title="Tài liệu bán hàng: hình ảnh · content · video đã duyệt"
          >
            <FolderOpen className="h-4 w-4 text-primary" />
            Tài liệu bán hàng
          </Button>

          {FEATURES.CHAT_QUICK_MESSAGES && (
            <QuickMessagesPopover
              accountId={conv?.channelAccount?.id}
              onPick={(t) => setText((prev) => (prev ? `${prev}\n${t}` : t))}
            />
          )}

          {/* Thao tác nâng cao — gom lại cho gọn giống Zalo; từng mục theo cờ backend */}
          {HAS_PLUS_MENU && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  aria-label="Tuỳ chọn thêm"
                  title="Tuỳ chọn thêm"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                {HAS_SEND_EXTRAS && (
                  <>
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      Gửi nội dung
                    </DropdownMenuLabel>
                    {FEATURES.CHAT_SEND_CARD && (
                      <DropdownMenuItem onClick={() => setExtrasTab('card')}>
                        <IdCard className="mr-2 h-4 w-4" />
                        Danh thiếp
                      </DropdownMenuItem>
                    )}
                    {FEATURES.CHAT_SEND_BANK_CARD && (
                      <DropdownMenuItem onClick={() => setExtrasTab('bank')}>
                        <CreditCard className="mr-2 h-4 w-4" />
                        Thẻ ngân hàng
                      </DropdownMenuItem>
                    )}
                    {FEATURES.CHAT_SEND_LINK && (
                      <DropdownMenuItem onClick={() => setExtrasTab('link')}>
                        <Link2 className="mr-2 h-4 w-4" />
                        Link có xem trước
                      </DropdownMenuItem>
                    )}
                  </>
                )}

                {HAS_SEND_EXTRAS && HAS_CONV_TOOLS && <DropdownMenuSeparator />}
                {HAS_CONV_TOOLS && (
                  <>
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      Công cụ hội thoại
                    </DropdownMenuLabel>
                    {FEATURES.CHAT_REMINDERS && (
                      <DropdownMenuItem onClick={() => setReminderOpen(true)}>
                        <BellRing className="mr-2 h-4 w-4" />
                        Nhắc hẹn
                      </DropdownMenuItem>
                    )}
                    {FEATURES.CHAT_POLL && (
                      <DropdownMenuItem onClick={() => setPollOpen(true)}>
                        <BarChart3 className="mr-2 h-4 w-4" />
                        Bình chọn (nhóm)
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            onClick={handleSuggest}
            disabled={suggesting}
            data-tour="chat-ai-suggest"
            aria-label="AI gợi ý trả lời"
          >
            {suggesting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 text-primary" />
            )}
            AI Gợi ý
          </Button>

          {/* TDVN: mở thẳng tab "Tạo đơn" ở cột phải */}
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-success px-2.5 text-xs text-success-foreground hover:bg-success/90"
            onClick={() => useCrmPanelStore.getState().openOrder()}
            data-tour="chat-order"
            aria-label="Lên đơn hàng cho khách"
            title="Lên đơn hàng cho khách này"
          >
            <ShoppingBag className="h-4 w-4" />
            Lên đơn
          </Button>

          {/* Chỉ owner/admin thấy — tự ẩn với vai trò khác. */}
          <ViewAsStaffButton />

          {/* Selector chế độ gửi: khách hàng / nội bộ / riêng tư.
              Backend TDVN không có tin nội bộ → ẩn hẳn (tránh gửi nhầm ra khách). */}
          {FEATURES.CHAT_INTERNAL_NOTES && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'ml-auto gap-1.5',
                  sendMode === 'internal' && 'border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200',
                  sendMode === 'private' && 'border-violet-400 bg-violet-50 text-violet-800 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-200',
                )}
              >
                {sendMode === 'external' && <><MessageCircle className="h-3.5 w-3.5" /> Tin nhắn khách hàng</>}
                {sendMode === 'internal' && <><Lock className="h-3.5 w-3.5" /> Tin nhắn nội bộ</>}
                {sendMode === 'private' && <><LockKeyhole className="h-3.5 w-3.5" /> Tin nhắn riêng tư</>}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => switchSendMode('external')}>
                <MessageCircle className="h-4 w-4" /> Tin nhắn khách hàng
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => switchSendMode('internal')}>
                <Lock className="h-4 w-4 text-amber-600" /> Tin nhắn nội bộ
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => switchSendMode('private')}>
                <LockKeyhole className="h-4 w-4 text-violet-600" /> Tin nhắn riêng tư
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          )}

        </div>

        {/* Banner chống gửi nhầm + mention nội bộ */}
        {sendMode !== 'external' && (
          <div
            className={cn(
              'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs',
              sendMode === 'internal'
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                : 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200',
            )}
          >
            <span className="font-bold">
              {sendMode === 'internal' ? '🔒 ĐANG GỬI NỘI BỘ' : '🔐 ĐANG GỬI RIÊNG TƯ'}
            </span>
            <span className="opacity-80">
              {sendMode === 'internal'
                ? 'Chỉ nhân viên có quyền xem hội thoại nhìn thấy — KHÔNG gửi ra kênh khách.'
                : 'Chỉ bạn và người được chỉ định nhìn thấy.'}
            </span>
            <span className="mx-1 opacity-40">|</span>
            {internalMentions.length === 0 ? (
              <span className="opacity-70">Gõ @ để tag nhân viên</span>
            ) : (
              internalMentions.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-full border border-current/30 bg-white/60 px-2 py-0.5 dark:bg-black/20">
                  @{m.fullName}
                  <button type="button" onClick={() => setInternalMentions((cur) => cur.filter((x) => x.id !== m.id))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))
            )}
          </div>
        )}

        {mentionQuery && mentionCandidates.length > 0 && (
          <div className="relative">
            <ul className="absolute bottom-1 left-0 z-30 max-h-56 w-72 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
              {mentionCandidates.map((m, i) => (
                <li key={m.uid}>
                  <button
                    type="button"
                    onMouseEnter={() => setMentionIndex(i)}
                    onClick={() => pickMention(m)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                      i === mentionIndex ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                  >
                    <Avatar className="h-6 w-6 shrink-0">
                      {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                      <AvatarFallback className="text-[10px]">{initials(m.name)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    {m.uid === MENTION_ALL_UID && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">cả nhóm</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Ảnh dán đang chờ — bấm Gửi mới đi, × để xoá ảnh dán nhầm */}
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
            {pendingImages.map((p, i) => (
              <div key={p.url} className="relative">
                <img src={p.url} alt="" className="h-16 w-16 rounded-md border object-cover" />
                <button
                  type="button"
                  aria-label="Xoá ảnh"
                  onClick={() => {
                    URL.revokeObjectURL(p.url)
                    setPendingImages((prev) => prev.filter((_, idx) => idx !== i))
                  }}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/80 text-background shadow hover:bg-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <span className="text-[11px] text-muted-foreground">
              {pendingImages.length} ảnh sẽ gửi khi bấm Gửi{text.trim() ? ' (kèm nội dung đang soạn)' : ''}
            </span>
          </div>
        )}

        <div className="flex items-end gap-2">
        <Textarea
          ref={composerRef}
          onPaste={(e) => {
            // Dán ảnh trực tiếp vào ô chat (chụp màn hình / copy ảnh) → gửi
            // như bấm nút "Gửi ảnh". Dán chữ vẫn hoạt động bình thường.
            const imgs = Array.from(e.clipboardData?.items ?? [])
              .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
              .map((it) => it.getAsFile())
              .filter((f): f is File => !!f)
            if (imgs.length === 0) return
            e.preventDefault()
            if (sendMode !== 'external') {
              // Đường gửi ảnh hiện tại đi THẲNG ra kênh khách — chặn để không
              // lộ ảnh khi đang ở chế độ nội bộ/riêng tư.
              toast.warning('Chế độ nội bộ/riêng tư chưa hỗ trợ gửi ảnh — chuyển về "Tin nhắn khách hàng" để gửi ảnh.')
              return
            }
            setPendingImages((prev) => {
              const next = [...prev, ...imgs.map((f) => ({ file: f, url: URL.createObjectURL(f) }))]
              if (next.length > 10) {
                toast.warning('Tối đa 10 ảnh mỗi lần gửi.')
                next.slice(10).forEach((p) => URL.revokeObjectURL(p.url))
                return next.slice(0, 10)
              }
              return next
            })
          }}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setFromAiSuggest(false) // đã sửa tay → không còn là gợi ý nguyên văn
            emitTyping()
            // Gửi khách: chỉ nhóm mới tag được (Zalo bỏ qua mention ở chat 1-1).
            // Nội bộ/riêng tư: luôn tag được — gợi ý danh bạ nhân viên.
            const canMention = sendMode !== 'external' || isGroup
            setMentionQuery(canMention ? detectMentionQuery(e.target.value, e.target.selectionStart ?? 0) : null)
            setMentionIndex(0)
          }}
          onKeyDown={(e) => {
            // Đang mở danh sách '@' thì phím mũi tên/Enter thuộc về danh sách,
            // không được để lọt xuống thành gửi tin.
            if (mentionQuery && mentionCandidates.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMentionIndex((i) => (i + 1) % mentionCandidates.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
                return
              }
              if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
                e.preventDefault()
                pickMention(mentionCandidates[mentionIndex])
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setMentionQuery(null)
                return
              }
            }
            // isComposing: bộ gõ tiếng Việt (Telex/VNI) chưa "chốt" ký tự cuối.
            // Nếu gửi lúc này, ký tự đó sẽ được commit lại vào ô trống sau khi xoá.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              handleSend()
            }
          }}
          data-tour="chat-input"
          placeholder="Nhập tin nhắn… (Shift+Enter xuống dòng)"
          className="max-h-32 min-h-[44px] flex-1 resize-none"
          rows={1}
        />
        {/* Nút gửi ĐỔI THEO CHẾ ĐỘ — không dùng một nút "Gửi" chung (chống gửi nhầm) */}
        <Button
          className={cn(
            'h-11 shrink-0 gap-1.5',
            sendMode === 'internal' && 'bg-amber-500 text-white hover:bg-amber-600',
            sendMode === 'private' && 'bg-violet-600 text-white hover:bg-violet-700',
          )}
          data-tour="chat-send"
          onClick={handleSend}
          disabled={(!text.trim() && !(sendMode === 'external' && pendingImages.length > 0)) || sendMessage.isPending || uploading}
          aria-label={sendMode === 'external' ? 'Gửi khách hàng' : sendMode === 'internal' ? 'Gửi nội bộ' : 'Gửi riêng tư'}
        >
          {sendMode === 'internal' ? <Lock className="h-4 w-4" /> : sendMode === 'private' ? <LockKeyhole className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          {sendMode === 'external' ? 'Gửi khách hàng' : sendMode === 'internal' ? 'Gửi nội bộ' : 'Gửi riêng tư'}
        </Button>
        </div>
      </div>

      {FEATURES.CHAT_FORWARD && (
        <ForwardDialog
          sourceConvId={convId}
          messageId={forwardMsg?.id ?? null}
          messageText={forwardMsg?.content ?? ''}
          open={!!forwardMsg}
          onOpenChange={(v) => !v && setForwardMsg(null)}
        />
      )}

      {HAS_SEND_EXTRAS && (
        <SendExtrasDialog
          convId={convId}
          accountId={conv?.channelAccount?.id}
          open={!!extrasTab}
          onOpenChange={(v) => !v && setExtrasTab(null)}
          defaultTab={extrasTab ?? 'card'}
        />
      )}

      {FEATURES.CHAT_REMINDERS && (
        <ReminderDialog convId={convId} open={reminderOpen} onOpenChange={setReminderOpen} />
      )}

      {FEATURES.CHAT_POLL && (
        <PollDialog
          convId={convId}
          isGroup={conv?.threadType === 'group'}
          open={pollOpen}
          onOpenChange={setPollOpen}
        />
      )}

      <SalesDocsDialog
        convId={convId}
        open={salesDocsOpen}
        onOpenChange={setSalesDocsOpen}
      />

      <ResourcesDialog
        conversationId={convId}
        open={resourcesOpen}
        onOpenChange={setResourcesOpen}
      />
    </div>
  )
}

function Dot() {
  return <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
}
