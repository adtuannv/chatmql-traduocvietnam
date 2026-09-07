/**
 * media-library-dialog.tsx — Popup "Thư viện hệ thống".
 *
 * Cho nhân viên chọn nhanh tài nguyên có sẵn trong CRM để gửi cho khách:
 *  1. Ảnh sản phẩm      — GET /products (+ /product-categories để lọc)
 *  2. Ảnh hội thoại này — GET /conversations/:id/shared-media?type=image (tối đa 50 tin mới nhất)
 *  3. Mẫu tin nhắn      — GET /automation/templates (+ POST /:id/preview để thay biến)
 *  4. Kho tri thức      — POST /product-knowledge/query (+ /knowledge-categories để lọc)
 *
 * Gửi ảnh: POST /conversations/:id/messages/image với JSON { imageUrl } — server tự
 * tải ảnh (tránh CORS khi ảnh nằm trên CDN Zalo).
 * Gửi văn bản: POST /conversations/:id/messages { content }.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, ImageIcon, Loader2, Search, Send } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox, ScrollArea } from '@/components/ui/misc'
import { EmptyState, ErrorState, Loading } from '@/components/shared/feedback'
import { api, apiError } from '@/lib/api-client'
import { API_ORIGIN } from '@/lib/config'
import { cn } from '@/lib/utils'
import { resolveImageUrl } from '@/hooks/use-products'
import type { Product, ProductCategory } from '@/hooks/use-products'
import { KB_TYPE_LABELS, kbLabel } from '@/hooks/use-knowledge'
import type { KnowledgeCategory, KnowledgeEntry } from '@/hooks/use-knowledge'

// ── Hằng số ─────────────────────────────────────────────────────────
const ALL = '__all__'
const DEBOUNCE_MS = 400
const PAGE_SIZE = 24
const KB_LIMIT = 50
const KB_TOP_K = 20

type TabKey = 'products' | 'conversation' | 'templates' | 'knowledge'

interface Envelope<T> {
  success: boolean
  data: T
  meta?: { page: number; pageSize: number; total: number; totalPages: number }
}

interface SharedMediaMessage {
  id: string
  content: string | null
  contentType: string
  senderName: string | null
  sentAt: string
}

interface MessageTemplate {
  id: string
  name: string
  content: string
  category: string | null
  isPersonal: boolean
}

/** Một ô ảnh trong lưới: `thumb` để hiển thị, `full` để tải về và gửi đi. */
interface ImageItem {
  key: string
  thumb: string
  full: string
  label: string
}

// ── Tiện ích ────────────────────────────────────────────────────────

/** Debounce một giá trị (dùng cho ô tìm kiếm). */
function useDebounced<T>(value: T, delay = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/**
 * Tách URL ảnh từ `content` của tin nhắn — content là chuỗi JSON dạng
 * `{"href":…,"thumb":…,"hdUrl":…}` nhưng không phải tin nào cũng hợp lệ.
 */
function parseImageContent(content: string | null | undefined): { thumb: string; full: string } | null {
  if (!content) return null
  const trimmed = content.trim()
  if (trimmed.startsWith('http')) return { thumb: trimmed, full: trimmed }
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    const pick = (k: string) => (typeof obj[k] === 'string' && obj[k] ? (obj[k] as string) : undefined)
    const thumb = pick('thumb') ?? pick('href') ?? pick('hdUrl')
    const full = pick('hdUrl') ?? pick('href') ?? pick('thumb')
    if (!thumb || !full) return null
    return { thumb, full }
  } catch {
    return null // không phải JSON hợp lệ → bỏ qua tin này
  }
}

/** Trích đoạn ngắn để hiển thị trên thẻ văn bản. */
function excerpt(text: string, max = 240): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

// ── Component chính ─────────────────────────────────────────────────
interface Props {
  convId: string
  contactId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MediaLibraryDialog({ convId, contactId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabKey>('products')

  // Bộ lọc theo từng tab
  const [productSearch, setProductSearch] = useState('')
  const [productCat, setProductCat] = useState(ALL)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateCat, setTemplateCat] = useState(ALL)
  const [kbSearch, setKbSearch] = useState('')
  const [kbCat, setKbCat] = useState(ALL)

  const productQ = useDebounced(productSearch)
  const templateQ = useDebounced(templateSearch)
  const kbQ = useDebounced(kbSearch)

  // Ảnh đã tích chọn (chung cho tab 1 & 2, reset khi đổi tab)
  const [selected, setSelected] = useState<ImageItem[]>([])
  const [broken, setBroken] = useState<Record<string, true>>({})
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  // Reset trạng thái mỗi lần mở lại popup
  useEffect(() => {
    if (!open) return
    setTab('products')
    setSelected([])
    setBroken({})
    setProgress({ done: 0, total: 0 })
  }, [open])

  // Đổi tab → bỏ tích chọn để tránh gửi nhầm ảnh của tab trước
  function handleTabChange(next: string) {
    setTab(next as TabKey)
    setSelected([])
  }

  function toggleImage(item: ImageItem, checked: boolean) {
    setSelected((prev) =>
      checked ? [...prev, item] : prev.filter((i) => i.key !== item.key),
    )
  }

  const selectedKeys = useMemo(
    () => new Set(selected.map((i) => i.key)),
    [selected],
  )

  // ── Truy vấn dữ liệu ──────────────────────────────────────────────

  // Tab 1 — danh mục sản phẩm (dùng chung queryKey với useProductCategories)
  const productCatsQuery = useQuery<ProductCategory[]>({
    queryKey: ['product-categories'],
    queryFn: async () => {
      const { data } = await api.get<Envelope<ProductCategory[]>>('/product-categories')
      return data.data
    },
    enabled: open && tab === 'products',
  })

  // Tab 1 — ảnh sản phẩm
  const productsQuery = useQuery<Product[]>({
    queryKey: ['media-library-products', productQ, productCat],
    queryFn: async () => {
      const { data } = await api.get<Envelope<Product[]>>('/products', {
        params: {
          search: productQ || undefined,
          categoryId: productCat === ALL ? undefined : productCat,
          status: 'active',
          page: 1,
          pageSize: PAGE_SIZE,
        },
      })
      return data.data ?? []
    },
    enabled: open && tab === 'products',
    placeholderData: (prev) => prev,
  })

  // Tab 2 — ảnh trong hội thoại (API không hỗ trợ lọc/phân trang)
  const sharedQuery = useQuery<SharedMediaMessage[]>({
    queryKey: ['media-library-shared', convId],
    queryFn: async () => {
      const { data } = await api.get<{ messages: SharedMediaMessage[] }>(
        `/conversations/${convId}/shared-media`,
        { params: { type: 'image' } },
      )
      return data.messages ?? []
    },
    enabled: open && tab === 'conversation' && !!convId,
  })

  // Tab 3 — mẫu tin nhắn
  const templatesQuery = useQuery<MessageTemplate[]>({
    queryKey: ['media-library-templates', templateQ, templateCat],
    queryFn: async () => {
      const { data } = await api.get<{ templates: MessageTemplate[] }>('/automation/templates', {
        params: {
          search: templateQ || undefined,
          category: templateCat === ALL ? undefined : templateCat,
        },
      })
      return data.templates ?? []
    },
    enabled: open && tab === 'templates',
    placeholderData: (prev) => prev,
  })

  // Tab 3 — danh sách category có thật (lấy từ bản không lọc, cache lâu)
  const templateCatsQuery = useQuery<string[]>({
    queryKey: ['media-library-template-categories'],
    queryFn: async () => {
      const { data } = await api.get<{ templates: MessageTemplate[] }>('/automation/templates')
      const set = new Set<string>()
      for (const t of data.templates ?? []) if (t.category) set.add(t.category)
      return [...set].sort((a, b) => a.localeCompare(b, 'vi'))
    },
    enabled: open && tab === 'templates',
    staleTime: 5 * 60 * 1000,
  })

  // Tab 4 — danh mục tri thức (dùng chung queryKey với useKnowledgeCategories)
  const kbCatsQuery = useQuery<KnowledgeCategory[]>({
    queryKey: ['knowledge-categories'],
    queryFn: async () => {
      const { data } = await api.get<Envelope<KnowledgeCategory[]>>('/knowledge-categories')
      return data.data
    },
    enabled: open && tab === 'knowledge',
  })

  // Tab 4 — kho tri thức: có từ khoá thì tìm ngữ nghĩa, không thì lọc theo danh mục
  const knowledgeQuery = useQuery<KnowledgeEntry[]>({
    queryKey: ['media-library-knowledge', kbQ, kbCat],
    queryFn: async () => {
      const body = kbQ
        ? { mode: 'semantic', query: kbQ, scope: 'knowledge', topK: KB_TOP_K }
        : {
            mode: 'filter',
            scope: 'knowledge',
            categoryId: kbCat === ALL ? undefined : kbCat,
            limit: KB_LIMIT,
          }
      const { data } = await api.post<Envelope<{ products?: unknown[]; knowledge?: KnowledgeEntry[] }>>(
        '/product-knowledge/query',
        body,
      )
      const list = data.data?.knowledge ?? []
      // Tìm ngữ nghĩa không nhận categoryId cho scope knowledge → lọc lại ở client
      if (kbQ && kbCat !== ALL) return list.filter((e) => e.categoryId === kbCat)
      return list
    },
    enabled: open && tab === 'knowledge',
    placeholderData: (prev) => prev,
  })

  // ── Chuẩn hoá dữ liệu về ImageItem ────────────────────────────────
  const productImages = useMemo<ImageItem[]>(() => {
    const out: ImageItem[] = []
    for (const p of productsQuery.data ?? []) {
      p.images?.forEach((raw, idx) => {
        const url = resolveImageUrl(raw)
        if (!url) return
        out.push({ key: `p:${p.id}:${idx}`, thumb: url, full: url, label: p.name })
      })
    }
    return out
  }, [productsQuery.data])

  const conversationImages = useMemo<ImageItem[]>(() => {
    const out: ImageItem[] = []
    for (const m of sharedQuery.data ?? []) {
      const parsed = parseImageContent(m.content)
      if (!parsed) continue
      out.push({
        key: `c:${m.id}`,
        thumb: parsed.thumb,
        full: parsed.full,
        label: m.senderName || 'Ảnh trong hội thoại',
      })
    }
    return out
  }, [sharedQuery.data])

  // ── Gửi đi ────────────────────────────────────────────────────────
  function afterSend() {
    queryClient.invalidateQueries({ queryKey: ['conversation-messages', convId] })
    queryClient.invalidateQueries({ queryKey: ['conversations'] })
  }

  /**
   * Gửi ảnh CÓ SẴN. Backend TDVN chỉ nhận multipart (`request.file()`), không
   * nhận `{ imageUrl }` như eCDP → tải ảnh về trình duyệt rồi đẩy lên lại.
   * Ảnh Zalo khác nguồn bị chặn CORS → đi qua `GET /api/v1/media/proxy` (cùng
   * origin API, có CORS); ảnh của chính API thì tải thẳng.
   */
  async function uploadImage(item: ImageItem) {
    const imageUrl = /^https?:\/\//i.test(item.full)
      ? item.full
      : new URL(item.full, API_ORIGIN).toString()
    const sameApi = API_ORIGIN ? imageUrl.startsWith(API_ORIGIN) : imageUrl.startsWith(window.location.origin)
    const fetchUrl = sameApi
      ? imageUrl
      : `${API_ORIGIN}/api/v1/media/proxy?url=${encodeURIComponent(imageUrl)}`
    const res = await fetch(fetchUrl)
    if (!res.ok) throw new Error(`Không tải được ảnh (${res.status})`)
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) throw new Error('Đường dẫn không phải ảnh')
    const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
    const name = imageUrl.split('/').pop()?.split('?')[0] || `image.${ext}`
    const form = new FormData()
    form.append('file', new File([blob], /\.[a-z0-9]+$/i.test(name) ? name : `${name}.${ext}`, { type: blob.type }))
    await api.post(`/conversations/${convId}/messages/image`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  }

  async function handleSendImages() {
    if (!selected.length || sending) return
    setSending(true)
    setProgress({ done: 0, total: selected.length })
    let ok = 0
    let failed = 0
    let lastError = ''
    for (const item of selected) {
      try {
        await uploadImage(item)
        ok += 1
      } catch (err) {
        failed += 1
        lastError = err instanceof Error ? err.message : apiError(err)
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }))
    }
    setSending(false)
    if (ok) afterSend()
    if (failed && !ok) {
      toast.error(lastError || 'Không gửi được ảnh nào.')
      return
    }
    if (failed) {
      toast.warning(`Đã gửi ${ok} ảnh, ${failed} ảnh lỗi.`)
    } else {
      toast.success(`Đã gửi ${ok} ảnh.`)
    }
    setSelected([])
    onOpenChange(false)
  }

  const sendText = useMutation({
    mutationFn: async (content: string) => {
      await api.post(`/conversations/${convId}/messages`, { content })
    },
    onSuccess: () => {
      afterSend()
      toast.success('Đã gửi tin nhắn.')
      onOpenChange(false)
    },
    onError: (err) => toast.error(apiError(err)),
  })

  /** Mẫu tin: gọi preview để thay biến {{…}}; lỗi thì dùng nội dung gốc. */
  async function renderTemplate(tpl: MessageTemplate): Promise<string> {
    try {
      const { data } = await api.post<{ rendered?: string }>(
        `/automation/templates/${tpl.id}/preview`,
        { contactId: contactId ?? undefined },
      )
      return data.rendered?.trim() ? data.rendered : tpl.content
    } catch {
      return tpl.content // preview lỗi → gửi nội dung gốc
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Đã sao chép')
    } catch {
      toast.error('Trình duyệt không cho phép sao chép.')
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  const activeImages = tab === 'products' ? productImages : conversationImages
  const imagesLoading = tab === 'products' ? productsQuery.isLoading : sharedQuery.isLoading
  const imagesError = tab === 'products' ? productsQuery.error : sharedQuery.error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-h-[70vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pr-12 pt-6">
          <DialogTitle>Thư viện hệ thống</DialogTitle>
          <DialogDescription>
            Chọn ảnh, mẫu tin nhắn hoặc bài viết có sẵn trong CRM để gửi cho khách.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={handleTabChange}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="px-6 pt-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="products">Ảnh sản phẩm</TabsTrigger>
              <TabsTrigger value="conversation">Ảnh hội thoại</TabsTrigger>
              <TabsTrigger value="templates">Mẫu tin nhắn</TabsTrigger>
              <TabsTrigger value="knowledge">Kho tri thức</TabsTrigger>
            </TabsList>
          </div>

          {/* ── Tab 1: Ảnh sản phẩm ───────────────────────────────── */}
          <TabsContent
            value="products"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-2 px-6 py-3">
              <SearchBox
                value={productSearch}
                onChange={setProductSearch}
                placeholder="Tìm theo tên, mã sản phẩm…"
              />
              <Select value={productCat} onValueChange={setProductCat}>
                <SelectTrigger className="h-9 w-56">
                  <SelectValue placeholder="Tất cả danh mục" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tất cả danh mục</SelectItem>
                  {(productCatsQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ImageGrid
              items={productImages}
              loading={imagesLoading}
              error={imagesError ? apiError(imagesError) : null}
              emptyTitle="Chưa có ảnh sản phẩm"
              emptyDescription="Thử đổi từ khoá hoặc danh mục khác."
              selectedKeys={selectedKeys}
              broken={broken}
              onBroken={(key) => setBroken((prev) => ({ ...prev, [key]: true }))}
              onToggle={toggleImage}
            />
          </TabsContent>

          {/* ── Tab 2: Ảnh trong hội thoại ────────────────────────── */}
          <TabsContent
            value="conversation"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="px-6 py-3 text-xs text-muted-foreground">
              50 ảnh gần nhất trong hội thoại này (không có bộ lọc).
            </div>
            <ImageGrid
              items={conversationImages}
              loading={imagesLoading}
              error={imagesError ? apiError(imagesError) : null}
              emptyTitle="Hội thoại chưa có ảnh"
              emptyDescription="Ảnh khách gửi hoặc bạn đã gửi sẽ hiện ở đây."
              selectedKeys={selectedKeys}
              broken={broken}
              onBroken={(key) => setBroken((prev) => ({ ...prev, [key]: true }))}
              onToggle={toggleImage}
            />
          </TabsContent>

          {/* ── Tab 3: Mẫu tin nhắn ───────────────────────────────── */}
          <TabsContent
            value="templates"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-2 px-6 py-3">
              <SearchBox
                value={templateSearch}
                onChange={setTemplateSearch}
                placeholder="Tìm mẫu tin nhắn…"
              />
              <Select value={templateCat} onValueChange={setTemplateCat}>
                <SelectTrigger className="h-9 w-56">
                  <SelectValue placeholder="Tất cả nhóm" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tất cả nhóm</SelectItem>
                  {(templateCatsQuery.data ?? []).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TextList
              loading={templatesQuery.isLoading}
              error={templatesQuery.error ? apiError(templatesQuery.error) : null}
              emptyTitle="Chưa có mẫu tin nhắn"
              emptyDescription="Tạo mẫu tại mục Tự động hoá để dùng lại nhanh."
              items={(templatesQuery.data ?? []).map((t) => ({
                id: t.id,
                title: t.name,
                body: t.content,
                badge: t.category || (t.isPersonal ? 'Cá nhân' : 'Nhóm'),
                resolve: () => renderTemplate(t),
              }))}
              busy={sendText.isPending}
              onCopy={copyText}
              onSend={(content) => sendText.mutate(content)}
            />
          </TabsContent>

          {/* ── Tab 4: Kho tri thức ───────────────────────────────── */}
          <TabsContent
            value="knowledge"
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-2 px-6 py-3">
              <SearchBox
                value={kbSearch}
                onChange={setKbSearch}
                placeholder="Tìm bài viết theo ý nghĩa…"
              />
              <Select value={kbCat} onValueChange={setKbCat}>
                <SelectTrigger className="h-9 w-56">
                  <SelectValue placeholder="Tất cả danh mục" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tất cả danh mục</SelectItem>
                  {(kbCatsQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TextList
              loading={knowledgeQuery.isLoading}
              error={knowledgeQuery.error ? apiError(knowledgeQuery.error) : null}
              emptyTitle="Chưa có nội dung phù hợp"
              emptyDescription="Thử từ khoá khác hoặc chọn danh mục khác."
              items={(knowledgeQuery.data ?? []).map((e) => ({
                id: e.id,
                title: kbLabel(e),
                body: e.content,
                badge: KB_TYPE_LABELS[e.type] || e.type,
                resolve: async () => e.content,
              }))}
              busy={sendText.isPending}
              onCopy={copyText}
              onSend={(content) => sendText.mutate(content)}
            />
          </TabsContent>
        </Tabs>

        {/* Thanh gửi ảnh — chỉ hiện ở 2 tab ảnh */}
        {(tab === 'products' || tab === 'conversation') && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/30 px-6 py-3">
            <span className="text-sm text-muted-foreground">
              {selected.length > 0
                ? `Đã chọn ${selected.length} ảnh`
                : `${activeImages.length} ảnh khả dụng`}
            </span>
            <div className="flex items-center gap-3">
              {sending && (
                <span className="text-xs text-muted-foreground">
                  Đang gửi {progress.done}/{progress.total}…
                </span>
              )}
              <Button onClick={handleSendImages} disabled={!selected.length || sending}>
                {sending ? <Loader2 className="animate-spin" /> : <Send />}
                Gửi
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Ô tìm kiếm dùng chung ───────────────────────────────────────────
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative min-w-[200px] flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 pl-8"
      />
    </div>
  )
}

// ── Lưới ảnh có tích chọn ───────────────────────────────────────────
function ImageGrid({
  items,
  loading,
  error,
  emptyTitle,
  emptyDescription,
  selectedKeys,
  broken,
  onBroken,
  onToggle,
}: {
  items: ImageItem[]
  loading: boolean
  error: string | null
  emptyTitle: string
  emptyDescription: string
  selectedKeys: Set<string>
  broken: Record<string, true>
  onBroken: (key: string) => void
  onToggle: (item: ImageItem, checked: boolean) => void
}) {
  const visible = items.filter((i) => !broken[i.key])

  if (loading) return <Loading label="Đang tải ảnh…" />
  if (error) return <ErrorState message={error} />
  if (!visible.length) {
    return <EmptyState icon={ImageIcon} title={emptyTitle} description={emptyDescription} />
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="grid grid-cols-4 gap-3 px-6 pb-6">
        {visible.map((item) => {
          const checked = selectedKeys.has(item.key)
          return (
            // Dùng div (không phải button) vì Checkbox của Radix đã là <button>,
            // lồng button trong button là HTML không hợp lệ.
            <div
              key={item.key}
              role="button"
              tabIndex={0}
              aria-pressed={checked}
              onClick={() => onToggle(item, !checked)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onToggle(item, !checked)
                }
              }}
              title={item.label}
              className={cn(
                'relative aspect-square cursor-pointer overflow-hidden rounded-lg border bg-muted text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                checked ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/50',
              )}
            >
              <img
                src={item.thumb}
                alt={item.label}
                loading="lazy"
                onError={() => onBroken(item.key)}
                className="h-full w-full object-cover"
              />
              <span className="absolute left-1.5 top-1.5">
                <Checkbox
                  checked={checked}
                  tabIndex={-1}
                  className="pointer-events-none bg-background"
                />
              </span>
              <span className="absolute inset-x-0 bottom-0 truncate bg-foreground/60 px-1.5 py-1 text-[11px] text-background">
                {item.label}
              </span>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

// ── Danh sách thẻ văn bản (mẫu tin / tri thức) ──────────────────────
interface TextItem {
  id: string
  title: string
  body: string
  badge?: string | null
  /** Nội dung thực sự sẽ gửi (mẫu tin cần gọi preview để thay biến). */
  resolve: () => Promise<string>
}

function TextList({
  items,
  loading,
  error,
  emptyTitle,
  emptyDescription,
  busy,
  onCopy,
  onSend,
}: {
  items: TextItem[]
  loading: boolean
  error: string | null
  emptyTitle: string
  emptyDescription: string
  busy: boolean
  onCopy: (text: string) => void
  onSend: (content: string) => void
}) {
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function handleSend(item: TextItem) {
    setPendingId(item.id)
    try {
      const content = (await item.resolve()).trim()
      if (!content) {
        toast.error('Nội dung rỗng, không thể gửi.')
        return
      }
      onSend(content)
    } finally {
      setPendingId(null)
    }
  }

  if (loading) return <Loading label="Đang tải nội dung…" />
  if (error) return <ErrorState message={error} />
  if (!items.length) return <EmptyState title={emptyTitle} description={emptyDescription} />

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-2 px-6 pb-6">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-border p-3">
            <div className="mb-1 flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{item.title}</p>
              {item.badge && (
                <Badge variant="secondary" className="shrink-0">
                  {item.badge}
                </Badge>
              )}
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
              {excerpt(item.body)}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => onCopy(item.body)}>
                <Copy />
                Sao chép
              </Button>
              <Button
                size="sm"
                onClick={() => handleSend(item)}
                disabled={busy || pendingId === item.id}
              >
                {pendingId === item.id ? <Loader2 className="animate-spin" /> : <Send />}
                Gửi
              </Button>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
