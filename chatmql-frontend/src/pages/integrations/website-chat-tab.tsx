/**
 * website-chat-tab.tsx — Quản lý nút chat nhúng trên website.
 *
 * Một tổ chức khai nhiều website, mỗi cái một `siteKey` riêng — nhờ vậy biết
 * khách đến từ trang nào ("Web: Landing khuyến mãi") và đặt màu/lời chào khác nhau.
 *
 * Khung xem trước nhúng **chính script thật** qua iframe, không vẽ lại bằng
 * React: vẽ lại chỉ giống hình thức, không chứng minh được script chạy được.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Globe, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea, Checkbox } from '@/components/ui/misc'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loading, ErrorState, EmptyState } from '@/components/shared/feedback'
import {
  useWidgets, useCreateWidget, useUpdateWidget, useDeleteWidget, type WebsiteWidget,
} from '@/hooks/use-integrations'
import { API_ORIGIN } from '@/lib/config'
import { api, apiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

/**
 * Gốc URL để tải `widget.js`. Khác `API_ORIGIN`: ở production `API_ORIGIN` là
 * chuỗi RỖNG (cùng origin, nginx proxy sang backend) — dán `<script src="/widget.js">`
 * vào website của khách thì trỏ về chính site họ và hỏng. Mã nhúng bắt buộc phải
 * TUYỆT ĐỐI, nên lùi về origin của trang admin đang mở.
 * Dev (localhost) vẫn ra `http://localhost:4520`.
 */
const scriptOrigin = (): string =>
  API_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '')

function embedSnippet(siteKey: string): string {
  return `<script src="${scriptOrigin()}/widget.js" data-site-key="${siteKey}" defer></script>`
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex items-start gap-1.5">
        <code className={cn('min-w-0 flex-1 rounded bg-muted px-2 py-1.5 text-[11px]', mono && 'break-all')}>
          {value}
        </code>
        <Button
          variant="outline" size="sm" className="h-7 shrink-0 px-2"
          onClick={() =>
            navigator.clipboard.writeText(value).then(
              () => toast.success('Đã chép'),
              () => toast.error('Trình duyệt chặn chép tự động — hãy bôi đen và chép tay'),
            )
          }
        >
          <Copy className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

/**
 * Chọn logo: tải ảnh lên máy chủ rồi lưu URL. Không cho dán URL ngoài — ảnh nằm
 * ở máy chủ người khác thì hỏng lúc nào không biết, mà widget chạy trên website
 * của khách nên ảnh hỏng là mất mặt ngay trang chủ.
 */
function LogoPicker({
  value, color, onChange,
}: {
  value: string | null
  color: string
  onChange: (url: string | null) => void
}) {
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      // Bắt buộc ghi đè Content-Type: `api` mặc định là application/json, gửi
      // FormData kèm header đó thì Fastify từ chối bằng 406.
      const { data } = await api.post<{ url: string }>('/widgets/upload-logo', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      onChange(data.url)
      toast.success('Đã tải logo lên')
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shrink-0 text-center">
      <div
        className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border"
        style={{ background: value ? '#fff' : color }}
      >
        {value ? (
          <img src={value} alt="Logo" className="h-full w-full object-cover" />
        ) : (
          <Globe className="h-6 w-6 text-white" />
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-center gap-1">
        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              // Gán lại value XOÁ luôn files → phải lấy tệp ra trước khi reset.
              e.target.value = ''
              if (f) void upload(f)
            }}
          />
          <span className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] hover:bg-accent">
            <Upload className="h-3 w-3" /> {value ? 'Đổi' : 'Tải logo'}
          </span>
        </label>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Gỡ logo"
            className="inline-flex items-center rounded border px-1.5 py-1 text-[11px] hover:bg-accent"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">PNG/JPG/SVG · tối đa 2MB</p>
    </div>
  )
}

/**
 * Xem trước bằng cách nạp script thật vào iframe.
 * `key` đổi theo cấu hình để iframe dựng lại mỗi khi người dùng sửa.
 */
function WidgetPreview({ widget }: { widget: WebsiteWidget }) {
  // widget.js được đặt cache 5 phút cho website khách. Trong admin thì ngược
  // lại: xem trước phải luôn là bản mới nhất, nếu không sẽ thử một bản cũ và
  // kết luận sai. `nonce` đổi mỗi lần mở lại hoặc bấm "Tải lại".
  const [nonce, setNonce] = useState(() => Date.now())

  // iframe srcdoc có Origin là "null" nên danh sách tên miền của widget (đúng
  // đắn) sẽ chặn lời gọi /widget/:siteKey/config → xem trước trắng trơn. Màn
  // quản trị đã có sẵn toàn bộ cấu hình, nên truyền thẳng vào script thay vì
  // nới lỏng lớp chặn ở backend.
  const previewConfig = useMemo(
    () =>
      JSON.stringify({
        siteKey: widget.siteKey,
        displayName: widget.displayName,
        logoUrl: widget.logoUrl,
        title: widget.title,
        greeting: widget.greeting,
        primaryColor: widget.primaryColor,
        position: widget.position,
        liveChatEnabled: widget.liveChatEnabled,
        zaloUrl: widget.zaloUrl,
        facebookUrl: widget.facebookUrl,
        phoneNumber: widget.phoneNumber,
      }).replace(/"/g, '&quot;'),
    [widget],
  )

  const srcDoc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;height:100%;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
      .hint{position:absolute;top:12px;left:12px;right:12px;color:#94a3b8;font-size:12px;line-height:1.5}
    </style></head><body>
      <p class="hint">Xem trước giao diện — bấm nút góc dưới để mở khung chat. Đây là bản dựng thử, tin nhắn gõ ở đây KHÔNG vào inbox.</p>
      <script src="${scriptOrigin()}/widget.js?v=${nonce}" data-site-key="${widget.siteKey}" data-api="${scriptOrigin()}" data-preview-config="${previewConfig}"></script>
    </body></html>`,
    [widget.siteKey, nonce, previewConfig],
  )
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Khung thử thật: script bên dưới là script khách sẽ nhúng, tin nhắn vào thẳng inbox.
        </p>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs"
          onClick={() => setNonce(Date.now())}>
          Tải lại
        </Button>
      </div>
      <iframe
        key={`${widget.siteKey}:${nonce}:${widget.primaryColor}:${widget.position}:${widget.title}:${widget.displayName}:${widget.logoUrl}:${widget.greeting}:${widget.liveChatEnabled}:${widget.zaloUrl}:${widget.facebookUrl}:${widget.phoneNumber}`}
        srcDoc={srcDoc}
        title={`Xem trước ${widget.name}`}
        // allow-scripts + allow-same-origin để script gọi được API; nguồn là
        // chính máy chủ của mình nên không phải nội dung lạ.
        // allow-forms BẮT BUỘC: ô nhập tin là <form>; thiếu quyền này trình duyệt
        // chặn thẳng sự kiện submit → bấm Gửi không có phản ứng gì.
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        className="h-[460px] w-full rounded-lg border bg-muted"
      />
    </div>
  )
}

function WidgetEditor({ widget }: { widget: WebsiteWidget }) {
  const update = useUpdateWidget()
  const remove = useDeleteWidget()
  const [draft, setDraft] = useState<WebsiteWidget>(widget)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof WebsiteWidget>(k: K, v: WebsiteWidget[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const save = async () => {
    setSaving(true)
    try {
      await update.mutateAsync({
        id: draft.id, name: draft.name, domains: draft.domains, isActive: draft.isActive,
        title: draft.title, greeting: draft.greeting, primaryColor: draft.primaryColor,
        displayName: draft.displayName ?? '', logoUrl: draft.logoUrl ?? '',
        position: draft.position, liveChatEnabled: draft.liveChatEnabled,
        zaloUrl: draft.zaloUrl ?? '', facebookUrl: draft.facebookUrl ?? '',
        phoneNumber: draft.phoneNumber ?? '',
      })
      toast.success('Đã lưu cấu hình')
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setSaving(false)
    }
  }

  const del = async () => {
    if (!window.confirm(`Xoá website "${draft.name}"? Nút chat trên trang đó sẽ ngừng hoạt động.\n\nHội thoại đã có KHÔNG bị xoá.`)) return
    try {
      await remove.mutateAsync(draft.id)
      toast.success('Đã xoá website')
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Tên website</Label>
            <Input value={draft.name} onChange={(e) => set('name', e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Vị trí nút</Label>
            <Select value={draft.position} onValueChange={(v) => set('position', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="right">Góc phải dưới</SelectItem>
                <SelectItem value="left">Góc trái dưới</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>Tên miền được phép nhúng</Label>
          <Textarea
            value={draft.domains.join('\n')}
            onChange={(e) => set('domains', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
            placeholder={'evotech.vn\nshop.evotech.vn'}
            className="mt-1 min-h-[68px] font-mono text-xs"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Mỗi dòng một tên miền; tên miền con tự động được tính. <strong>Để trống = cho phép mọi
            nơi</strong> — chỉ nên dùng khi thử, vì ai chép mã nhúng cũng dùng được.
          </p>
        </div>

        <div className="rounded-lg border p-3">
          <p className="mb-2 text-xs font-semibold">Nhận diện hiển thị với khách</p>
          <div className="flex items-start gap-3">
            <LogoPicker
              value={draft.logoUrl}
              color={draft.primaryColor}
              onChange={(url) => set('logoUrl', url)}
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <Label className="text-[11px]">Tên hiển thị với khách</Label>
                <Input
                  value={draft.displayName ?? ''}
                  onChange={(e) => set('displayName', e.target.value)}
                  placeholder={draft.title || 'Tên thương hiệu'}
                  className="mt-1"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Hiện đậm ở đầu cửa sổ chat. Bỏ trống thì dùng tiêu đề bên dưới.
                  Khác "Tên website" — tên đó chỉ để bạn phân biệt trong danh sách.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Tiêu đề cửa sổ chat</Label>
            <Input value={draft.title} onChange={(e) => set('title', e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Màu chủ đạo</Label>
            <div className="mt-1 flex gap-2">
              <input
                type="color" value={draft.primaryColor}
                onChange={(e) => set('primaryColor', e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border bg-background"
              />
              <Input value={draft.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} />
            </div>
          </div>
        </div>

        <div>
          <Label>Lời chào mở đầu</Label>
          <Textarea value={draft.greeting} onChange={(e) => set('greeting', e.target.value)} className="mt-1 min-h-[56px]" />
        </div>

        <div className="rounded-lg border p-3">
          <p className="mb-2 text-xs font-semibold">Kênh hiện trên nút</p>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={draft.liveChatEnabled} onCheckedChange={(v) => set('liveChatEnabled', v === true)} />
            Chat trực tiếp (tin vào thẳng inbox Hội thoại)
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-[11px]">Link Zalo</Label>
              <Input value={draft.zaloUrl ?? ''} onChange={(e) => set('zaloUrl', e.target.value)} placeholder="https://zalo.me/..." className="mt-1" />
            </div>
            <div>
              <Label className="text-[11px]">Link Facebook</Label>
              <Input value={draft.facebookUrl ?? ''} onChange={(e) => set('facebookUrl', e.target.value)} placeholder="https://m.me/..." className="mt-1" />
            </div>
            <div>
              <Label className="text-[11px]">Số điện thoại</Label>
              <Input value={draft.phoneNumber ?? ''} onChange={(e) => set('phoneNumber', e.target.value)} placeholder="0901234567" className="mt-1" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Bật nhiều kênh thì nút mở ra danh sách để khách chọn. Chỉ một kênh thì bấm là vào thẳng.
          </p>
        </div>

        <CopyRow label="Mã nhúng — dán vào trước thẻ &lt;/body&gt; của website" value={embedSnippet(draft.siteKey)} mono />

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Lưu cấu hình
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={draft.isActive} onCheckedChange={(v) => set('isActive', v === true)} />
            Đang bật
          </label>
          <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={del}>
            <Trash2 className="h-4 w-4" /> Xoá website
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold">Xem trước & thử ngay</p>
        <WidgetPreview widget={draft} />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Khung này nạp <strong>đúng script thật</strong>. Lưu cấu hình rồi khung sẽ dựng lại theo
          thiết lập mới.
        </p>
      </div>
    </div>
  )
}

export function WebsiteChatTab() {
  const { data: widgets, isLoading, isError } = useWidgets()
  const create = useCreateWidget()
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const add = async () => {
    if (!name.trim()) return toast.error('Đặt tên cho website')
    try {
      const w = await create.mutateAsync({ name: name.trim() })
      setName('')
      setOpenId(w.id)
      toast.success(`Đã tạo "${w.name}" — dán mã nhúng vào website`)
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  if (isLoading) return <Loading label="Đang tải website…" />
  if (isError) return <ErrorState message="Không tải được danh sách website." />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Nhúng nút chat vào website bất kỳ. Khách bấm nút có thể chat trực tiếp, hoặc chuyển sang
          Zalo / Facebook tuỳ cấu hình.
        </p>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            placeholder="Tên website mới"
            className="w-48"
          />
          <Button onClick={add} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Thêm website
          </Button>
        </div>
      </div>

      {!widgets?.length ? (
        <EmptyState
          icon={Globe}
          title="Chưa có website nào"
          description="Thêm website để lấy mã nhúng nút chat."
        />
      ) : (
        <div className="space-y-3">
          {widgets.map((w) => (
            <Card key={w.id}>
              <CardContent className="p-4">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === w.id ? null : w.id)}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ backgroundColor: w.primaryColor }}
                  >
                    <Globe className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{w.name}</span>
                      {!w.isActive && <Badge variant="secondary" className="text-[10px]">Đang tắt</Badge>}
                      {w.conversationCount ? (
                        <Badge variant="outline" className="text-[10px]">{w.conversationCount} hội thoại</Badge>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {w.domains.length ? w.domains.join(', ') : 'Chưa khai tên miền — đang cho phép mọi nơi'}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-primary">
                    {openId === w.id ? 'Thu gọn' : 'Cấu hình'}
                  </span>
                </button>

                {openId === w.id && (
                  <div className="mt-4 border-t pt-4">
                    <WidgetEditor widget={w} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
