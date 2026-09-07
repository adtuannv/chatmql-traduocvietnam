import { useEffect, useMemo, useRef, useState } from 'react'
import { Smile, Loader2, Search, PlugZap } from 'lucide-react'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu'
import { api, apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { stickerUrl } from './lib'

/** Từ khoá mặc định để có sẵn gợi ý ngay khi mở popup */
const DEFAULT_KEYWORD = 'hello'

/**
 * Zalo chỉ có API tìm theo từ khoá (không có API "lấy bộ sticker"), nên các tab
 * chủ đề dưới đây gom sẵn nhiều từ khoá để lưới có sticker ngay khi mở popup.
 */
const TOPICS: { key: string; label: string; keywords: string[] }[] = [
  { key: 'popular', label: 'Phổ biến', keywords: ['hello', 'ok', 'cười', 'yêu'] },
  { key: 'greet', label: 'Chào hỏi', keywords: ['hello', 'chào', 'hi'] },
  { key: 'thanks', label: 'Cảm ơn', keywords: ['cảm ơn', 'thank'] },
  { key: 'happy', label: 'Vui', keywords: ['cười', 'vui', 'haha'] },
  { key: 'sad', label: 'Buồn', keywords: ['buồn', 'khóc'] },
  { key: 'love', label: 'Yêu thích', keywords: ['yêu', 'tim', 'love'] },
]
const SEARCH_LIMIT = 50
const DEBOUNCE_MS = 400

const ERR_NO_ZALO = 'Chưa có tài khoản Zalo kết nối — sticker chỉ dùng được với kênh Zalo.'
const ERR_RATE_LIMIT = 'Thao tác quá nhanh, thử lại sau.'

/** Sticker là object passthrough từ zca-js — mọi field đều có thể vắng mặt. */
type RawSticker = Record<string, unknown>

interface StickerItem {
  key: string
  stickerId: number
  cateId: number
  stickerType: number
  imageUrl: string
}

/** Lấy số từ nhiều tên field khả dĩ (giá trị có thể là number hoặc string). */
function pickNumber(raw: RawSticker, keys: string[]): number | null {
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return null
}

/** Lấy chuỗi URL ảnh từ nhiều tên field khả dĩ. */
function pickUrl(raw: RawSticker, keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return null
}

/** Chuẩn hoá sticker thô; trả null nếu thiếu id hoặc thiếu ảnh (sẽ bị bỏ qua). */
function normalizeSticker(raw: unknown, index: number): StickerItem | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as RawSticker

  const stickerId = pickNumber(obj, ['id', 'stickerId', 'sticker_id'])
  if (stickerId === null) return null

  // Zalo KHÔNG trả URL ảnh cho sticker — chỉ trả id. Nếu API có sẵn URL thì dùng,
  // không thì dựng từ CDN theo id (đúng cách bản gốc hiển thị).
  const imageUrl =
    pickUrl(obj, ['url', 'stickerUrl', 'thumb', 'thumbUrl', 'spriteUrl']) ?? stickerUrl(stickerId)

  // cateId bắt buộc khi gửi; không có thì không gửi được → bỏ qua
  const cateId = pickNumber(obj, ['cateId', 'catId', 'categoryId', 'cate_id'])
  if (cateId === null) return null

  const stickerType = pickNumber(obj, ['type', 'stickerType', 'sticker_type']) ?? 2

  return {
    key: `${cateId}-${stickerId}-${index}`,
    stickerId,
    cateId,
    stickerType,
    imageUrl,
  }
}

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

interface Props {
  convId: string
}

export function StickerPicker({ convId }: Props) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')
  const [topic, setTopic] = useState(TOPICS[0].key)
  const [sendingKey, setSendingKey] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Đưa con trỏ vào ô tìm kiếm khi mở popup
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  // Debounce ô tìm kiếm 400ms
  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [keyword])

  // Người dùng gõ tìm → dùng từ khoá đó; không gõ → dùng bộ từ khoá của tab đang chọn
  const activeKeywords = useMemo(() => {
    if (debounced) return [debounced]
    return TOPICS.find((t) => t.key === topic)?.keywords ?? [DEFAULT_KEYWORD]
  }, [debounced, topic])

  const query = useQuery({
    queryKey: ['sticker-search', activeKeywords],
    enabled: open,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      // Gọi song song nhiều từ khoá rồi gộp để lưới đầy ngay khi mở
      const results = await Promise.all(
        activeKeywords.map((kw) =>
          api
            .get<{ success?: boolean; stickers?: unknown }>('/stickers/search', {
              params: { keyword: kw, limit: SEARCH_LIMIT },
            })
            .then((r) => (Array.isArray(r.data?.stickers) ? (r.data.stickers as unknown[]) : []))
            .catch((err) => {
              // 503 = chưa kết nối Zalo → ném lên để hiện thông báo, lỗi khác thì bỏ qua
              if (statusOf(err) === 503) throw err
              return [] as unknown[]
            }),
        ),
      )
      return results.flat()
    },
  })

  const stickers = useMemo(() => {
    const raw = query.data ?? []
    const out: StickerItem[] = []
    const seen = new Set<number>() // gộp nhiều từ khoá → loại sticker trùng
    raw.forEach((item, i) => {
      const norm = normalizeSticker(item, i)
      if (norm && !seen.has(norm.stickerId)) {
        seen.add(norm.stickerId)
        out.push(norm)
      }
    })
    return out
  }, [query.data])

  const noZalo = statusOf(query.error) === 503

  async function sendSticker(item: StickerItem) {
    if (sendingKey) return
    setSendingKey(item.key)
    try {
      await api.post(`/conversations/${convId}/sticker`, {
        stickerId: item.stickerId,
        cateId: item.cateId,
        stickerType: item.stickerType,
      })
      await queryClient.invalidateQueries({ queryKey: ['conversation-messages', convId] })
      setOpen(false)
    } catch (err) {
      const status = statusOf(err)
      if (status === 503) toast.error(ERR_NO_ZALO)
      else if (status === 429) toast.error(ERR_RATE_LIMIT)
      else toast.error(apiError(err))
    } finally {
      setSendingKey(null)
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Sticker" title="Sticker">
          <Smile className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-80 p-3"
        // Không để menu cướp phím gõ (typeahead) khi đang nhập từ khoá
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Tìm sticker..."
            aria-label="Tìm sticker"
            className="h-9 pl-8"
          />
        </div>

        {/* Tab chủ đề — ẩn khi đang tìm theo từ khoá */}
        {!debounced && (
          <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
            {TOPICS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTopic(t.key)}
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                  topic === t.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {noZalo ? (
          <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
            <PlugZap className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{ERR_NO_ZALO}</p>
          </div>
        ) : query.isError ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            {statusOf(query.error) === 429 ? ERR_RATE_LIMIT : apiError(query.error)}
          </div>
        ) : query.isFetching ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải sticker...
          </div>
        ) : stickers.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            Không tìm thấy sticker
          </div>
        ) : (
          <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto">
            {stickers.map((item) => (
              <button
                key={item.key}
                type="button"
                disabled={sendingKey !== null}
                onClick={() => void sendSticker(item)}
                aria-label={`Gửi sticker ${item.stickerId}`}
                className="relative flex aspect-square items-center justify-center rounded-md border border-transparent bg-muted/40 p-1 transition-colors hover:border-border hover:bg-accent disabled:opacity-50"
              >
                <img
                  src={item.imageUrl}
                  loading="lazy"
                  alt={`Sticker ${item.stickerId}`}
                  className="h-full w-full object-contain"
                  onError={(e) => {
                    // Ảnh hỏng → ẩn ô, tránh hiện icon vỡ
                    e.currentTarget.parentElement?.classList.add('hidden')
                  }}
                />
                {sendingKey === item.key && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-md bg-background/70">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
