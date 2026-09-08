import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { FEATURES } from '@/lib/features'
import {
  getSocket,
  joinConversation,
  leaveConversation,
} from '@/lib/socket'
import { useAuthStore } from '@/stores/auth-store'

// ── Kiểu dữ liệu ─────────────────────────────────────────────────────
export type AiMode = 'manual' | 'auto' | 'suggest'
export type ConvTab = 'main' | 'other'
export type SenderType = 'self' | 'contact' | 'system'

export interface ChatContact {
  id: string
  fullName: string | null
  phone: string | null
  email: string | null
  avatarUrl: string | null
  leadScore?: number | null
  lifecycleStage?: string | null
  status?: string | null
  aiSummary?: string | null
  aiSentimentLabel?: string | null
  aiIntent?: string | null
  tags?: string[] | null
  company?: { id: string; name: string; industry?: string | null; taxCode?: string | null } | null
  // Các trường dưới đây API đã trả sẵn (GET /conversations/:id include cả bản ghi
  // Contact) nhưng trước giờ chưa khai báo nên panel không dùng được.
  jobTitle?: string | null
  birthday?: string | null
  source?: string | null
  firstContactDate?: string | null
  lastActivity?: string | null
  nextAppointment?: string | null
  assignedUserId?: string | null
  notes?: string | null
  /** Bài toán khách đang gặp — AI rút từ hội thoại. */
  aiPainPoints?: string[] | null
  /** Đối thủ khách đang cân nhắc. */
  aiCompetitors?: string[] | null
  /** Tín hiệu mua, ví dụ "Yêu cầu báo giá". */
  aiSignals?: string[] | null
  aiSentimentReason?: string | null
}

export interface ChannelAccount {
  id: string
  displayName: string
  /** Thứ duy nhất phân biệt được các nick trùng tên. */
  phone?: string | null
  externalUid?: string | null
  platform: number
}

export interface LastMessagePreview {
  id: string
  content: string | null
  contentType: string
  senderType: SenderType
  senderName: string | null
  sentAt: string
  isDeleted?: boolean
}

export interface ConversationListItem {
  id: string
  displayName: string
  unreadCount: number
  isReplied: boolean
  tab: ConvTab
  aiMode: AiMode
  lastMessageAt: string | null
  isPinned?: boolean
  contact: ChatContact | null
  channelAccount: ChannelAccount | null
  messages: LastMessagePreview[]
}

export interface ConversationDetail extends ConversationListItem {
  aiModeReason?: string | null
  aiPausedUntil?: string | null
  /** Ghi đè luật "chỉ trả lời khi nhắc tên" cho nhóm này; null = theo cài đặt chung. */
  requireMention?: boolean | null
  externalThreadId?: string | null
  threadType?: string
  /** Ai đã xem tới đâu (từ sự kiện seen của Zalo): uid → mốc tin mới nhất đã xem. */
  seenBy?: Record<string, { msgId: string; msgSentAt: string; seenAt: string }> | null
}

export interface MessageAttachment {
  url: string
  type: string
  thumb?: string
  title?: string
}

export interface ChatMessage {
  id: string
  conversationId?: string
  externalMsgId?: string | null
  senderUid?: string | null
  senderName: string | null
  senderType: SenderType
  content: string | null
  contentType: string
  attachments?: MessageAttachment[]
  sentAt: string
  isDeleted?: boolean
  aiGenerated?: boolean
  reply?: { content: string; msgType: string } | null
  /**
   * Cảm xúc đã thả lên tin này. Backend đã chuẩn hoá mã Zalo (`/-heart`) thành
   * emoji thật trước khi trả về, nên ở đây luôn là emoji hiển thị được.
   */
  reactions?: { emoji: string; reactorId: string; reactorName?: string | null }[]
  /** external = tin với khách; internal = chỉ nhân viên; private = người gửi + được mention. */
  visibility?: 'external' | 'internal' | 'private'
  mentionUserIds?: string[]
  repliedBy?: { fullName: string | null } | null
}

export interface ConversationsResponse {
  conversations: ConversationListItem[]
  total: number
  page: number
  limit: number
}

export interface MessagesResponse {
  messages: ChatMessage[]
  total: number
  page: number
  limit: number
}

export type ResourceKind = 'image' | 'video' | 'file' | 'link'

/** Một tài nguyên (ảnh/video/tệp/liên kết) đã trao đổi trong hội thoại. */
export interface ResourceItem {
  id: string
  messageId: string
  kind: ResourceKind
  url: string
  thumb?: string
  title?: string
  /** Cỡ tệp tính bằng byte — chỉ có với tệp Zalo. */
  size?: number
  sentAt: string
  senderName?: string
}

export interface ConversationResources {
  media: ResourceItem[]
  files: ResourceItem[]
  links: ResourceItem[]
  scanned: number
  truncated: boolean
}

export interface ConversationCounts {
  unread: number
  unreplied: number
  /** Hội thoại đang để AI tự tư vấn (aiMode = auto). */
  ai?: number
  total: number
}

// ── Query keys ──────────────────────────────────────────────────────
const keys = {
  list: (params: Record<string, unknown>) => ['conversations', params] as const,
  counts: (params: Record<string, unknown>) => ['conversation-counts', params] as const,
  detail: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['conversation-messages', id] as const,
  resources: (id: string) => ['conversation-resources', id] as const,
}

// ── Danh sách hội thoại ─────────────────────────────────────────────
export interface ConversationsQueryParams {
  tab?: ConvTab
  search?: string
  unread?: boolean
  unreplied?: boolean
  /** Lọc theo chế độ AI của hội thoại — 'auto' = AI đang tự tư vấn. */
  aiMode?: string
  pinned?: boolean
  accountId?: string
  tag?: string
  page?: number
  limit?: number
}

/**
 * Gộp các lượt làm mới danh sách hội thoại lại.
 *
 * Mỗi tin nhắn đến từ bất kỳ trong 16 nick Zalo đều bắn socket, và trước đây
 * mỗi lần bắn là gọi lại NGAY hai API `conversations` và `conversations/counts`.
 * Giờ cao điểm thành ~50 lượt/phút mỗi nhân viên, đủ để máy chủ chặn lại.
 *
 * Chờ một nhịp ngắn rồi gọi một lần: một loạt 20 tin dồn dập chỉ tốn một lượt
 * gọi, mà mắt thường không thấy chậm hơn.
 */
const NHIP_GOP_MS = 900

function tạoLàmMớiGộp(qc: QueryClient): () => void {
  let hen: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (hen) return
    hen = setTimeout(() => {
      hen = null
      void qc.invalidateQueries({ queryKey: ['conversations'] })
      void qc.invalidateQueries({ queryKey: ['conversation-counts'] })
    }, NHIP_GOP_MS)
  }
}

export function useConversations(params: ConversationsQueryParams) {
  const query: Record<string, unknown> = {
    tab: params.tab,
    page: params.page ?? 1,
    limit: params.limit ?? 50,
  }
  if (params.search) query.search = params.search
  if (params.unread) query.unread = 'true'
  if (params.unreplied) query.unreplied = 'true'
  if (params.aiMode) query.aiMode = params.aiMode
  // Backend TDVN không có ghim / không đọc `?tag=` → không gửi tham số thừa.
  if (params.pinned && FEATURES.CHAT_PIN) query.pinned = 'true'
  if (params.accountId) query.accountId = params.accountId
  if (params.tag && FEATURES.CHAT_TAG_FILTER) query.tag = params.tag

  return useQuery<ConversationsResponse>({
    queryKey: keys.list(query),
    queryFn: async () => {
      const { data } = await api.get<ConversationsResponse>('/conversations', { params: query })
      return data
    },
  })
}

export function useConversationCounts(tab?: ConvTab) {
  const params = tab ? { tab } : {}
  return useQuery<ConversationCounts>({
    queryKey: keys.counts(params),
    queryFn: async () => {
      const { data } = await api.get<ConversationCounts>('/conversations/counts', { params })
      return data
    },
  })
}

// ── Chi tiết 1 hội thoại ────────────────────────────────────────────
export function useConversation(id: string | undefined) {
  return useQuery<ConversationDetail>({
    queryKey: keys.detail(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const { data } = await api.get<ConversationDetail>(`/conversations/${id}`)
      return data
    },
  })
}

// ── Danh sách tin nhắn ──────────────────────────────────────────────
export function useMessages(id: string | undefined) {
  return useQuery<MessagesResponse>({
    queryKey: keys.messages(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const { data } = await api.get<MessagesResponse>(`/conversations/${id}/messages`, {
        params: { limit: 100 },
      })
      return data
    },
  })
}

// ── Tài nguyên đã trao đổi (ảnh/video, tệp, liên kết) ───────────────

/** Một tin trong `GET /conversations/:id/shared-media` (backend TDVN). */
interface SharedMediaMessage {
  id: string
  content: string | null
  contentType: string
  senderName: string | null
  sentAt: string
}

interface SharedMediaResponse {
  messages: SharedMediaMessage[]
  counts: { image: number; file: number; link: number }
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  const t = raw.trim()
  if (!t.startsWith('{')) return null
  try {
    const o = JSON.parse(t) as unknown
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Quy đổi từng tin của `/shared-media` thành `ResourceItem`. Backend TDVN không
 * có `/resources` (eCDP) — nó trả nguyên tin nhắn kèm `content` JSON của Zalo
 * ({ href, thumb, title, fileSize … }) nên phần bóc tách làm ở đây một lần.
 */
function sharedMediaToResources(data: SharedMediaResponse): ConversationResources {
  const out: ConversationResources = { media: [], files: [], links: [], scanned: 0, truncated: false }
  for (const m of data.messages ?? []) {
    out.scanned += 1
    const obj = parseJsonObject(m.content)
    const str = (k: string) => (typeof obj?.[k] === 'string' ? (obj[k] as string).trim() : '')
    const href = str('hdUrl') || str('href') || str('url') || str('link')
    const base = {
      id: m.id,
      messageId: m.id,
      sentAt: m.sentAt,
      senderName: m.senderName ?? undefined,
    }
    if (m.contentType === 'image' || m.contentType === 'video') {
      // Ảnh không phải JSON (URL trần) vẫn hiển thị được.
      const url = href || (m.content && /^https?:\/\//.test(m.content.trim()) ? m.content.trim() : '')
      if (!url) continue
      out.media.push({
        ...base,
        kind: m.contentType === 'video' ? 'video' : 'image',
        url,
        thumb: str('thumb') || undefined,
        title: str('title') || undefined,
      })
    } else if (m.contentType === 'file') {
      if (!href) continue
      const size = Number(obj?.fileSize)
      out.files.push({
        ...base,
        kind: 'file',
        url: href,
        title: str('title') || undefined,
        size: Number.isFinite(size) && size > 0 ? size : undefined,
      })
    } else if (m.contentType === 'link') {
      const url = href || (m.content?.match(/https?:\/\/[^\s"']+/)?.[0] ?? '')
      if (!url) continue
      out.links.push({
        ...base,
        kind: 'link',
        url,
        thumb: str('thumb') || undefined,
        title: str('title') || undefined,
      })
    }
  }
  // Backend chỉ trả 50 tin mới nhất — đếm tổng để biết còn nữa hay không.
  const total = (data.counts?.image ?? 0) + (data.counts?.file ?? 0) + (data.counts?.link ?? 0)
  out.truncated = total > out.scanned
  return out
}

export function useConversationResources(id: string | undefined, enabled = true) {
  return useQuery<ConversationResources>({
    queryKey: keys.resources(id ?? ''),
    enabled: !!id && enabled,
    queryFn: async () => {
      const { data } = await api.get<SharedMediaResponse>(`/conversations/${id}/shared-media`)
      return sharedMediaToResources(data)
    },
  })
}

// ── Gửi tin nhắn văn bản ────────────────────────────────────────────
/** Tag một người trong nhóm. `pos`/`len` là chỉ số ký tự trong nội dung tin. */
export interface MessageMention {
  pos: number
  uid: string
  len: number
}

export interface SendMessageInput {
  content: string
  replyMessageId?: string
  /** Chỉ có tác dụng với hội thoại nhóm — Zalo bỏ qua ở chat 1-1. */
  mentions?: MessageMention[]
  /** internal/private = tin nội bộ, backend KHÔNG gửi ra kênh khách. */
  visibility?: 'internal' | 'private'
  /** userId nhân viên được @mention trong tin nội bộ. */
  mentionUserIds?: string[]
  /** 'ai_suggest' = nhân viên gửi nguyên gợi ý AI (backend gắn badge nguồn). */
  source?: 'ai_suggest'
}

/** Mutation "giả" cho tính năng backend TDVN không có — UI đã ẩn, đây là lưới an toàn. */
const FEATURE_OFF_MSG = 'Tính năng này chưa có trên máy chủ hiện tại'

export function useSendMessage(id: string) {
  // Nhận chuỗi (gửi thường) hoặc object khi cần trả lời / tag người.
  return useMutation<ChatMessage, unknown, string | SendMessageInput>({
    mutationFn: async (input) => {
      const body: SendMessageInput = typeof input === 'string' ? { content: input } : { ...input }
      if (!FEATURES.CHAT_INTERNAL_NOTES) {
        // Backend TDVN bỏ qua `visibility` → nếu lọt qua, tin nội bộ sẽ đi
        // thẳng ra kênh khách. Chặn cứng ở đây thay vì tin vào UI.
        if (body.visibility) throw new Error(FEATURE_OFF_MSG)
        delete body.mentionUserIds
      }
      const { data } = await api.post<ChatMessage>(`/conversations/${id}/messages`, body)
      return data
    },
  })
}

// ── Thành viên nhóm (nguồn cho danh sách tag @) ─────────────────────

export interface GroupMember {
  uid: string
  name: string
  avatarUrl: string | null
  isAdmin?: boolean
}

export function useGroupMembers(convId: string | undefined, isGroup: boolean) {
  return useQuery<GroupMember[]>({
    queryKey: ['conversation', convId, 'group-members'],
    enabled: !!convId && isGroup,
    // Thành viên nhóm hiếm khi đổi; giữ lâu để gõ '@' không phải chờ mạng.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.get<{ members?: GroupMember[] }>(
        `/conversations/${convId}/group-info`,
      )
      return data.members ?? []
    },
  })
}

/** Đồng bộ lại danh sách thành viên nhóm từ Zalo (bỏ cache). */
export async function refreshGroupMembers(convId: string) {
  const { data } = await api.get<{ members?: GroupMember[] }>(
    `/conversations/${convId}/group-info`,
    { params: { refresh: 1 } },
  )
  return data.members ?? []
}

/** Gỡ một thành viên khỏi nhóm (cần quyền trưởng/phó nhóm trên Zalo). */
export function useRemoveGroupMember(convId: string | undefined) {
  const qc = useQueryClient()
  return useMutation<unknown, unknown, { memberId: string }>({
    mutationFn: async ({ memberId }) => {
      if (!FEATURES.CHAT_REMOVE_MEMBER) throw new Error(FEATURE_OFF_MSG)
      const { data } = await api.post(`/conversations/${convId}/remove-member`, { memberId })
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversation', convId, 'group-members'] }),
  })
}

// ── Thao tác trên từng tin nhắn ─────────────────────────────────────

/**
 * Kết quả của route reaction. `forwarded=false` KHÔNG phải lỗi: cảm xúc đã lưu
 * trong CRM, chỉ là chưa đồng bộ được sang app Zalo (kênh khác, tin nhắn không
 * có externalMsgId, tài khoản mất kết nối...) — `reason` nói rõ vì sao.
 */
export interface ReactMessageResult {
  ok: boolean
  action: 'added' | 'removed'
  forwarded: boolean
  reason?: string
}

/** Thả / gỡ cảm xúc (gửi chuỗi rỗng để gỡ) */
export function useReactMessage(convId: string) {
  const qc = useQueryClient()
  return useMutation<ReactMessageResult, unknown, { messageId: string; icon: string }>({
    mutationFn: async ({ messageId, icon }) => {
      if (!FEATURES.CHAT_REACTIONS) throw new Error(FEATURE_OFF_MSG)
      const { data } = await api.post<ReactMessageResult>(
        `/conversations/${convId}/messages/${messageId}/reaction`,
        { icon },
      )
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.messages(convId) }),
  })
}

/** Thu hồi tin nhắn trên Zalo (chỉ tin của mình) */
export function useUndoMessage(convId: string) {
  const qc = useQueryClient()
  return useMutation<unknown, unknown, string>({
    mutationFn: async (messageId) => {
      const { data } = await api.post(`/conversations/${convId}/messages/${messageId}/undo`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.messages(convId) }),
  })
}

/** Xoá tin nhắn — mặc định chỉ xoá ở phía mình */
export function useDeleteMessage(convId: string) {
  const qc = useQueryClient()
  return useMutation<unknown, unknown, { messageId: string; onlyMe?: boolean }>({
    mutationFn: async ({ messageId, onlyMe = true }) => {
      if (!FEATURES.CHAT_DELETE_MESSAGE) throw new Error(FEATURE_OFF_MSG)
      const { data } = await api.delete(
        `/conversations/${convId}/messages/${messageId}?onlyMe=${onlyMe}`,
      )
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.messages(convId) }),
  })
}

/** Chuyển tiếp tin nhắn sang nhiều hội thoại */
export function useForwardMessage(convId: string) {
  const qc = useQueryClient()
  return useMutation<
    { sent: number; failed: { conversationId: string; error: string }[] },
    unknown,
    { messageId: string; conversationIds: string[] }
  >({
    mutationFn: async ({ messageId, conversationIds }) => {
      if (!FEATURES.CHAT_FORWARD) throw new Error(FEATURE_OFF_MSG)
      const { data } = await api.post(
        `/conversations/${convId}/messages/${messageId}/forward`,
        { conversationIds },
      )
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  })
}

// ── Đánh dấu đã đọc ─────────────────────────────────────────────────
export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation<void, unknown, string>({
    mutationFn: async (id: string) => {
      await api.post(`/conversations/${id}/mark-read`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation-counts'] })
    },
  })
}

// ── Xoá hội thoại (cần quyền conversations.delete — admin set qua vai trò) ──
export function useDeleteConversation() {
  const qc = useQueryClient()
  return useMutation<void, unknown, string>({
    mutationFn: async (id: string) => {
      await api.delete(`/conversations/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation-counts'] })
    },
  })
}

// ── Đánh dấu là chưa đọc ────────────────────────────────────────────
export function useMarkUnread() {
  const qc = useQueryClient()
  return useMutation<void, unknown, string>({
    mutationFn: async (id: string) => {
      if (!FEATURES.CHAT_MARK_UNREAD) throw new Error(FEATURE_OFF_MSG)
      await api.post(`/conversations/${id}/mark-unread`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation-counts'] })
    },
  })
}

// ── Đánh dấu tất cả đã đọc (tuỳ chọn theo tài khoản kênh) ───────────
export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation<{ updated: number }, unknown, string | undefined>({
    mutationFn: async (accountId?: string) => {
      if (!FEATURES.CHAT_MARK_ALL_READ) throw new Error(FEATURE_OFF_MSG)
      const { data } = await api.post<{ updated: number }>('/conversations/mark-all-read',
        accountId ? { accountId } : {})
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['conversation-counts'] })
    },
  })
}

// ── Ghim / bỏ ghim hội thoại ────────────────────────────────────────
export function useTogglePin() {
  const qc = useQueryClient()
  return useMutation<{ isPinned: boolean }, unknown, { id: string; pin: boolean }>({
    mutationFn: async ({ id, pin }) => {
      if (!FEATURES.CHAT_PIN) throw new Error(FEATURE_OFF_MSG)
      const { data } = pin
        ? await api.post<{ isPinned: boolean }>(`/conversations/${id}/pin`)
        : await api.delete<{ isPinned: boolean }>(`/conversations/${id}/pin`)
      return data
    },
    onSuccess: (data, { id }) => {
      qc.setQueryData<ConversationDetail>(keys.detail(id), (prev) =>
        prev ? { ...prev, isPinned: data.isPinned } : prev)
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

// ── Tạm dừng AI trong N phút (0 = bỏ tạm dừng) ──────────────────────
export function useSetAiPause(id: string) {
  const qc = useQueryClient()
  return useMutation<{ aiPausedUntil: string | null }, unknown, number>({
    mutationFn: async (minutes: number) => {
      const { data } = await api.patch<{ aiPausedUntil: string | null }>(
        `/conversations/${id}/ai-pause`, { minutes })
      return data
    },
    onSuccess: (data) => {
      qc.setQueryData<ConversationDetail>(keys.detail(id), (prev) =>
        prev ? { ...prev, aiPausedUntil: data.aiPausedUntil } : prev)
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

// ── Đổi chế độ AI (manual | auto | suggest) ─────────────────────────
/**
 * Đặt luật nhắc tên cho riêng hội thoại này.
 *
 * `null` trả về theo cài đặt chung — người trực nhóm cần bỏ được ghi đè chứ
 * không chỉ bật/tắt, nếu không thì lỡ đặt là mắc kẹt với giá trị đó mãi.
 */
export function useSetRequireMention(id: string) {
  const qc = useQueryClient()
  return useMutation<{ requireMention: boolean | null }, unknown, boolean | null>({
    mutationFn: async (requireMention) => {
      const { data } = await api.patch<{ requireMention: boolean | null }>(
        `/conversations/${id}/require-mention`, { requireMention })
      return data
    },
    onSuccess: (data) => {
      qc.setQueryData<ConversationDetail>(keys.detail(id), (prev) =>
        prev ? { ...prev, requireMention: data.requireMention } : prev)
    },
  })
}

export function useSetAiMode(id: string) {
  const qc = useQueryClient()
  return useMutation<{ aiMode: AiMode }, unknown, AiMode>({
    mutationFn: async (aiMode: AiMode) => {
      const { data } = await api.patch<{ aiMode: AiMode }>(`/conversations/${id}/ai-mode`, { aiMode })
      return data
    },
    onSuccess: (data) => {
      qc.setQueryData<ConversationDetail>(keys.detail(id), (prev) =>
        prev ? { ...prev, aiMode: data.aiMode } : prev,
      )
    },
  })
}

// ── Cập nhật cache tin nhắn (thêm/dedupe theo id) ───────────────────
function upsertMessage(qc: QueryClient, convId: string, message: ChatMessage) {
  qc.setQueryData<MessagesResponse>(keys.messages(convId), (prev) => {
    if (!prev) return prev
    if (prev.messages.some((m) => m.id === message.id)) {
      return {
        ...prev,
        messages: prev.messages.map((m) => (m.id === message.id ? { ...m, ...message } : m)),
      }
    }
    return { ...prev, messages: [...prev.messages, message], total: prev.total + 1 }
  })
}

function patchMessage(qc: QueryClient, convId: string, messageId: string, patch: Partial<ChatMessage>) {
  qc.setQueryData<MessagesResponse>(keys.messages(convId), (prev) =>
    prev
      ? { ...prev, messages: prev.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) }
      : prev,
  )
}

// ── Realtime cho hội thoại đang mở ──────────────────────────────────
export interface ChatRealtimeState {
  typingName: string | null
  aiTyping: boolean
  aiDraft: { suggestionId: string; content: string; confidence: number } | null
  clearAiDraft: () => void
}

/**
 * Join/leave phòng conv, lắng nghe mọi sự kiện chat realtime và cập nhật cache.
 * Tự động rời phòng + gỡ listener khi đổi hội thoại hoặc unmount.
 */
export function useChatRealtime(convId: string | undefined): ChatRealtimeState {
  const qc = useQueryClient()
  const [typingName, setTypingName] = useState<string | null>(null)
  const [aiTyping, setAiTyping] = useState(false)
  const [aiDraft, setAiDraft] = useState<ChatRealtimeState['aiDraft']>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aiTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearAiDraft = useCallback(() => setAiDraft(null), [])

  useEffect(() => {
    if (!convId) return
    const socket = getSocket()
    joinConversation(convId)

    const invalidateList = tạoLàmMớiGộp(qc)

    const onMessage = (msg: ChatMessage) => {
      const target = msg.conversationId || convId
      upsertMessage(qc, target, msg)
      invalidateList()
    }
    const onConvUpdated = (p?: { convId?: string }) => {
      invalidateList()
      // Hội thoại đang mở đổi dữ liệu (vd auto-bắt SĐT/email vào hồ sơ) →
      // làm mới cả panel chi tiết, không chỉ danh sách.
      if (p?.convId && p.convId === convId) {
        qc.invalidateQueries({ queryKey: ['conversation', convId] })
      }
    }
    const onSeen = () => {
      invalidateList()
      // seenBy nằm trong chi tiết hội thoại → làm mới để avatar "Đã xem" nhảy ngay.
      qc.invalidateQueries({ queryKey: ['conversation', convId] })
    }
    const onAiTyping = (p: { convId: string; isTyping: boolean }) => {
      if (p.convId !== convId) return
      setAiTyping(p.isTyping)
      if (aiTypingTimer.current) clearTimeout(aiTypingTimer.current)
      if (p.isTyping) aiTypingTimer.current = setTimeout(() => setAiTyping(false), 15000)
    }
    const onAiDraft = (p: { convId: string; suggestionId: string; content: string; confidence: number }) => {
      if (p.convId !== convId) return
      setAiDraft({ suggestionId: p.suggestionId, content: p.content, confidence: p.confidence })
    }
    const onAiModeChanged = (p: { convId: string; aiMode: AiMode }) => {
      qc.setQueryData<ConversationDetail>(keys.detail(p.convId), (prev) =>
        prev ? { ...prev, aiMode: p.aiMode } : prev,
      )
      invalidateList()
    }
    const onEdited = (p: { messageId: string; content: string }) =>
      patchMessage(qc, convId, p.messageId, { content: p.content })
    const onDeleted = (p: { messageId: string }) =>
      patchMessage(qc, convId, p.messageId, { isDeleted: true })
    const onTypingStart = (p: { convId: string; fullName?: string }) => {
      if (p.convId !== convId) return
      setTypingName(p.fullName || 'Khách')
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => setTypingName(null), 4000)
    }
    const onTypingStop = (p: { convId: string }) => {
      if (p.convId !== convId) return
      setTypingName(null)
    }

    /**
     * Khách thả / gỡ cảm xúc trên Zalo. Backend đã lưu DB và chuẩn hoá emoji,
     * đây chỉ vá cache để hiện ngay mà không phải tải lại hội thoại.
     */
    const onReaction = (p: {
      messageId: string; emoji: string; userId: string; action: 'added' | 'removed'
    }) => {
      qc.setQueryData<MessagesResponse>(keys.messages(convId), (old) => {
        if (!old) return old
        return {
          ...old,
          messages: old.messages.map((m) => {
            if (m.id !== p.messageId) return m
            const rest = (m.reactions ?? []).filter((r) => r.reactorId !== p.userId)
            return {
              ...m,
              reactions: p.action === 'removed' ? rest : [...rest, { emoji: p.emoji, reactorId: p.userId }],
            }
          }),
        }
      })
    }

    /**
     * Cảm xúc thả từ CRM (route reaction bắn `chat:reactions`). Payload không
     * kèm người thả vì server lấy id nhân viên đang đăng nhập làm `reactorId`
     * → vá cache theo chính id đó, nhờ vậy các tab khác của cùng người khớp ngay.
     */
    const onOwnReaction = (p: { messageId: string; emoji: string; action: 'added' | 'removed' }) => {
      const selfId = useAuthStore.getState().user?.id
      if (!selfId) return
      onReaction({ ...p, userId: selfId })
    }

    // Ghim/bỏ ghim từ tab hoặc máy khác → làm mới danh sách
    const onPinToggle = () => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
    }

    // Reconnect sau khi đứt mạng: có thể đã lỡ tin nhắn trong lúc offline
    // (socket.ts đã tự join lại phòng) → tải lại hội thoại đang mở + danh sách.
    const onConnect = () => {
      qc.invalidateQueries({ queryKey: keys.messages(convId) })
      invalidateList()
    }

    // Tin nội bộ mới: server chỉ ping convId (không kèm nội dung) → refetch
    // qua API vốn đã lọc theo quyền của từng người.
    const onInternalPing = (p: { convId: string }) => {
      if (p.convId === convId) qc.invalidateQueries({ queryKey: keys.messages(convId) })
      invalidateList()
    }

    // Backend TDVN lưu tin vào DB trước rồi mới đẩy Zalo; đẩy hỏng thì chỉ báo
    // qua socket — không bắt là nhân viên tưởng khách đã nhận.
    const onSendError = (p: { convId: string; messageId?: string; reason: string }) => {
      if (p.convId !== convId) return
      toast.error(`Gửi tin thất bại: ${p.reason || 'không rõ nguyên nhân'}`)
    }

    socket.on('connect', onConnect)
    socket.on('chat:send-error', onSendError)
    socket.on('chat:internal-message', onInternalPing)
    socket.on('chat:message', onMessage)
    socket.on('chat:pinned', onPinToggle)
    socket.on('chat:unpinned', onPinToggle)
    socket.on('chat:conv-updated', onConvUpdated)
    socket.on('chat:seen', onSeen)
    socket.on('chat:ai-typing', onAiTyping)
    socket.on('chat:ai-draft', onAiDraft)
    socket.on('chat:ai-mode-changed', onAiModeChanged)
    socket.on('chat:message-edited', onEdited)
    socket.on('chat:message-deleted', onDeleted)
    socket.on('chat:deleted', onDeleted)
    socket.on('chat:reaction-sync', onReaction)
    socket.on('chat:reactions', onOwnReaction)
    socket.on('typing:start', onTypingStart)
    socket.on('typing:stop', onTypingStop)

    return () => {
      socket.off('connect', onConnect)
      socket.off('chat:send-error', onSendError)
      socket.off('chat:internal-message', onInternalPing)
      socket.off('chat:message', onMessage)
      socket.off('chat:pinned', onPinToggle)
      socket.off('chat:unpinned', onPinToggle)
      socket.off('chat:conv-updated', onConvUpdated)
      socket.off('chat:seen', onSeen)
      socket.off('chat:ai-typing', onAiTyping)
      socket.off('chat:ai-draft', onAiDraft)
      socket.off('chat:ai-mode-changed', onAiModeChanged)
      socket.off('chat:message-edited', onEdited)
      socket.off('chat:message-deleted', onDeleted)
      socket.off('chat:deleted', onDeleted)
      socket.off('chat:reaction-sync', onReaction)
      socket.off('chat:reactions', onOwnReaction)
      socket.off('typing:start', onTypingStart)
      socket.off('typing:stop', onTypingStop)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      if (aiTypingTimer.current) clearTimeout(aiTypingTimer.current)
      leaveConversation(convId)
      setTypingName(null)
      setAiTyping(false)
      setAiDraft(null)
    }
  }, [convId, qc])

  return { typingName, aiTyping, aiDraft, clearAiDraft }
}

/**
 * Realtime cấp danh sách hội thoại (phòng org — server tự join khi connect).
 * Mount ở trang Hội thoại để sidebar/badge cập nhật ngay cả khi CHƯA mở
 * hội thoại nào (useChatRealtime chỉ chạy khi có convId).
 */
export function useConversationListRealtime() {
  const qc = useQueryClient()

  useEffect(() => {
    const socket = getSocket()

    const invalidateList = tạoLàmMớiGộp(qc)

    socket.on('connect', invalidateList) // reconnect → đồng bộ lại danh sách đã lỡ
    socket.on('chat:conv-updated', invalidateList)
    socket.on('chat:conv-deleted', invalidateList)
    socket.on('chat:pinned', invalidateList)
    socket.on('chat:unpinned', invalidateList)

    return () => {
      socket.off('connect', invalidateList)
      socket.off('chat:conv-updated', invalidateList)
      socket.off('chat:conv-deleted', invalidateList)
      socket.off('chat:pinned', invalidateList)
      socket.off('chat:unpinned', invalidateList)
    }
  }, [qc])
}
